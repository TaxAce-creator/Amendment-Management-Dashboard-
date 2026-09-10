import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import {
  amendmentRecords,
  amendmentSourceLinks,
  canopyTaskClusters,
  canopyWorkGroups,
  clientRecords,
  taxYearRecords,
  users,
  type User,
} from "../../drizzle/schema.js";
import { PRIORITIES, WORKFLOW_STATUSES } from "../../shared/taxace.js";
import { requireCapability } from "../authorization.js";
import { requireDb } from "../db.js";
import { protectedProcedure, router } from "../_core/trpc.js";

const trackerInputSchema = z.object({
  search: z.string().trim().max(160).default(""),
  status: z.enum(WORKFLOW_STATUSES).optional(),
  includeClosed: z.boolean().default(false),
  taxYear: z.number().int().min(1990).max(new Date().getUTCFullYear() + 1).optional(),
  returnType: z.string().trim().max(160).optional(),
  preparerId: z.number().int().positive().optional(),
  ownerId: z.number().int().positive().optional(),
  priority: z.enum(PRIORITIES).optional(),
  agingMinDays: z.number().int().min(0).max(5000).optional(),
});

type TrackerInput = z.infer<typeof trackerInputSchema>;

type SourceContext = {
  workGroupId: number;
  parentTask: string;
  returnType: string;
  sourceClientName: string;
  lastSeenSourceExportedAt: Date | null;
  taxYears: number[];
  statuses: string[];
  assignees: string[];
  dueDates: string[];
  taskCount: number;
};

function ageDays(value: Date): number {
  return Math.max(0, Math.floor((Date.now() - value.getTime()) / 86_400_000));
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

async function userNameMap(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
  const db = await requireDb();
  const uniqueIds = Array.from(new Set(ids.filter((value): value is number => typeof value === "number")));
  if (!uniqueIds.length) return new Map<number, string>();
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, uniqueIds));
  return new Map(rows.map(row => [row.id, row.name || row.email]));
}

async function sourceContextByAmendment(amendmentIds: number[]): Promise<Map<number, SourceContext[]>> {
  const db = await requireDb();
  if (!amendmentIds.length) return new Map<number, SourceContext[]>();

  const links = await db
    .select({ amendmentId: amendmentSourceLinks.amendmentId, workGroup: canopyWorkGroups })
    .from(amendmentSourceLinks)
    .innerJoin(canopyWorkGroups, eq(amendmentSourceLinks.workGroupId, canopyWorkGroups.id))
    .where(inArray(amendmentSourceLinks.amendmentId, amendmentIds));
  const workGroupIds = Array.from(new Set(links.map(row => row.workGroup.id)));
  const clusters = workGroupIds.length
    ? await db.select().from(canopyTaskClusters).where(inArray(canopyTaskClusters.workGroupId, workGroupIds))
    : [];

  const result = new Map<number, SourceContext[]>();
  for (const link of links) {
    const tasks = clusters.filter(row => row.workGroupId === link.workGroup.id);
    const context: SourceContext = {
      workGroupId: link.workGroup.id,
      parentTask: link.workGroup.parentTask,
      returnType: link.workGroup.returnType,
      sourceClientName: link.workGroup.sourceClientName,
      lastSeenSourceExportedAt: link.workGroup.lastSeenSourceExportedAt,
      taxYears: Array.from(new Set(tasks.map(row => row.taxYear))).sort((a, b) => a - b),
      statuses: Array.from(new Set(tasks.map(row => row.currentSourceStatus).filter(Boolean))).sort(),
      assignees: Array.from(new Set(tasks.flatMap(row => row.currentAssignees ?? []).filter(Boolean))).sort(),
      dueDates: Array.from(
        new Set(tasks.map(row => row.currentDueDate).filter((value): value is string => Boolean(value))),
      ).sort(),
      taskCount: tasks.length,
    };
    result.set(link.amendmentId, [...(result.get(link.amendmentId) ?? []), context]);
  }
  return result;
}

async function loadTrackerRows(user: User, input: TrackerInput) {
  requireCapability(user, "view");
  const db = await requireDb();
  const conditions = [isNull(amendmentRecords.mergedIntoAmendmentId)];
  if (!input.includeClosed) conditions.push(ne(amendmentRecords.workflowStatus, "Closed"));
  if (input.status) conditions.push(eq(amendmentRecords.workflowStatus, input.status));
  if (input.preparerId) conditions.push(eq(amendmentRecords.assignedPreparerId, input.preparerId));
  if (input.ownerId) conditions.push(eq(amendmentRecords.currentOwnerId, input.ownerId));
  if (input.priority) conditions.push(eq(amendmentRecords.priority, input.priority));

  const baseRows = await db
    .select({ amendment: amendmentRecords, client: clientRecords })
    .from(amendmentRecords)
    .innerJoin(clientRecords, eq(amendmentRecords.clientId, clientRecords.id))
    .where(and(...conditions))
    .orderBy(desc(amendmentRecords.updatedAt));
  const ids = baseRows.map(row => row.amendment.id);
  const years = ids.length
    ? await db.select().from(taxYearRecords).where(inArray(taxYearRecords.amendmentId, ids))
    : [];
  const sourceMap = await sourceContextByAmendment(ids);
  const names = await userNameMap(
    baseRows.flatMap(row => [
      row.amendment.assignedPreparerId,
      row.amendment.assignedEaReviewerId,
      row.amendment.currentOwnerId,
    ]),
  );
  const needle = normalize(input.search);

  return baseRows
    .map(row => {
      const rowYears = years.filter(year => year.amendmentId === row.amendment.id);
      const sources = sourceMap.get(row.amendment.id) ?? [];
      const searchable = normalize(
        [
          row.client.clientName,
          row.client.clientId,
          row.amendment.amendmentRecordId,
          row.amendment.amendmentReason,
          row.amendment.workflowStatus,
          names.get(row.amendment.assignedPreparerId),
          names.get(row.amendment.assignedEaReviewerId ?? -1),
          names.get(row.amendment.currentOwnerId),
          ...rowYears.map(year => String(year.taxYear)),
          ...sources.flatMap(source => [
            source.parentTask,
            source.returnType,
            ...source.statuses,
            ...source.assignees,
          ]),
        ]
          .filter(Boolean)
          .join(" "),
      );
      return {
        ...row,
        taxYears: rowYears,
        assignedPreparerName: names.get(row.amendment.assignedPreparerId) ?? null,
        assignedEaReviewerName: row.amendment.assignedEaReviewerId
          ? names.get(row.amendment.assignedEaReviewerId) ?? null
          : null,
        currentOwnerName: names.get(row.amendment.currentOwnerId) ?? null,
        ageDays: ageDays(row.amendment.lastWorkflowStatusChange),
        sourceContexts: sources,
        searchable,
      };
    })
    .filter(row => !needle || row.searchable.includes(needle))
    .filter(row => !input.taxYear || row.taxYears.some(year => year.taxYear === input.taxYear))
    .filter(
      row =>
        !input.returnType ||
        row.sourceContexts.some(source => source.returnType === input.returnType) ||
        row.amendment.amendmentType === input.returnType,
    )
    .filter(row => input.agingMinDays === undefined || row.ageDays >= input.agingMinDays)
    .map(({ searchable: _searchable, ...row }) => row);
}

export const operationalViewsRouter = router({
  tracker: protectedProcedure
    .input(trackerInputSchema.default({ search: "", includeClosed: false }))
    .query(async ({ ctx, input }) => loadTrackerRows(ctx.user, input)),

  workspaceSource: protectedProcedure
    .input(z.object({ amendmentId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      requireCapability(ctx.user, "view");
      const db = await requireDb();
      const [record] = await db
        .select()
        .from(amendmentRecords)
        .where(eq(amendmentRecords.id, input.amendmentId))
        .limit(1);
      if (!record) return null;
      const names = await userNameMap([
        record.assignedPreparerId,
        record.assignedEaReviewerId,
        record.currentOwnerId,
      ]);
      const sources = await sourceContextByAmendment([input.amendmentId]);
      const sourceContexts = sources.get(input.amendmentId) ?? [];
      const workGroupIds = sourceContexts.map(source => source.workGroupId);
      const tasks = workGroupIds.length
        ? await db
            .select({
              id: canopyTaskClusters.id,
              workGroupId: canopyTaskClusters.workGroupId,
              task: canopyTaskClusters.task,
              taskType: canopyTaskClusters.taskType,
              taxYear: canopyTaskClusters.taxYear,
              returnType: canopyTaskClusters.returnType,
              canopyStatus: canopyTaskClusters.currentSourceStatus,
              dueDate: canopyTaskClusters.currentDueDate,
              assignees: canopyTaskClusters.currentAssignees,
              pinned: canopyTaskClusters.currentPinned,
              lastSeenSourceExportedAt: canopyTaskClusters.lastSeenSourceExportedAt,
            })
            .from(canopyTaskClusters)
            .where(inArray(canopyTaskClusters.workGroupId, workGroupIds))
        : [];
      return {
        assignedPreparerName: names.get(record.assignedPreparerId) ?? null,
        assignedEaReviewerName: record.assignedEaReviewerId
          ? names.get(record.assignedEaReviewerId) ?? null
          : null,
        currentOwnerName: names.get(record.currentOwnerId) ?? null,
        sourceContexts,
        tasks,
      };
    }),

  search: protectedProcedure
    .input(z.object({ query: z.string().trim().min(2).max(120) }))
    .query(async ({ ctx, input }) => {
      requireCapability(ctx.user, "view");
      const db = await requireDb();
      const needle = normalize(input.query);
      const trackerRows = await loadTrackerRows(ctx.user, { search: input.query, includeClosed: true });
      const workGroups = await db.select().from(canopyWorkGroups).orderBy(desc(canopyWorkGroups.updatedAt)).limit(500);
      const workGroupIds = workGroups.map(row => row.id);
      const clusters = workGroupIds.length
        ? await db.select().from(canopyTaskClusters).where(inArray(canopyTaskClusters.workGroupId, workGroupIds))
        : [];
      const clientIds = Array.from(new Set(workGroups.map(row => row.clientRecordId)));
      const clients = clientIds.length
        ? await db.select().from(clientRecords).where(inArray(clientRecords.id, clientIds))
        : [];
      const clientMap = new Map(clients.map(row => [row.id, row]));
      const sourceWorkGroups = workGroups
        .filter(row => {
          const groupTasks = clusters.filter(task => task.workGroupId === row.id);
          return normalize(
            [
              row.sourceClientName,
              row.parentTask,
              row.returnType,
              ...groupTasks.flatMap(task => [
                task.task,
                task.taskType,
                task.currentSourceStatus,
                String(task.taxYear),
                ...(task.currentAssignees ?? []),
              ]),
            ].join(" "),
          ).includes(needle);
        })
        .slice(0, 25)
        .map(row => ({
          id: row.id,
          clientRecordId: row.clientRecordId,
          taxaceClientRecordId: clientMap.get(row.clientRecordId)?.clientId ?? null,
          clientName: clientMap.get(row.clientRecordId)?.clientName ?? row.sourceClientName,
          parentTask: row.parentTask,
          returnType: row.returnType,
          lastSeenSourceExportedAt: row.lastSeenSourceExportedAt,
        }));
      return {
        amendments: trackerRows.slice(0, 30),
        sourceWorkGroups,
      };
    }),

  workQueue: protectedProcedure
    .input(
      z
        .object({ mode: z.enum(["My Queue", "Unassigned", "EA Review", "All Items"]).default("My Queue") })
        .default({ mode: "My Queue" }),
    )
    .query(async ({ ctx, input }) => {
      requireCapability(ctx.user, "view");
      const all = await loadTrackerRows(ctx.user, { search: "", includeClosed: false });
      if (input.mode === "My Queue") {
        return all.filter(
          row =>
            row.amendment.currentOwnerId === ctx.user.id ||
            row.amendment.assignedPreparerId === ctx.user.id ||
            row.amendment.assignedEaReviewerId === ctx.user.id,
        );
      }
      if (input.mode === "Unassigned") {
        return all.filter(row => !row.assignedPreparerName || !row.currentOwnerName);
      }
      if (input.mode === "EA Review") {
        return all.filter(row =>
          ["Ready for EA Review", "EA Review"].includes(row.amendment.workflowStatus),
        );
      }
      return all;
    }),

  sourceAnalysis: protectedProcedure.query(async ({ ctx }) => {
    requireCapability(ctx.user, "view");
    const db = await requireDb();
    const groups = await db.select().from(canopyWorkGroups);
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
      byCanopyStatus.set(
        cluster.currentSourceStatus,
        (byCanopyStatus.get(cluster.currentSourceStatus) ?? 0) + 1,
      );
      byTaxYear.set(cluster.taxYear, (byTaxYear.get(cluster.taxYear) ?? 0) + 1);
      for (const assignee of cluster.currentAssignees ?? []) {
        bySourceAssignee.set(assignee, (bySourceAssignee.get(assignee) ?? 0) + 1);
      }
    }
    const sortRows = <T extends { count: number }>(rows: T[]) => rows.sort((a, b) => b.count - a.count);
    return {
      workGroupCount: groups.length,
      logicalTaskClusterCount: clusters.length,
      byReturnType: sortRows(Array.from(byReturnType, ([returnType, count]) => ({ returnType, count }))),
      byParentTask: sortRows(Array.from(byParentTask, ([parentTask, count]) => ({ parentTask, count }))),
      byCanopyStatus: sortRows(Array.from(byCanopyStatus, ([canopyStatus, count]) => ({ canopyStatus, count }))),
      byTaxYear: sortRows(Array.from(byTaxYear, ([taxYear, count]) => ({ taxYear, count }))),
      bySourceAssignee: sortRows(Array.from(bySourceAssignee, ([assignee, count]) => ({ assignee, count }))),
    };
  }),
});
