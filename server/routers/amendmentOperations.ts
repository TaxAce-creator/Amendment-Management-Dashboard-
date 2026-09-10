import { and, desc, eq, inArray, isNull, like, ne, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  activityHistory,
  amendmentRecords,
  amendmentSourceLinks,
  assignments,
  clientRecords,
  documentChecklist,
  notes,
  taxYearRecords,
  users,
} from "../../drizzle/schema.js";
import {
  activeCoverageKey,
  hasCapability,
  PRIORITIES,
  TAX_YEAR_STATUSES,
  validateWorkflowTransition,
  WORKFLOW_STATUSES,
} from "../../shared/taxace.js";
import { writeActivity } from "../activity.js";
import { requireCapability } from "../authorization.js";
import { requireDb } from "../db.js";
import {
  invalidatedAmendmentLevelFinancials,
  planSplitPreservation,
  snapshotAmendmentLevelFinancials,
  structuralFinancialReviewNextAction,
  validateClosureTaxYears,
  validateMergePreservation,
} from "../transactionPolicy.js";
import { protectedProcedure, router } from "../_core/trpc.js";

const jurisdictionSchema = z.enum(["Federal", "California", "Federal & California", "Other State"]);
const filingMethodSchema = z.enum(["Electronic Filing", "Paper Filing"]);
const resultSchema = z.enum([
  "Additional Refund",
  "Reduced Balance Due",
  "Increased Refund Offset",
  "Balance Due",
  "No Financial Change",
  "Informational Amendment",
]);

function recordId(): string {
  return `TA-${new Date().getUTCFullYear()}-${nanoid(7).toUpperCase()}`;
}

function asDate(value?: string | null): Date | null {
  return value ? new Date(value) : null;
}

function assertOperationalRecord(record: typeof amendmentRecords.$inferSelect | undefined, action: string) {
  if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Amendment Record not found." });
  if (record.mergedIntoAmendmentId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `A merged source Amendment Record cannot be ${action}.` });
  }
  if (record.workflowStatus === "Closed") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `A Closed Amendment Record cannot be ${action}.` });
  }
  return record;
}

function assertOperationalAssignee(user: typeof users.$inferSelect | undefined, role: "Assigned Preparer" | "EA Reviewer" | "Current Owner") {
  if (!user?.active) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The selected assignee must be an active TaxAce user." });
  }
  const capability = role === "EA Reviewer" ? "performEaReview" : "coordinateWorkflow";
  if (!hasCapability(user.role, capability)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Viewer accounts cannot receive operational Amendment assignments." });
  }
  return user;
}

async function listYears(db: Awaited<ReturnType<typeof requireDb>>, amendmentIds: number[]) {
  if (amendmentIds.length === 0) return [];
  return db.select().from(taxYearRecords).where(inArray(taxYearRecords.amendmentId, amendmentIds));
}

export const clientsRouter = router({
  list: protectedProcedure
    .input(z.object({ search: z.string().trim().max(160).default("") }).default({ search: "" }))
    .query(async ({ ctx, input }) => {
      requireCapability(ctx.user, "view");
      const db = await requireDb();
      const filter = input.search
        ? or(like(clientRecords.clientName, `%${input.search}%`), like(clientRecords.clientId, `%${input.search}%`))
        : undefined;
      return db.select().from(clientRecords).where(filter).orderBy(clientRecords.clientName).limit(250);
    }),
});

export const amendmentsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(160).default(""),
          status: z.enum(WORKFLOW_STATUSES).optional(),
          includeClosed: z.boolean().default(false),
        })
        .default({ search: "", includeClosed: false }),
    )
    .query(async ({ ctx, input }) => {
      requireCapability(ctx.user, "view");
      const db = await requireDb();
      const conditions = [isNull(amendmentRecords.mergedIntoAmendmentId)];
      if (!input.includeClosed) conditions.push(ne(amendmentRecords.workflowStatus, "Closed"));
      if (input.status) conditions.push(eq(amendmentRecords.workflowStatus, input.status));
      if (input.search) {
        conditions.push(
          or(
            like(clientRecords.clientName, `%${input.search}%`),
            like(clientRecords.clientId, `%${input.search}%`),
            like(amendmentRecords.amendmentRecordId, `%${input.search}%`),
            like(amendmentRecords.amendmentReason, `%${input.search}%`),
          )!,
        );
      }
      const rows = await db
        .select({ amendment: amendmentRecords, client: clientRecords, currentOwnerName: users.name })
        .from(amendmentRecords)
        .innerJoin(clientRecords, eq(amendmentRecords.clientId, clientRecords.id))
        .leftJoin(users, eq(amendmentRecords.currentOwnerId, users.id))
        .where(and(...conditions))
        .orderBy(desc(amendmentRecords.updatedAt));
      const years = await listYears(db, rows.map(row => row.amendment.id));
      return rows.map(row => ({ ...row, taxYears: years.filter(year => year.amendmentId === row.amendment.id) }));
    }),

  workspace: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    requireCapability(ctx.user, "view");
    const db = await requireDb();
    const [record] = await db
      .select({ amendment: amendmentRecords, client: clientRecords })
      .from(amendmentRecords)
      .innerJoin(clientRecords, eq(amendmentRecords.clientId, clientRecords.id))
      .where(eq(amendmentRecords.id, input.id))
      .limit(1);
    if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Amendment Record not found." });

    const mergedSources = await db
      .select({ id: amendmentRecords.id, amendmentRecordId: amendmentRecords.amendmentRecordId })
      .from(amendmentRecords)
      .where(eq(amendmentRecords.mergedIntoAmendmentId, input.id));
    const sourceIds = mergedSources.map(item => item.id);
    const amendmentIds = [input.id, ...sourceIds];
    const [years, recordNotes, recordAssignments, documents, activities] = await Promise.all([
      listYears(db, amendmentIds),
      db
        .select({ note: notes, authorName: users.name })
        .from(notes)
        .leftJoin(users, eq(notes.authorId, users.id))
        .where(inArray(notes.amendmentId, amendmentIds))
        .orderBy(desc(notes.createdAt)),
      db
        .select({ assignment: assignments, assigneeName: users.name })
        .from(assignments)
        .leftJoin(users, eq(assignments.assigneeId, users.id))
        .where(inArray(assignments.amendmentId, amendmentIds))
        .orderBy(desc(assignments.assignmentDate)),
      db.select().from(documentChecklist).where(inArray(documentChecklist.amendmentId, amendmentIds)),
      db
        .select({ activity: activityHistory, actorName: users.name })
        .from(activityHistory)
        .leftJoin(users, eq(activityHistory.actorUserId, users.id))
        .where(inArray(activityHistory.amendmentId, amendmentIds))
        .orderBy(desc(activityHistory.createdAt))
        .limit(200),
    ]);
    return { ...record, taxYears: years, notes: recordNotes, assignments: recordAssignments, documents, activities, mergedSources };
  }),

  updateAssessment: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        amendmentReason: z.string().trim().min(3).max(8000),
        assessmentSummary: z.string().trim().max(8000).nullable(),
        documentsReceivedSummary: z.string().trim().max(4000).nullable(),
        documentsNeededSummary: z.string().trim().max(4000).nullable(),
        documentationStatus: z.string().trim().max(120).nullable(),
        federalTaxImpact: z.number().finite().nullable(),
        californiaTaxImpact: z.number().finite().nullable(),
        estimatedRefundBalanceDue: z.number().finite().nullable(),
        riskIfNotAmended: z.string().trim().max(8000).nullable(),
        nextAction: z.string().trim().max(2000).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "editTechnical");
      const db = await requireDb();
      return db.transaction(async tx => {
        const [existing] = await tx.select().from(amendmentRecords).where(eq(amendmentRecords.id, input.id)).limit(1);
        const record = assertOperationalRecord(existing, "technically edited");
        await tx
          .update(amendmentRecords)
          .set({
            amendmentReason: input.amendmentReason,
            assessmentSummary: input.assessmentSummary,
            documentsReceivedSummary: input.documentsReceivedSummary,
            documentsNeededSummary: input.documentsNeededSummary,
            documentationStatus: input.documentationStatus,
            federalTaxImpact: input.federalTaxImpact?.toString() ?? null,
            californiaTaxImpact: input.californiaTaxImpact?.toString() ?? null,
            estimatedRefundBalanceDue: input.estimatedRefundBalanceDue?.toString() ?? null,
            riskIfNotAmended: input.riskIfNotAmended,
            nextAction: input.nextAction,
            version: record.version + 1,
          })
          .where(and(eq(amendmentRecords.id, record.id), eq(amendmentRecords.version, record.version)));
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: "Amendment Assessment updated",
          entityType: "Amendment Record",
          entityId: record.id,
          clientId: record.clientId,
          amendmentId: record.id,
          previousValue: { amendmentReason: record.amendmentReason, nextAction: record.nextAction },
          newValue: { amendmentReason: input.amendmentReason, nextAction: input.nextAction },
        });
      });
      return { success: true } as const;
    }),

  updateWorkflow: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), toStatus: z.enum(WORKFLOW_STATUSES), note: z.string().trim().max(2000).nullable() }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "coordinateWorkflow");
      if (input.toStatus === "Closed") requireCapability(ctx.user, "close");
      const db = await requireDb();
      return db.transaction(async tx => {
        const [existing] = await tx.select().from(amendmentRecords).where(eq(amendmentRecords.id, input.id)).limit(1);
        const record = assertOperationalRecord(existing, "moved through workflow");
        if ((record.workflowStatus === "EA Review" || input.toStatus === "EA Review") && ctx.user.role !== "Admin") {
          requireCapability(ctx.user, "performEaReview");
        }
        const years = await tx.select().from(taxYearRecords).where(eq(taxYearRecords.amendmentId, record.id));
        const closure = validateClosureTaxYears(years.map(year => year.taxYearStatus));
        const validationMessage = validateWorkflowTransition(record.workflowStatus, input.toStatus, {
          paymentConfirmed: Boolean(record.paymentConfirmedAt),
          signatureReceived: Boolean(record.signatureReceivedAt),
          allTaxYearsClosed: closure.ok,
        });
        if (validationMessage) throw new TRPCError({ code: "BAD_REQUEST", message: validationMessage });

        const now = new Date();
        await tx
          .update(amendmentRecords)
          .set({
            workflowStatus: input.toStatus,
            lastWorkflowStatusChange: now,
            dateClosed: input.toStatus === "Closed" ? now : record.dateClosed,
            version: record.version + 1,
          })
          .where(and(eq(amendmentRecords.id, record.id), eq(amendmentRecords.version, record.version)));

        if (input.toStatus === "Closed") {
          await tx.update(taxYearRecords).set({ activeCoverageKey: null }).where(eq(taxYearRecords.amendmentId, record.id));
          await tx
            .update(assignments)
            .set({ current: false, endedAt: now })
            .where(and(eq(assignments.amendmentId, record.id), eq(assignments.current, true)));
        }

        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: input.toStatus === "Closed" ? "Amendment Record closed" : "Workflow Status changed",
          entityType: "Amendment Record",
          entityId: record.id,
          clientId: record.clientId,
          amendmentId: record.id,
          previousValue: { workflowStatus: record.workflowStatus },
          newValue: { workflowStatus: input.toStatus },
          note: input.note,
        });
        return { success: true, workflowStatus: input.toStatus, changedAt: now };
      });
    }),

  recordMilestone: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), milestone: z.enum(["payment", "signature", "clientRequest", "clientResponse"]) }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "coordinateWorkflow");
      const db = await requireDb();
      return db.transaction(async tx => {
        const [existing] = await tx.select().from(amendmentRecords).where(eq(amendmentRecords.id, input.id)).limit(1);
        const record = assertOperationalRecord(existing, "updated with a milestone");
        const now = new Date();
        const fields = {
          payment: { paymentConfirmedAt: now },
          signature: { signatureReceivedAt: now },
          clientRequest: { lastClientRequestAt: now },
          clientResponse: { lastClientResponseAt: now },
        }[input.milestone];
        await tx.update(amendmentRecords).set({ ...fields, version: record.version + 1 }).where(eq(amendmentRecords.id, record.id));
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: `${input.milestone} milestone recorded`,
          entityType: "Amendment Record",
          entityId: record.id,
          clientId: record.clientId,
          amendmentId: record.id,
          newValue: { milestone: input.milestone, recordedAt: now.toISOString() },
        });
      });
      return { success: true } as const;
    }),

  setPriority: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), priority: z.enum(PRIORITIES) }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "changePriority");
      const db = await requireDb();
      return db.transaction(async tx => {
        const [existing] = await tx.select().from(amendmentRecords).where(eq(amendmentRecords.id, input.id)).limit(1);
        const record = assertOperationalRecord(existing, "reprioritized");
        await tx.update(amendmentRecords).set({ priority: input.priority, version: record.version + 1 }).where(eq(amendmentRecords.id, record.id));
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: "Priority changed",
          entityType: "Amendment Record",
          entityId: record.id,
          clientId: record.clientId,
          amendmentId: record.id,
          previousValue: { priority: record.priority },
          newValue: { priority: input.priority },
        });
      });
      return { success: true } as const;
    }),

  archive: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireCapability(ctx.user, "archive");
    const db = await requireDb();
    return db.transaction(async tx => {
      const [record] = await tx.select().from(amendmentRecords).where(eq(amendmentRecords.id, input.id)).limit(1);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Amendment Record not found." });
      if (record.mergedIntoAmendmentId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Merged source records are retained automatically and are not manually archived." });
      }
      if (record.workflowStatus !== "Closed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only Closed Amendment Records may be archived." });
      }
      if (record.archivedAt) return { success: true, alreadyArchived: true } as const;
      const now = new Date();
      await tx.update(amendmentRecords).set({ archivedAt: now, version: record.version + 1 }).where(eq(amendmentRecords.id, record.id));
      await writeActivity(tx, {
        actorType: "user",
        actorUserId: ctx.user.id,
        action: "Amendment Record archived",
        entityType: "Amendment Record",
        entityId: record.id,
        clientId: record.clientId,
        amendmentId: record.id,
        newValue: { archivedAt: now.toISOString() },
      });
      return { success: true, alreadyArchived: false } as const;
    });
  }),

  split: protectedProcedure
    .input(
      z.object({
        sourceAmendmentId: z.number().int().positive(),
        taxYearRecordIds: z.array(z.number().int().positive()).min(1),
        assignedPreparerId: z.number().int().positive(),
        currentOwnerId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "splitMerge");
      const db = await requireDb();
      return db.transaction(async tx => {
        const [sourceRecord] = await tx.select().from(amendmentRecords).where(eq(amendmentRecords.id, input.sourceAmendmentId)).limit(1);
        const source = assertOperationalRecord(sourceRecord, "split");
        const [preparer, owner] = await Promise.all([
          tx.select().from(users).where(eq(users.id, input.assignedPreparerId)).limit(1).then(rows => rows[0]),
          tx.select().from(users).where(eq(users.id, input.currentOwnerId)).limit(1).then(rows => rows[0]),
        ]);
        assertOperationalAssignee(preparer, "Assigned Preparer");
        assertOperationalAssignee(owner, "Current Owner");

        const years = await tx.select().from(taxYearRecords).where(eq(taxYearRecords.amendmentId, source.id));
        const splitPlan = planSplitPreservation(years.map(year => year.id), input.taxYearRecordIds);
        if (!splitPlan.ok) throw new TRPCError({ code: "BAD_REQUEST", message: splitPlan.message });

        const previousFinancials = snapshotAmendmentLevelFinancials({
          auditEstimatedTaxImpact: source.auditEstimatedTaxImpact,
          federalTaxImpact: source.federalTaxImpact,
          californiaTaxImpact: source.californiaTaxImpact,
          estimatedRefundBalanceDue: source.estimatedRefundBalanceDue,
        });
        const invalidatedFinancials = invalidatedAmendmentLevelFinancials();
        const splitNextAction = structuralFinancialReviewNextAction("split", source.nextAction);
        const financialPolicy = "Amendment-level financial totals invalidated after split; Tax Year estimated/final impacts preserved on Tax Year Records.";

        const publicId = recordId();
        const inserted = await tx
          .insert(amendmentRecords)
          .values({
            amendmentRecordId: publicId,
            clientId: source.clientId,
            workflowStatus: "Investigation",
            amendmentReasonId: source.amendmentReasonId,
            triggerSourceId: source.triggerSourceId,
            amendmentType: source.amendmentType,
            amendmentReason: source.amendmentReason,
            assessmentSummary: source.assessmentSummary,
            documentsReceivedSummary: source.documentsReceivedSummary,
            documentsNeededSummary: source.documentsNeededSummary,
            documentationStatus: source.documentationStatus,
            ...invalidatedFinancials,
            riskIfNotAmended: source.riskIfNotAmended,
            priority: source.priority,
            nextAction: splitNextAction,
            assignedPreparerId: input.assignedPreparerId,
            assignedEaReviewerId: source.assignedEaReviewerId,
            currentOwnerId: input.currentOwnerId,
            dueDate: source.dueDate,
          })
          .returning({ id: amendmentRecords.id });
        const newId = inserted[0]?.id;
        if (!newId) throw new Error("Split Amendment Record could not be created.");

        await tx
          .update(taxYearRecords)
          .set({ amendmentId: newId, assignedUserId: input.assignedPreparerId })
          .where(inArray(taxYearRecords.id, splitPlan.movedIds));

        const splitAssignments: Array<{
          amendmentId: number;
          assignmentRole: "Assigned Preparer" | "Current Owner" | "EA Reviewer";
          assigneeId: number;
          assignedById: number;
        }> = [
          { amendmentId: newId, assignmentRole: "Assigned Preparer", assigneeId: input.assignedPreparerId, assignedById: ctx.user.id },
          { amendmentId: newId, assignmentRole: "Current Owner", assigneeId: input.currentOwnerId, assignedById: ctx.user.id },
        ];
        if (source.assignedEaReviewerId) {
          const [eaReviewer] = await tx.select().from(users).where(eq(users.id, source.assignedEaReviewerId)).limit(1);
          if (eaReviewer?.active && hasCapability(eaReviewer.role, "performEaReview")) {
            splitAssignments.push({ amendmentId: newId, assignmentRole: "EA Reviewer", assigneeId: eaReviewer.id, assignedById: ctx.user.id });
          }
        }
        await tx.insert(assignments).values(splitAssignments);

        const sourceLinks = await tx.select().from(amendmentSourceLinks).where(eq(amendmentSourceLinks.amendmentId, source.id));
        if (sourceLinks.length > 0) {
          await tx.insert(amendmentSourceLinks).values(sourceLinks.map(link => ({ amendmentId: newId, workGroupId: link.workGroupId })));
        }

        await tx
          .update(amendmentRecords)
          .set({ ...invalidatedFinancials, nextAction: splitNextAction, version: source.version + 1 })
          .where(eq(amendmentRecords.id, source.id));

        const correlationId = crypto.randomUUID();
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: "Amendment Record split",
          entityType: "Amendment Record",
          entityId: source.id,
          clientId: source.clientId,
          amendmentId: source.id,
          previousValue: { amendmentLevelFinancials: previousFinancials },
          newValue: {
            createdAmendmentId: newId,
            movedTaxYearRecordIds: splitPlan.movedIds,
            remainingTaxYearRecordIds: splitPlan.remainingIds,
            amendmentLevelFinancials: invalidatedFinancials,
            financialPolicy,
          },
          note: "Recalculate amendment-level financial impacts on both resulting records before relying on totals.",
          correlationId,
        });
        await writeActivity(tx, {
          actorType: "system",
          action: "Amendment Record created from split",
          entityType: "Amendment Record",
          entityId: newId,
          clientId: source.clientId,
          amendmentId: newId,
          previousValue: { sourceAmendmentLevelFinancials: previousFinancials },
          newValue: {
            sourceAmendmentId: source.id,
            taxYearRecordIds: splitPlan.movedIds,
            sourceWorkGroupIds: sourceLinks.map(link => link.workGroupId),
            amendmentLevelFinancials: invalidatedFinancials,
            financialPolicy,
          },
          note: "Tax Year financial impacts moved with their records; amendment-level totals require explicit recalculation.",
          correlationId,
        });
        return { id: newId, amendmentRecordId: publicId };
      });
    }),

  merge: protectedProcedure
    .input(z.object({ sourceAmendmentId: z.number().int().positive(), targetAmendmentId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "splitMerge");
      if (input.sourceAmendmentId === input.targetAmendmentId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Source and target Amendment Records must be different." });
      }
      const db = await requireDb();
      return db.transaction(async tx => {
        const records = await tx
          .select()
          .from(amendmentRecords)
          .where(inArray(amendmentRecords.id, [input.sourceAmendmentId, input.targetAmendmentId]));
        const sourceRecord = records.find(item => item.id === input.sourceAmendmentId);
        const targetRecord = records.find(item => item.id === input.targetAmendmentId);
        const source = assertOperationalRecord(sourceRecord, "merged");
        const target = assertOperationalRecord(targetRecord, "used as a merge target");
        if (source.clientId !== target.clientId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only Amendment Records for the same Client Record may be merged." });
        }

        const years = await tx
          .select()
          .from(taxYearRecords)
          .where(inArray(taxYearRecords.amendmentId, [source.id, target.id]));
        const sourceYears = years.filter(year => year.amendmentId === source.id);
        const targetYears = years.filter(year => year.amendmentId === target.id);
        const mergePlan = validateMergePreservation({
          sourceId: source.id,
          targetId: target.id,
          sourceClientId: source.clientId,
          targetClientId: target.clientId,
          sourceYears: sourceYears.map(year => year.taxYear),
          targetYears: targetYears.map(year => year.taxYear),
        });
        if (!mergePlan.ok) throw new TRPCError({ code: "CONFLICT", message: mergePlan.message });

        const sourcePreviousFinancials = snapshotAmendmentLevelFinancials({
          auditEstimatedTaxImpact: source.auditEstimatedTaxImpact,
          federalTaxImpact: source.federalTaxImpact,
          californiaTaxImpact: source.californiaTaxImpact,
          estimatedRefundBalanceDue: source.estimatedRefundBalanceDue,
        });
        const targetPreviousFinancials = snapshotAmendmentLevelFinancials({
          auditEstimatedTaxImpact: target.auditEstimatedTaxImpact,
          federalTaxImpact: target.federalTaxImpact,
          californiaTaxImpact: target.californiaTaxImpact,
          estimatedRefundBalanceDue: target.estimatedRefundBalanceDue,
        });
        const invalidatedFinancials = invalidatedAmendmentLevelFinancials();
        const targetNextAction = structuralFinancialReviewNextAction("merge", target.nextAction);
        const sourceNextAction = structuralFinancialReviewNextAction("merge", source.nextAction);
        const financialPolicy = "Amendment-level financial totals invalidated after merge; Tax Year estimated/final impacts preserved on moved Tax Year Records.";

        for (const year of sourceYears) {
          await tx
            .update(taxYearRecords)
            .set({ amendmentId: target.id, assignedUserId: target.assignedPreparerId, activeCoverageKey: activeCoverageKey(target.clientId, year.taxYear) })
            .where(eq(taxYearRecords.id, year.id));
        }

        const [sourceLinks, targetLinks] = await Promise.all([
          tx.select().from(amendmentSourceLinks).where(eq(amendmentSourceLinks.amendmentId, source.id)),
          tx.select().from(amendmentSourceLinks).where(eq(amendmentSourceLinks.amendmentId, target.id)),
        ]);
        const targetWorkGroupIds = new Set(targetLinks.map(link => link.workGroupId));
        const missingTargetLinks = sourceLinks.filter(link => !targetWorkGroupIds.has(link.workGroupId));
        if (missingTargetLinks.length > 0) {
          await tx.insert(amendmentSourceLinks).values(missingTargetLinks.map(link => ({ amendmentId: target.id, workGroupId: link.workGroupId })));
        }

        const now = new Date();
        await tx
          .update(amendmentRecords)
          .set({
            ...invalidatedFinancials,
            nextAction: sourceNextAction,
            mergedIntoAmendmentId: target.id,
            workflowStatus: "Closed",
            dateClosed: now,
            archivedAt: now,
            version: source.version + 1,
          })
          .where(eq(amendmentRecords.id, source.id));
        await tx
          .update(amendmentRecords)
          .set({ ...invalidatedFinancials, nextAction: targetNextAction, version: target.version + 1 })
          .where(eq(amendmentRecords.id, target.id));
        await tx
          .update(assignments)
          .set({ current: false, endedAt: now })
          .where(and(eq(assignments.amendmentId, source.id), eq(assignments.current, true)));

        const correlationId = crypto.randomUUID();
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: "Amendment Record merged",
          entityType: "Amendment Record",
          entityId: source.id,
          clientId: source.clientId,
          amendmentId: source.id,
          previousValue: { amendmentLevelFinancials: sourcePreviousFinancials },
          newValue: {
            mergedIntoAmendmentId: target.id,
            movedTaxYears: sourceYears.map(year => year.taxYear),
            amendmentLevelFinancials: invalidatedFinancials,
            financialPolicy,
          },
          note: "The source record is historical after merge. Previous amendment-level totals remain traceable in this activity entry.",
          correlationId,
        });
        await writeActivity(tx, {
          actorType: "system",
          action: "Merged source linked to target",
          entityType: "Amendment Record",
          entityId: target.id,
          clientId: target.clientId,
          amendmentId: target.id,
          previousValue: {
            targetAmendmentLevelFinancials: targetPreviousFinancials,
            mergedSourceAmendmentLevelFinancials: sourcePreviousFinancials,
          },
          newValue: {
            mergedSourceAmendmentId: source.id,
            preservedTaxYears: mergePlan.preservedYears,
            sourceWorkGroupIds: sourceLinks.map(link => link.workGroupId),
            amendmentLevelFinancials: invalidatedFinancials,
            financialPolicy,
          },
          note: "Recalculate amendment-level financial impacts on the merged target before relying on totals.",
          correlationId,
        });
        return { success: true } as const;
      });
    }),
});

export const taxYearsRouter = router({
  add: protectedProcedure
    .input(z.object({ amendmentId: z.number().int().positive(), taxYear: z.number().int().min(1990), jurisdiction: jurisdictionSchema }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "editTechnical");
      const db = await requireDb();
      return db.transaction(async tx => {
        const [existing] = await tx.select().from(amendmentRecords).where(eq(amendmentRecords.id, input.amendmentId)).limit(1);
        const record = assertOperationalRecord(existing, "given another Tax Year Record");
        const key = activeCoverageKey(record.clientId, input.taxYear);
        const [overlap] = await tx.select().from(taxYearRecords).where(eq(taxYearRecords.activeCoverageKey, key)).limit(1);
        if (overlap) {
          throw new TRPCError({ code: "CONFLICT", message: "This Client Record already has active coverage for the selected Tax Year." });
        }
        const inserted = await tx
          .insert(taxYearRecords)
          .values({
            amendmentId: record.id,
            clientId: record.clientId,
            taxYear: input.taxYear,
            taxYearStatus: "Investigation",
            jurisdiction: input.jurisdiction,
            assignedUserId: record.assignedPreparerId,
            activeCoverageKey: key,
          })
          .returning({ id: taxYearRecords.id });
        await tx.update(amendmentRecords).set({ version: record.version + 1 }).where(eq(amendmentRecords.id, record.id));
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: "Tax Year Record added",
          entityType: "Tax Year Record",
          entityId: inserted[0]?.id,
          clientId: record.clientId,
          amendmentId: record.id,
          newValue: { taxYear: input.taxYear, jurisdiction: input.jurisdiction },
        });
        return { id: inserted[0]?.id };
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        taxYearStatus: z.enum(TAX_YEAR_STATUSES),
        filingMethod: filingMethodSchema.nullable(),
        jurisdiction: jurisdictionSchema,
        federalStatus: z.string().trim().max(120).nullable(),
        stateStatus: z.string().trim().max(120).nullable(),
        dateFiled: z.string().datetime().nullable(),
        dateAccepted: z.string().datetime().nullable(),
        amendmentResult: resultSchema.nullable(),
        estimatedImpact: z.number().finite().nullable(),
        finalImpact: z.number().finite().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, ctx.user.role === "EA Reviewer" ? "performEaReview" : "editTechnical");
      const db = await requireDb();
      return db.transaction(async tx => {
        const [year] = await tx.select().from(taxYearRecords).where(eq(taxYearRecords.id, input.id)).limit(1);
        if (!year) throw new TRPCError({ code: "NOT_FOUND", message: "Tax Year Record not found." });
        const [parent] = await tx.select().from(amendmentRecords).where(eq(amendmentRecords.id, year.amendmentId)).limit(1);
        const record = assertOperationalRecord(parent, "given Tax Year changes");
        const filedAt = asDate(input.dateFiled);
        const acceptedAt = asDate(input.dateAccepted);
        if (filedAt && acceptedAt && acceptedAt.getTime() < filedAt.getTime()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Date Accepted cannot be earlier than Date Filed." });
        }
        await tx
          .update(taxYearRecords)
          .set({
            taxYearStatus: input.taxYearStatus,
            filingMethod: input.filingMethod,
            jurisdiction: input.jurisdiction,
            federalStatus: input.federalStatus,
            stateStatus: input.stateStatus,
            dateFiled: filedAt,
            dateAccepted: acceptedAt,
            amendmentResult: input.amendmentResult,
            estimatedImpact: input.estimatedImpact?.toString() ?? null,
            finalImpact: input.finalImpact?.toString() ?? null,
          })
          .where(eq(taxYearRecords.id, year.id));
        await tx.update(amendmentRecords).set({ version: record.version + 1 }).where(eq(amendmentRecords.id, record.id));
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: "Tax Year Record updated",
          entityType: "Tax Year Record",
          entityId: year.id,
          clientId: year.clientId,
          amendmentId: year.amendmentId,
          previousValue: { taxYearStatus: year.taxYearStatus, filingMethod: year.filingMethod },
          newValue: { taxYearStatus: input.taxYearStatus, filingMethod: input.filingMethod },
        });
      });
      return { success: true } as const;
    }),
});

export const assignmentsRouter = router({
  reassign: protectedProcedure
    .input(
      z.object({
        amendmentId: z.number().int().positive(),
        role: z.enum(["Assigned Preparer", "EA Reviewer", "Current Owner"]),
        assigneeId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "assign");
      const db = await requireDb();
      return db.transaction(async tx => {
        const [existing] = await tx.select().from(amendmentRecords).where(eq(amendmentRecords.id, input.amendmentId)).limit(1);
        const record = assertOperationalRecord(existing, "reassigned");
        const [candidate] = await tx.select().from(users).where(eq(users.id, input.assigneeId)).limit(1);
        const assignee = assertOperationalAssignee(candidate, input.role);
        const previousAssigneeId =
          input.role === "Assigned Preparer"
            ? record.assignedPreparerId
            : input.role === "EA Reviewer"
              ? record.assignedEaReviewerId
              : record.currentOwnerId;
        if (previousAssigneeId === assignee.id) return { success: true, changed: false } as const;

        const now = new Date();
        await tx
          .update(assignments)
          .set({ current: false, endedAt: now })
          .where(and(eq(assignments.amendmentId, record.id), eq(assignments.assignmentRole, input.role), eq(assignments.current, true)));
        await tx.insert(assignments).values({
          amendmentId: record.id,
          assignmentRole: input.role,
          assigneeId: assignee.id,
          assignedById: ctx.user.id,
        });
        const update =
          input.role === "Assigned Preparer"
            ? { assignedPreparerId: assignee.id }
            : input.role === "EA Reviewer"
              ? { assignedEaReviewerId: assignee.id }
              : { currentOwnerId: assignee.id };
        await tx.update(amendmentRecords).set({ ...update, version: record.version + 1 }).where(eq(amendmentRecords.id, record.id));
        if (input.role === "Assigned Preparer") {
          await tx.update(taxYearRecords).set({ assignedUserId: assignee.id }).where(eq(taxYearRecords.amendmentId, record.id));
        }
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: `${input.role} reassigned`,
          entityType: "Assignment",
          clientId: record.clientId,
          amendmentId: record.id,
          previousValue: { assignmentRole: input.role, assigneeId: previousAssigneeId },
          newValue: { assignmentRole: input.role, assigneeId: assignee.id },
        });
        return { success: true, changed: true } as const;
      });
    }),
});

export const notesRouter = router({
  add: protectedProcedure
    .input(z.object({ amendmentId: z.number().int().positive(), body: z.string().trim().min(1).max(8000) }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "coordinateWorkflow");
      const db = await requireDb();
      return db.transaction(async tx => {
        const [record] = await tx.select().from(amendmentRecords).where(eq(amendmentRecords.id, input.amendmentId)).limit(1);
        if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Amendment Record not found." });
        if (record.mergedIntoAmendmentId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Add notes to the surviving merged Amendment Record instead." });
        }
        const inserted = await tx.insert(notes).values({ amendmentId: record.id, authorId: ctx.user.id, body: input.body }).returning({ id: notes.id });
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: "Internal Note added",
          entityType: "Internal Note",
          entityId: inserted[0]?.id,
          clientId: record.clientId,
          amendmentId: record.id,
          note: "An internal note was added.",
        });
        return { id: inserted[0]?.id };
      });
    }),
});

export const activityRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({ amendmentId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(250).default(100) })
        .default({ limit: 100 }),
    )
    .query(async ({ ctx, input }) => {
      requireCapability(ctx.user, "view");
      const db = await requireDb();
      return db
        .select({ activity: activityHistory, actorName: users.name })
        .from(activityHistory)
        .leftJoin(users, eq(activityHistory.actorUserId, users.id))
        .where(input.amendmentId ? eq(activityHistory.amendmentId, input.amendmentId) : undefined)
        .orderBy(desc(activityHistory.createdAt))
        .limit(input.limit);
    }),
});
