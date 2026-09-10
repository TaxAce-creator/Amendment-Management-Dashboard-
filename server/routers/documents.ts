import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  amendmentRecords,
  documentChecklist,
  referenceLists,
  referenceValues,
} from "../../drizzle/schema.js";
import { writeActivity } from "../activity.js";
import { requireCapability } from "../authorization.js";
import { requireDb } from "../db.js";
import { ensureSystemConfiguration } from "../referenceData.js";
import { protectedProcedure, router } from "../_core/trpc.js";

const checklistStatus = z.enum(["Needed", "Requested", "Received", "Not Applicable"]);
const DOCUMENT_MONITORING_STATUSES = ["Investigation", "In Progress", "With Client"] as const;

async function requireDocumentTypeList(db: Awaited<ReturnType<typeof requireDb>>) {
  const [list] = await db.select().from(referenceLists).where(eq(referenceLists.key, "documentTypes")).limit(1);
  if (!list) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Document Types reference data is not configured." });
  return list;
}

function assertOpenAmendment(record: typeof amendmentRecords.$inferSelect | undefined) {
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Amendment Record not found." });
  if (record.mergedIntoAmendmentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Document monitoring must be recorded on the surviving merged Amendment Record." });
  if (record.workflowStatus === "Closed") throw new TRPCError({ code: "BAD_REQUEST", message: "Closed Amendment Records cannot receive document-monitoring changes." });
  return record;
}

function documentationStatus(rows: Array<{ status: "Needed" | "Requested" | "Received" | "Not Applicable" }>): string {
  if (!rows.length) return "Not assessed";
  if (rows.some(row => row.status === "Requested" || row.status === "Needed")) return "Awaiting documents in Canopy";
  if (rows.every(row => row.status === "Received" || row.status === "Not Applicable")) return "Documents verified in Canopy";
  return "Document review in progress";
}

export const documentsRouter = router({
  workspace: protectedProcedure
    .input(z.object({ amendmentId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      requireCapability(ctx.user, "view");
      await ensureSystemConfiguration();
      const db = await requireDb();
      const list = await requireDocumentTypeList(db);
      const [options, items] = await Promise.all([
        db
          .select({ id: referenceValues.id, label: referenceValues.label, description: referenceValues.description, sortOrder: referenceValues.sortOrder })
          .from(referenceValues)
          .where(and(eq(referenceValues.listId, list.id), eq(referenceValues.active, true)))
          .orderBy(referenceValues.sortOrder, referenceValues.label),
        db
          .select({ checklist: documentChecklist, documentTypeLabel: referenceValues.label })
          .from(documentChecklist)
          .innerJoin(referenceValues, eq(documentChecklist.documentTypeId, referenceValues.id))
          .where(eq(documentChecklist.amendmentId, input.amendmentId))
          .orderBy(referenceValues.sortOrder, referenceValues.label),
      ]);
      return { options, items };
    }),

  request: protectedProcedure
    .input(z.object({
      amendmentId: z.number().int().positive(),
      documentTypeIds: z.array(z.number().int().positive()).min(1, "Select at least one required document."),
      note: z.string().trim().max(4000).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "coordinateWorkflow");
      await ensureSystemConfiguration();
      const db = await requireDb();
      const selectedIds = Array.from(new Set(input.documentTypeIds));
      return db.transaction(async tx => {
        const [recordRow] = await tx.select().from(amendmentRecords).where(eq(amendmentRecords.id, input.amendmentId)).limit(1);
        const record = assertOpenAmendment(recordRow);
        if (!DOCUMENT_MONITORING_STATUSES.includes(record.workflowStatus as (typeof DOCUMENT_MONITORING_STATUSES)[number])) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Record missing documents while the amendment is in Investigation, In Progress, or With Client. If a later review discovers missing documents, move the amendment back to an appropriate work stage first.",
          });
        }

        const list = await tx.select().from(referenceLists).where(eq(referenceLists.key, "documentTypes")).limit(1).then(rows => rows[0]);
        if (!list) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Document Types reference data is not configured." });
        const selectedTypes = await tx
          .select()
          .from(referenceValues)
          .where(and(eq(referenceValues.listId, list.id), eq(referenceValues.active, true), inArray(referenceValues.id, selectedIds)));
        if (selectedTypes.length !== selectedIds.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "One or more selected document types are no longer available." });
        }

        const existing = await tx
          .select()
          .from(documentChecklist)
          .where(and(eq(documentChecklist.amendmentId, record.id), inArray(documentChecklist.documentTypeId, selectedIds)));
        const now = new Date();
        for (const documentType of selectedTypes) {
          const existingRows = existing.filter(row => row.documentTypeId === documentType.id);
          if (existingRows.length) {
            await tx
              .update(documentChecklist)
              .set({ status: "Requested", note: input.note, requestedAt: now, receivedAt: null, updatedById: ctx.user.id })
              .where(and(eq(documentChecklist.amendmentId, record.id), eq(documentChecklist.documentTypeId, documentType.id)));
          } else {
            await tx.insert(documentChecklist).values({
              amendmentId: record.id,
              documentTypeId: documentType.id,
              status: "Requested",
              note: input.note,
              requestedAt: now,
              updatedById: ctx.user.id,
            });
          }
        }

        const movedToWithClient = record.workflowStatus !== "With Client";
        await tx
          .update(amendmentRecords)
          .set({
            lastClientRequestAt: now,
            lastClientResponseAt: null,
            documentationStatus: "Awaiting documents in Canopy",
            workflowStatus: "With Client",
            lastWorkflowStatusChange: movedToWithClient ? now : record.lastWorkflowStatusChange,
            version: record.version + 1,
          })
          .where(eq(amendmentRecords.id, record.id));

        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: "Required documents recorded",
          entityType: "Amendment Record",
          entityId: record.id,
          clientId: record.clientId,
          amendmentId: record.id,
          newValue: {
            documentTypeIds: selectedTypes.map(item => item.id),
            documents: selectedTypes.map(item => item.label),
            monitoringStartedAt: now.toISOString(),
            sourceSystem: "Canopy",
          },
          note: input.note,
        });

        if (movedToWithClient) {
          await writeActivity(tx, {
            actorType: "user",
            actorUserId: ctx.user.id,
            action: "Workflow Status changed",
            entityType: "Amendment Record",
            entityId: record.id,
            clientId: record.clientId,
            amendmentId: record.id,
            previousValue: { workflowStatus: record.workflowStatus },
            newValue: { workflowStatus: "With Client" },
            note: "Automatically moved to With Client because required documents are pending and must be verified manually in Canopy.",
          });
        }

        return {
          success: true,
          monitoringStartedAt: now,
          documents: selectedTypes.map(item => item.label),
          workflowStatus: "With Client" as const,
          movedToWithClient,
        } as const;
      });
    }),

  updateStatus: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), status: checklistStatus, note: z.string().trim().max(4000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "coordinateWorkflow");
      const db = await requireDb();
      return db.transaction(async tx => {
        const [item] = await tx.select().from(documentChecklist).where(eq(documentChecklist.id, input.id)).limit(1);
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Document checklist item not found." });
        const [recordRow] = await tx.select().from(amendmentRecords).where(eq(amendmentRecords.id, item.amendmentId)).limit(1);
        const record = assertOpenAmendment(recordRow);
        const [documentType] = await tx.select().from(referenceValues).where(eq(referenceValues.id, item.documentTypeId)).limit(1);
        const now = new Date();
        await tx
          .update(documentChecklist)
          .set({
            status: input.status,
            note: input.note,
            requestedAt: input.status === "Requested" ? now : item.requestedAt,
            receivedAt: input.status === "Received" ? now : input.status === "Needed" || input.status === "Requested" ? null : item.receivedAt,
            updatedById: ctx.user.id,
          })
          .where(eq(documentChecklist.id, item.id));

        const rows = await tx.select({ status: documentChecklist.status }).from(documentChecklist).where(eq(documentChecklist.amendmentId, record.id));
        const currentDocumentationStatus = documentationStatus(rows);
        const allResolved = rows.length > 0 && rows.every(row => row.status === "Received" || row.status === "Not Applicable");
        const hasReceivedDocuments = rows.some(row => row.status === "Received");
        const verifiedAt = allResolved && hasReceivedDocuments && !record.lastClientResponseAt ? now : record.lastClientResponseAt;

        await tx
          .update(amendmentRecords)
          .set({
            documentationStatus: currentDocumentationStatus,
            lastClientResponseAt: verifiedAt,
            version: record.version + 1,
          })
          .where(eq(amendmentRecords.id, record.id));
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: input.status === "Received" ? "Document verified in Canopy" : "Document checklist updated",
          entityType: "Document Checklist",
          entityId: item.id,
          clientId: record.clientId,
          amendmentId: record.id,
          previousValue: { status: item.status, note: item.note },
          newValue: { status: input.status, note: input.note, document: documentType?.label ?? `Document Type #${item.documentTypeId}` },
        });
        if (allResolved && hasReceivedDocuments && !record.lastClientResponseAt) {
          await writeActivity(tx, {
            actorType: "user",
            actorUserId: ctx.user.id,
            action: "Required documents verified in Canopy",
            entityType: "Amendment Record",
            entityId: record.id,
            clientId: record.clientId,
            amendmentId: record.id,
            newValue: { documentationStatus: currentDocumentationStatus, verifiedAt: now.toISOString() },
            note: "All tracked required documents are now Received or Not Applicable. Workflow remains With Client until TaxAce staff manually resumes the amendment.",
          });
        }
        return { success: true, documentationStatus: currentDocumentationStatus, allResolved, verifiedAt } as const;
      });
    }),
});
