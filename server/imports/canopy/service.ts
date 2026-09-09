import { createHash } from "node:crypto";
import { and, eq, isNull, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  amendmentRecords,
  canopyClientAliases,
  canopyTaskClusters,
  canopyTaskObservations,
  canopyWorkGroups,
  clientRecords as clientRecordsV2,
  importBatches as importBatchesV2,
  opportunityReviews as opportunityReviewsV2,
} from "../../../drizzle/schema";
import { writeActivity } from "../../activity";
import { requireDb } from "../../db";
import { storageReadBuffer } from "../../storage";
import { buildCanopyTaskPreview } from "./parser";
import type { CanopyImportPreview, CanopyRowAction, ParsedCanopyRow } from "./contract";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clientPublicId(): string {
  return `TA-CL-${nanoid(10).toUpperCase()}`;
}

function isIncomingAtLeastAsNew(incoming: Date, current: Date | null): boolean {
  return !current || incoming.getTime() >= current.getTime();
}

export function shouldCreatePendingReviewForImportedWorkGroup(input: {
  hasActiveReview: boolean;
  hasPriorReview: boolean;
  hasActiveAmendment: boolean;
  actions: readonly CanopyRowAction[];
}): boolean {
  if (input.hasActiveReview || input.hasActiveAmendment) return false;
  if (!input.hasPriorReview) return true;
  return input.actions.some(action => action === "New" || action === "Changed");
}

export async function loadCanopyPreviewForBatch(batchId: number): Promise<CanopyImportPreview> {
  const db = await requireDb();
  const [batch] = await db.select().from(importBatchesV2).where(eq(importBatchesV2.id, batchId)).limit(1);
  if (!batch) throw new Error("Import Batch not found.");
  if (batch.lane !== "Canopy Task Import") throw new Error("Import Batch is not a Canopy Task Import.");
  if (!batch.storageKey) throw new Error("The Canopy source file has not been uploaded yet.");
  if (!batch.sourceExportedAt) throw new Error("Source Exported At is required because it could not be derived from the Canopy filename.");

  const [buffer, existingClusters] = await Promise.all([
    storageReadBuffer(batch.storageKey),
    db.select({
      logicalKey: canopyTaskClusters.logicalKey,
      projectionHash: canopyTaskClusters.currentProjectionHash,
      sourceExportedAt: canopyTaskClusters.lastSeenSourceExportedAt,
    }).from(canopyTaskClusters),
  ]);

  return buildCanopyTaskPreview({
    filename: batch.originalFilename,
    buffer,
    sourceExportedAt: batch.sourceExportedAt,
    existingClusters,
  });
}

async function resolveClient(tx: any, row: ParsedCanopyRow, batchId: number): Promise<number> {
  const [alias] = await tx.select().from(canopyClientAliases).where(eq(canopyClientAliases.normalizedName, row.normalizedClient)).limit(1);
  if (alias) {
    await tx.update(canopyClientAliases).set({ sourceName: row.client, lastSeenBatchId: batchId }).where(eq(canopyClientAliases.id, alias.id));
    return alias.clientRecordId;
  }

  const exact = await tx.select().from(clientRecordsV2).where(eq(clientRecordsV2.normalizedClientName, row.normalizedClient));
  if (exact.length > 1) throw new Error(`Multiple TaxAce Client Records match the normalized Canopy client name "${row.client}". Create a controlled alias before importing.`);

  let clientRecordId: number;
  if (exact[0]) {
    clientRecordId = exact[0].id;
  } else {
    const inserted = await tx.insert(clientRecordsV2).values({
      clientId: clientPublicId(),
      clientName: row.client,
      normalizedClientName: row.normalizedClient,
      clientSinceDate: null,
      clientType: null,
      assignedReviewerId: null,
      opportunityStatus: "Pending Review",
      sourceImportBatchId: batchId,
    }).returning({ id: clientRecordsV2.id });
    const createdId = inserted[0]?.id;
    if (!createdId) throw new Error(`TaxAce Client Record could not be created for ${row.client}.`);
    clientRecordId = createdId;
  }

  await tx.insert(canopyClientAliases).values({
    sourceName: row.client,
    normalizedName: row.normalizedClient,
    clientRecordId,
    firstSeenBatchId: batchId,
    lastSeenBatchId: batchId,
  });
  return clientRecordId;
}

async function ensureWorkGroup(tx: any, row: ParsedCanopyRow, clientRecordId: number, batchId: number, sourceExportedAt: Date): Promise<number> {
  const keyHash = sha256(row.workGroupKey);
  const [existing] = await tx.select().from(canopyWorkGroups).where(eq(canopyWorkGroups.workGroupKeyHash, keyHash)).limit(1);
  if (existing) {
    if (existing.workGroupKey !== row.workGroupKey) throw new Error("Canopy Work Group key hash collision detected; import aborted without partial changes.");
    if (isIncomingAtLeastAsNew(sourceExportedAt, existing.lastSeenSourceExportedAt)) {
      await tx.update(canopyWorkGroups).set({
        clientRecordId,
        sourceClientName: row.client,
        normalizedClientName: row.normalizedClient,
        parentTask: row.parentTask,
        returnType: row.returnType,
        lastSeenBatchId: batchId,
        lastSeenSourceExportedAt: sourceExportedAt,
      }).where(eq(canopyWorkGroups.id, existing.id));
    }
    return existing.id;
  }

  const inserted = await tx.insert(canopyWorkGroups).values({
    workGroupKey: row.workGroupKey,
    workGroupKeyHash: keyHash,
    clientRecordId,
    sourceClientName: row.client,
    normalizedClientName: row.normalizedClient,
    parentTask: row.parentTask,
    returnType: row.returnType,
    firstSeenBatchId: batchId,
    lastSeenBatchId: batchId,
    lastSeenSourceExportedAt: sourceExportedAt,
  }).returning({ id: canopyWorkGroups.id });
  const createdId = inserted[0]?.id;
  if (!createdId) throw new Error(`Canopy Work Group could not be created for ${row.client} / ${row.parentTask}.`);
  return createdId;
}

async function ensureCluster(tx: any, representative: ParsedCanopyRow, workGroupId: number, multiplicity: number, batchId: number, sourceExportedAt: Date): Promise<number> {
  const keyHash = sha256(representative.logicalKey);
  const [existing] = await tx.select().from(canopyTaskClusters).where(eq(canopyTaskClusters.logicalKeyHash, keyHash)).limit(1);
  if (existing) {
    if (existing.logicalKey !== representative.logicalKey) throw new Error("Canopy logical task key hash collision detected; import aborted without partial changes.");
    if (isIncomingAtLeastAsNew(sourceExportedAt, existing.lastSeenSourceExportedAt)) {
      await tx.update(canopyTaskClusters).set({
        workGroupId,
        task: representative.task,
        taskType: representative.taskType,
        taxYear: representative.taxYear!,
        returnType: representative.returnType,
        currentSourceStatus: representative.sourceStatus,
        currentDueDate: representative.sourceDueDate,
        currentPinnedRaw: representative.sourcePinnedRaw,
        currentPinned: representative.sourcePinned,
        currentAssigneeRaw: representative.sourceAssigneeRaw,
        currentAssignees: representative.parsedAssignees,
        sourceMultiplicity: multiplicity,
        currentConflict: false,
        currentProjectionHash: representative.projectionHash,
        lastSeenBatchId: batchId,
        lastSeenSourceExportedAt: sourceExportedAt,
      }).where(eq(canopyTaskClusters.id, existing.id));
    }
    return existing.id;
  }

  const inserted = await tx.insert(canopyTaskClusters).values({
    workGroupId,
    logicalKey: representative.logicalKey,
    logicalKeyHash: keyHash,
    task: representative.task,
    taskType: representative.taskType,
    taxYear: representative.taxYear!,
    returnType: representative.returnType,
    currentSourceStatus: representative.sourceStatus,
    currentDueDate: representative.sourceDueDate,
    currentPinnedRaw: representative.sourcePinnedRaw,
    currentPinned: representative.sourcePinned,
    currentAssigneeRaw: representative.sourceAssigneeRaw,
    currentAssignees: representative.parsedAssignees,
    sourceMultiplicity: multiplicity,
    currentConflict: false,
    currentProjectionHash: representative.projectionHash,
    lastSeenBatchId: batchId,
    lastSeenSourceExportedAt: sourceExportedAt,
  }).returning({ id: canopyTaskClusters.id });
  const createdId = inserted[0]?.id;
  if (!createdId) throw new Error(`Canopy Task Cluster could not be created for source row ${representative.sourceRowNumber}.`);
  return createdId;
}

export async function commitCanopyTaskBatch(input: { batchId: number; actorUserId: number }): Promise<{ status: "Committed"; preview: CanopyImportPreview }> {
  const db = await requireDb();
  const preview = await loadCanopyPreviewForBatch(input.batchId);
  if (!preview.sourceExportedAt) throw new Error("Source Exported At is required before commit.");
  if (preview.counts.rejected > 0 || preview.counts.conflicts > 0) throw new Error("Commit is blocked until every rejected row and logical task conflict is corrected.");
  const sourceExportedAt = new Date(preview.sourceExportedAt);

  await db.transaction(async tx => {
    const [batch] = await tx.select().from(importBatchesV2).where(eq(importBatchesV2.id, input.batchId)).limit(1);
    if (!batch) throw new Error("Import Batch not found.");
    if (batch.status !== "Ready to Commit") throw new Error("Only a validated Canopy Task Import can be committed.");

    const clientIds = new Map<string, number>();
    const workGroupIds = new Map<string, number>();
    const clusterIds = new Map<string, number>();
    const rowsByLogicalKey = new Map<string, ParsedCanopyRow[]>();
    for (const row of preview.rows) {
      const values = rowsByLogicalKey.get(row.logicalKey) ?? [];
      values.push(row);
      rowsByLogicalKey.set(row.logicalKey, values);
    }

    for (const row of preview.rows) {
      if (row.action === "Rejected" || row.action === "Duplicate / Conflict") continue;

      let clientRecordId = clientIds.get(row.normalizedClient);
      if (!clientRecordId) {
        clientRecordId = await resolveClient(tx, row, batch.id);
        clientIds.set(row.normalizedClient, clientRecordId);
      }

      let workGroupId = workGroupIds.get(row.workGroupKey);
      if (!workGroupId) {
        workGroupId = await ensureWorkGroup(tx, row, clientRecordId, batch.id, sourceExportedAt);
        workGroupIds.set(row.workGroupKey, workGroupId);
      }

      let taskClusterId = clusterIds.get(row.logicalKey);
      if (!taskClusterId) {
        const logicalRows = rowsByLogicalKey.get(row.logicalKey) ?? [row];
        const representative = logicalRows[0] ?? row;
        taskClusterId = await ensureCluster(tx, representative, workGroupId, logicalRows.length, batch.id, sourceExportedAt);
        clusterIds.set(row.logicalKey, taskClusterId);
      }

      await tx.insert(canopyTaskObservations).values({
        importBatchId: batch.id,
        sourceRowNumber: row.sourceRowNumber,
        workGroupId,
        taskClusterId,
        outcome: row.action,
        pinned: row.sourcePinnedRaw,
        sourceStatus: row.sourceStatus,
        task: row.task,
        client: row.client,
        taskType: row.taskType,
        parentTask: row.parentTask,
        taxYear: row.taxYear,
        returnType: row.returnType,
        dueDate: row.sourceDueDate,
        assigneeRaw: row.sourceAssigneeRaw,
        parsedAssignees: row.parsedAssignees,
        workGroupKey: row.workGroupKey,
        workGroupKeyHash: sha256(row.workGroupKey),
        logicalKey: row.logicalKey,
        logicalKeyHash: sha256(row.logicalKey),
        rowHash: row.rowHash,
        projectionHash: row.projectionHash,
        rawRow: row.rawRow,
        extraColumns: row.extraColumns,
        sourceExportedAt,
      });
    }

    for (const [workGroupKey, workGroupId] of Array.from(workGroupIds.entries())) {
      const workGroupRows = preview.rows.filter(item => item.workGroupKey === workGroupKey && item.action !== "Rejected" && item.action !== "Duplicate / Conflict");
      const row = workGroupRows[0];
      if (!row) continue;
      const clientRecordId = clientIds.get(row.normalizedClient);
      if (!clientRecordId) continue;

      const reviews = await tx
        .select({ id: opportunityReviewsV2.id, active: opportunityReviewsV2.active })
        .from(opportunityReviewsV2)
        .where(eq(opportunityReviewsV2.sourceWorkGroupId, workGroupId));
      const hasActiveReview = reviews.some(review => review.active);

      const [activeAmendment] = await tx
        .select({ id: amendmentRecords.id })
        .from(amendmentRecords)
        .where(and(
          eq(amendmentRecords.clientId, clientRecordId),
          ne(amendmentRecords.workflowStatus, "Closed"),
          isNull(amendmentRecords.mergedIntoAmendmentId),
        ))
        .limit(1);

      const shouldCreate = shouldCreatePendingReviewForImportedWorkGroup({
        hasActiveReview,
        hasPriorReview: reviews.length > 0,
        hasActiveAmendment: Boolean(activeAmendment),
        actions: workGroupRows.map(item => item.action),
      });

      if (shouldCreate) {
        await tx.insert(opportunityReviewsV2).values({
          clientId: clientRecordId,
          sourceWorkGroupId: workGroupId,
          assignedReviewerId: null,
          opportunityStatus: "Pending Review",
          priority: "Medium",
          active: true,
        });
        await tx
          .update(clientRecordsV2)
          .set({ opportunityStatus: "Pending Review", sourceImportBatchId: batch.id })
          .where(eq(clientRecordsV2.id, clientRecordId));
      }
    }

    await tx.update(importBatchesV2).set({
      status: "Committed",
      normalizedHeaders: preview.headers,
      fileHash: preview.fileHash,
      sourceExportedAt,
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
      completedAt: new Date(),
      errorSummary: null,
    }).where(eq(importBatchesV2.id, batch.id));

    await writeActivity(tx, {
      actorType: "user",
      actorUserId: input.actorUserId,
      action: "Canopy Task Import committed",
      entityType: "Import Batch",
      entityId: batch.id,
      newValue: { batchId: batch.batchId, sourceExportedAt: preview.sourceExportedAt, counts: preview.counts },
      note: "Source observations were committed. No Amendment Record was created automatically.",
    });
  });

  return { status: "Committed", preview };
}
