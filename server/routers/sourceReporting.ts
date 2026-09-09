import { desc, eq, inArray } from "drizzle-orm";
import { canopyTaskClusters, canopyWorkGroups, importBatches, users } from "../../drizzle/schema";
import { requireCapability } from "../authorization";
import { requireDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

export const sourceReportingRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    requireCapability(ctx.user, "view");
    const db = await requireDb();
    const [groups, batches] = await Promise.all([
      db.select().from(canopyWorkGroups),
      db
        .select({ batch: importBatches, uploaderName: users.name, uploaderEmail: users.email })
        .from(importBatches)
        .leftJoin(users, eq(importBatches.uploaderId, users.id))
        .where(eq(importBatches.lane, "Canopy Task Import"))
        .orderBy(desc(importBatches.sourceExportedAt), desc(importBatches.startedAt))
        .limit(50),
    ]);
    const groupIds = groups.map(row => row.id);
    const clusters = groupIds.length
      ? await db.select().from(canopyTaskClusters).where(inArray(canopyTaskClusters.workGroupId, groupIds))
      : [];

    const byReturnType = new Map<string, number>();
    const byParentTask = new Map<string, number>();
    const byCanopyStatus = new Map<string, number>();
    const byTaxYear = new Map<number, number>();
    const bySourceAssignee = new Map<string, number>();

    for (const group of groups) {
      byReturnType.set(group.returnType, (byReturnType.get(group.returnType) ?? 0) + 1);
      byParentTask.set(group.parentTask, (byParentTask.get(group.parentTask) ?? 0) + 1);
    }
    for (const cluster of clusters) {
      const status = cluster.currentSourceStatus || "No status";
      byCanopyStatus.set(status, (byCanopyStatus.get(status) ?? 0) + 1);
      byTaxYear.set(cluster.taxYear, (byTaxYear.get(cluster.taxYear) ?? 0) + 1);
      for (const assignee of cluster.currentAssignees ?? []) {
        bySourceAssignee.set(assignee, (bySourceAssignee.get(assignee) ?? 0) + 1);
      }
    }

    const sortRows = <T extends { count: number }>(rows: T[]) => rows.sort((a, b) => b.count - a.count);
    return {
      generatedAt: new Date(),
      workGroupCount: groups.length,
      logicalTaskClusterCount: clusters.length,
      byReturnType: sortRows(Array.from(byReturnType, ([returnType, count]) => ({ returnType, count }))),
      byParentTask: sortRows(Array.from(byParentTask, ([parentTask, count]) => ({ parentTask, count }))),
      byCanopyStatus: sortRows(Array.from(byCanopyStatus, ([canopyStatus, count]) => ({ canopyStatus, count }))),
      byTaxYear: sortRows(Array.from(byTaxYear, ([taxYear, count]) => ({ taxYear, count }))),
      bySourceAssignee: sortRows(Array.from(bySourceAssignee, ([assignee, count]) => ({ assignee, count }))),
      batches: batches.map(({ batch, uploaderName, uploaderEmail }) => ({
        id: batch.id,
        batchId: batch.batchId,
        filename: batch.originalFilename,
        status: batch.status,
        sourceExportedAt: batch.sourceExportedAt,
        uploadedAt: batch.startedAt,
        uploadedBy: uploaderName || uploaderEmail || `User #${batch.uploaderId}`,
        sourceRows: batch.totalRows,
        clientCount: batch.clientCount,
        workGroupCount: batch.workGroupCount,
        logicalClusterCount: batch.logicalClusterCount,
        newCount: batch.newCount,
        changedCount: batch.changedCount,
        unchangedCount: batch.unchangedCount,
        olderSnapshotCount: batch.olderSnapshotCount,
        duplicateCount: batch.duplicateCount,
        conflictCount: batch.conflictCount,
        rejectedCount: batch.rejectedCount,
        fileHash: batch.fileHash,
        parserVersion: batch.parserVersion,
      })),
    };
  }),
});
