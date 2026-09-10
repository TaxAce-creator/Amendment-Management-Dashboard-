import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { canopyTaskObservations, importBatchesV2 } from "../../drizzle/canopySchema.js";
import { users } from "../../drizzle/schema.js";
import { writeActivity } from "../activity.js";
import { requireCapability } from "../authorization.js";
import { requireDb } from "../db.js";
import { CANOPY_TASK_HEADERS } from "../imports/canopy/contract.js";
import { CanopyImportValidationError, parseCanopyExportTimestamp } from "../imports/canopy/parser.js";
import { commitCanopyTaskBatch, loadCanopyPreviewForBatch } from "../imports/canopy/service.js";
import { storageCreateUploadUrl, storageGetSignedUrl, storageHead, storagePut } from "../storage.js";
import { protectedProcedure, router } from "../_core/trpc.js";

function batchPublicId(): string {
  return `CAN-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function sanitizedFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function extension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function importMaxBytes(): number {
  const configured = Number(process.env.IMPORT_MAX_BYTES ?? 25 * 1024 * 1024);
  return Number.isFinite(configured) && configured > 0 ? configured : 25 * 1024 * 1024;
}

function reportCsv(rows: Array<typeof canopyTaskObservations.$inferSelect>): string {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = ["Source Row,Client,Parent Task,Task,Tax Year,Return Type,Canopy Status,Due Date,Assignee,Outcome"];
  for (const row of rows) {
    lines.push([
      row.sourceRowNumber,
      row.client,
      row.parentTask,
      row.task,
      row.taxYear,
      row.returnType,
      row.sourceStatus,
      row.dueDate,
      row.assigneeRaw,
      row.outcome,
    ].map(escape).join(","));
  }
  return lines.join("\n");
}

export const canopyImportsRouter = router({
  headerReference: protectedProcedure.query(({ ctx }) => {
    requireCapability(ctx.user, "view");
    return {
      filename: "Canopy_Task_Export_Header_Reference.csv",
      contentType: "text/csv",
      headers: CANOPY_TASK_HEADERS,
      content: CANOPY_TASK_HEADERS.join(",") + "\n",
    };
  }),

  createUpload: protectedProcedure
    .input(z.object({
      filename: z.string().trim().min(1).max(255),
      contentType: z.string().trim().min(1).max(120).default("application/octet-stream"),
      sourceExportedAt: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "import");
      if (![".csv", ".xlsx"].includes(extension(input.filename))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Canopy Task Import supports .csv and .xlsx files only." });
      }
      const explicit = input.sourceExportedAt ? new Date(input.sourceExportedAt) : null;
      const inferred = parseCanopyExportTimestamp(input.filename);
      const sourceExportedAt = explicit ?? inferred;
      const db = await requireDb();
      const publicId = batchPublicId();
      const storageKey = `taxace/canopy-imports/${publicId}/${sanitizedFilename(input.filename)}`;
      const upload = await storageCreateUploadUrl(storageKey, input.contentType);
      const inserted = await db.insert(importBatchesV2).values({
        batchId: publicId,
        lane: "Canopy Task Import",
        uploaderId: ctx.user.id,
        originalFilename: input.filename,
        contentType: input.contentType,
        storageKey: upload.key,
        status: "Uploaded",
        sourceExportedAt,
        sourceExportedAtConfirmed: Boolean(explicit),
      }).returning({ id: importBatchesV2.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error("Canopy Import Batch could not be created.");
      await writeActivity(db, {
        actorType: "user",
        actorUserId: ctx.user.id,
        action: "Canopy Task Import upload created",
        entityType: "Import Batch",
        entityId: id,
        newValue: { batchId: publicId, filename: input.filename, sourceExportedAt: sourceExportedAt?.toISOString() ?? null },
      });
      return {
        id,
        batchId: publicId,
        uploadUrl: upload.uploadUrl,
        storageKey: upload.key,
        sourceExportedAt: sourceExportedAt?.toISOString() ?? null,
        sourceExportedAtInferred: Boolean(!explicit && inferred),
        sourceExportedAtRequired: !sourceExportedAt,
        maxBytes: importMaxBytes(),
      };
    }),

  setSourceExportedAt: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), sourceExportedAt: z.string().datetime() }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "import");
      const db = await requireDb();
      const [batch] = await db.select().from(importBatchesV2).where(eq(importBatchesV2.id, input.id)).limit(1);
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Import Batch not found." });
      if (["Committed", "Cancelled"].includes(batch.status)) {
        throw new TRPCError({ code: "CONFLICT", message: "Source Exported At cannot be changed after the batch is finalized." });
      }
      await db.update(importBatchesV2).set({
        sourceExportedAt: new Date(input.sourceExportedAt),
        sourceExportedAtConfirmed: true,
      }).where(eq(importBatchesV2.id, input.id));
      return { success: true } as const;
    }),

  validate: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "import");
      const db = await requireDb();
      const [batch] = await db.select().from(importBatchesV2).where(eq(importBatchesV2.id, input.id)).limit(1);
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Import Batch not found." });
      if (!batch.storageKey) throw new TRPCError({ code: "BAD_REQUEST", message: "The source file has not been uploaded." });
      if (!batch.sourceExportedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Enter Source Exported At because it could not be derived from the Canopy filename." });
      }
      try {
        const object = await storageHead(batch.storageKey);
        if (object.contentLength <= 0) throw new CanopyImportValidationError("The uploaded Canopy file is empty.");
        if (object.contentLength > importMaxBytes()) {
          throw new CanopyImportValidationError(`The uploaded Canopy file exceeds the ${importMaxBytes()} byte import limit.`);
        }
        await db.update(importBatchesV2).set({ status: "Validating", errorSummary: null }).where(eq(importBatchesV2.id, batch.id));
        const preview = await loadCanopyPreviewForBatch(batch.id);
        const blocked = preview.counts.rejected > 0 || preview.counts.conflicts > 0;
        await db.update(importBatchesV2).set({
          status: blocked ? "Completed with Errors" : "Ready to Commit",
          normalizedHeaders: preview.headers,
          fileHash: preview.fileHash,
          sourceExportedAt: preview.sourceExportedAt ? new Date(preview.sourceExportedAt) : batch.sourceExportedAt,
          headerFingerprint: preview.headerFingerprint,
          parserVersion: preview.parserVersion,
          totalRows: preview.counts.totalRows,
          acceptedCount: preview.counts.acceptedRows,
          newCount: preview.counts.new,
          changedCount: preview.counts.changed,
          unchangedCount: preview.counts.unchanged,
          olderSnapshotCount: preview.counts.olderSnapshots,
          duplicateCount: preview.counts.duplicateOccurrences,
          conflictCount: preview.counts.conflicts,
          rejectedCount: preview.counts.rejected,
          clientCount: preview.counts.clients,
          workGroupCount: preview.counts.workGroups,
          logicalClusterCount: preview.counts.logicalClusters,
          errorSummary: blocked ? "Commit blocked: correct rejected rows or conflicting logical task rows and validate a new export." : null,
          completedAt: blocked ? new Date() : null,
        }).where(eq(importBatchesV2.id, batch.id));
        await writeActivity(db, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: blocked ? "Canopy Task Import validation completed with errors" : "Canopy Task Import validated",
          entityType: "Import Batch",
          entityId: batch.id,
          newValue: { batchId: batch.batchId, counts: preview.counts },
          note: preview.extraHeaders.length ? `Extra source columns preserved: ${preview.extraHeaders.join(", ")}.` : undefined,
        });
        return preview;
      } catch (error) {
        const message = error instanceof Error ? error.message : "The Canopy Task Import could not be validated.";
        await db.update(importBatchesV2).set({ status: "Failed", errorSummary: message, completedAt: new Date() }).where(eq(importBatchesV2.id, batch.id));
        if (error instanceof CanopyImportValidationError || message.includes("Source Exported At")) {
          throw new TRPCError({ code: "BAD_REQUEST", message });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  commit: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "import");
      try {
        const result = await commitCanopyTaskBatch({ batchId: input.id, actorUserId: ctx.user.id });
        return { success: true, status: result.status, counts: result.preview.counts };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Canopy Task Import commit failed.";
        throw new TRPCError({ code: message.includes("blocked") || message.includes("validated") ? "CONFLICT" : "INTERNAL_SERVER_ERROR", message });
      }
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "import");
      const db = await requireDb();
      const [batch] = await db.select().from(importBatchesV2).where(eq(importBatchesV2.id, input.id)).limit(1);
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Import Batch not found." });
      if (!["Uploaded", "Ready to Commit", "Failed", "Completed with Errors"].includes(batch.status)) {
        throw new TRPCError({ code: "CONFLICT", message: "This batch can no longer be cancelled." });
      }
      await db.update(importBatchesV2).set({ status: "Cancelled", completedAt: new Date() }).where(eq(importBatchesV2.id, batch.id));
      await writeActivity(db, {
        actorType: "user",
        actorUserId: ctx.user.id,
        action: "Canopy Task Import cancelled",
        entityType: "Import Batch",
        entityId: batch.id,
        newValue: { batchId: batch.batchId, outcome: "Cancelled" },
      });
      return { success: true } as const;
    }),

  history: protectedProcedure.query(async ({ ctx }) => {
    requireCapability(ctx.user, "import");
    const db = await requireDb();
    return db.select({ batch: importBatchesV2, uploaderName: users.name })
      .from(importBatchesV2)
      .leftJoin(users, eq(importBatchesV2.uploaderId, users.id))
      .where(eq(importBatchesV2.lane, "Canopy Task Import"))
      .orderBy(desc(importBatchesV2.startedAt))
      .limit(200);
  }),

  details: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      requireCapability(ctx.user, "import");
      const db = await requireDb();
      const [batch] = await db.select().from(importBatchesV2).where(eq(importBatchesV2.id, input.id)).limit(1);
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Import Batch not found." });
      const rows = batch.status === "Committed"
        ? await db.select().from(canopyTaskObservations).where(eq(canopyTaskObservations.importBatchId, batch.id))
        : [];
      return { batch, rows };
    }),

  resultReport: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      requireCapability(ctx.user, "import");
      const db = await requireDb();
      const [batch] = await db.select().from(importBatchesV2).where(eq(importBatchesV2.id, input.id)).limit(1);
      if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "Import Batch not found." });
      if (batch.resultReportKey) {
        return { url: await storageGetSignedUrl(batch.resultReportKey), filename: `${batch.batchId}-results.csv` };
      }
      if (batch.status !== "Committed") throw new TRPCError({ code: "CONFLICT", message: "A result report is available after commit." });
      const rows = await db.select().from(canopyTaskObservations).where(eq(canopyTaskObservations.importBatchId, batch.id));
      const artifact = await storagePut(`taxace/import-results/${batch.batchId}-results.csv`, reportCsv(rows), "text/csv");
      await db.update(importBatchesV2).set({ resultReportKey: artifact.key }).where(eq(importBatchesV2.id, batch.id));
      return { url: artifact.url, filename: `${batch.batchId}-results.csv` };
    }),
});
