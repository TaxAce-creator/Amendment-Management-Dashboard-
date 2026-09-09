import { and, desc, eq, inArray, isNull, like, ne, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as XLSX from "xlsx";
import { z } from "zod";
import {
  activityHistory,
  agingThresholds,
  amendmentRecords,
  clientRecords,
  opportunityReviews,
  savedViews,
  taxYearRecords,
  users,
} from "../../drizzle/schema";
import { hasCapability, WORKFLOW_STATUSES } from "../../shared/taxace";
import { writeActivity } from "../activity";
import { requireCapability } from "../authorization";
import { requireDb } from "../db";
import { storageGetSignedUrl, storagePut } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";

function daysBetween(start: Date, end = new Date()): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function currencyNumber(value: string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function buildOperationalSnapshot() {
  const db = await requireDb();
  const [amendments, opportunities, years, recent, thresholds, team] = await Promise.all([
    db
      .select({
        amendment: amendmentRecords,
        client: clientRecords,
        preparerName: users.name,
      })
      .from(amendmentRecords)
      .innerJoin(clientRecords, eq(amendmentRecords.clientId, clientRecords.id))
      .leftJoin(users, eq(amendmentRecords.assignedPreparerId, users.id))
      .where(isNull(amendmentRecords.mergedIntoAmendmentId)),
    db.select().from(opportunityReviews).where(eq(opportunityReviews.active, true)),
    db.select().from(taxYearRecords),
    db
      .select({ activity: activityHistory, actorName: users.name })
      .from(activityHistory)
      .leftJoin(users, eq(activityHistory.actorUserId, users.id))
      .orderBy(desc(activityHistory.createdAt))
      .limit(20),
    db.select().from(agingThresholds),
    db.select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active }).from(users),
  ]);
  return { amendments, opportunities, years, recent, thresholds, team };
}

function isOverdue(
  record: (typeof amendmentRecords.$inferSelect),
  thresholds: Array<typeof agingThresholds.$inferSelect>,
): boolean {
  if (record.workflowStatus === "Closed") return false;
  if (record.dueDate && record.dueDate.getTime() < Date.now()) return true;
  const threshold = thresholds.find(item => item.workflowStatus === record.workflowStatus)?.overdueDays ?? 30;
  return daysBetween(record.lastWorkflowStatusChange) >= threshold;
}

export const reportingRouter = router({
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    requireCapability(ctx.user, "view");
    const snapshot = await buildOperationalSnapshot();
    const active = snapshot.amendments.filter(item => item.amendment.workflowStatus !== "Closed");
    const closed = snapshot.amendments.filter(item => item.amendment.workflowStatus === "Closed");
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const clientResponseHours = snapshot.amendments
      .filter(item => item.amendment.lastClientRequestAt && item.amendment.lastClientResponseAt)
      .map(item =>
        Math.max(
          0,
          (item.amendment.lastClientResponseAt!.getTime() - item.amendment.lastClientRequestAt!.getTime()) / 3_600_000,
        ),
      );

    const pipeline = WORKFLOW_STATUSES.map(status => ({
      status,
      count: snapshot.amendments.filter(item => item.amendment.workflowStatus === status).length,
    }));
    const taxYearCounts = new Map<number, number>();
    for (const year of snapshot.years) taxYearCounts.set(year.taxYear, (taxYearCounts.get(year.taxYear) ?? 0) + 1);

    const workQueue = active
      .map(item => ({
        id: item.amendment.id,
        amendmentRecordId: item.amendment.amendmentRecordId,
        clientName: item.client.clientName,
        priority: item.amendment.priority,
        nextAction: item.amendment.nextAction,
        assigned: item.preparerName,
        workflowStatus: item.amendment.workflowStatus,
        age: daysBetween(item.amendment.lastWorkflowStatusChange),
        taxYears: snapshot.years.filter(year => year.amendmentId === item.amendment.id).map(year => year.taxYear),
      }))
      .sort((a, b) => (a.priority === b.priority ? b.age - a.age : a.priority === "High" ? -1 : 1))
      .slice(0, 12);

    return {
      generatedAt: new Date(),
      kpis: {
        activeAmendments: active.length,
        pendingReview: snapshot.opportunities.filter(item => item.opportunityStatus === "Pending Review").length,
        waitingOnClient: active.filter(item => item.amendment.workflowStatus === "With Client").length,
        waitingOnAgency: active.filter(item => item.amendment.workflowStatus === "Waiting on IRS / FTB").length,
        readyForEaReview: active.filter(item => item.amendment.workflowStatus === "Ready for EA Review").length,
        readyToFile: active.filter(item => item.amendment.workflowStatus === "Ready to File").length,
        overdue: active.filter(item => isOverdue(item.amendment, snapshot.thresholds)).length,
        closedThisMonth: closed.filter(item => item.amendment.dateClosed && item.amendment.dateClosed >= startOfMonth).length,
      },
      metrics: {
        estimatedRefunds: active.reduce(
          (sum, item) => sum + Math.max(0, currencyNumber(item.amendment.estimatedRefundBalanceDue)),
          0,
        ),
        estimatedBalancesDue: active.reduce(
          (sum, item) => sum + Math.abs(Math.min(0, currencyNumber(item.amendment.estimatedRefundBalanceDue))),
          0,
        ),
        averageDaysToComplete: average(
          closed
            .filter(item => item.amendment.dateClosed)
            .map(item => daysBetween(item.amendment.dateStarted, item.amendment.dateClosed!)),
        ),
        averageClientResponseHours: average(clientResponseHours),
      },
      pipeline,
      workQueue,
      recentActivity: snapshot.recent,
      taxYearDistribution: Array.from(taxYearCounts.entries())
        .map(([taxYear, count]) => ({ taxYear: taxYear.toString(), count }))
        .sort((a, b) => Number(a.taxYear) - Number(b.taxYear)),
      alerts: {
        overdue: active.filter(item => isOverdue(item.amendment, snapshot.thresholds)).length,
        unassigned: active.filter(item => !item.amendment.currentOwnerId).length,
        missingClientAction: active.filter(item => item.amendment.workflowStatus === "With Client" && !item.amendment.lastClientRequestAt).length,
        bottlenecks: pipeline.filter(item => item.status !== "Closed" && item.count >= 10),
      },
    };
  }),

  analytics: protectedProcedure.query(async ({ ctx }) => {
    requireCapability(ctx.user, "view");
    const snapshot = await buildOperationalSnapshot();
    const byPreparer = new Map<string, { active: number; closed: number }>();
    const reasons = new Map<string, number>();
    const monthly = new Map<string, number>();
    const sources = new Map<string, number>();
    const aging = WORKFLOW_STATUSES.map(status => ({ status, averageDays: 0, count: 0 }));

    for (const item of snapshot.amendments) {
      const name = item.preparerName ?? "Unassigned";
      const current = byPreparer.get(name) ?? { active: 0, closed: 0 };
      item.amendment.workflowStatus === "Closed" ? (current.closed += 1) : (current.active += 1);
      byPreparer.set(name, current);
      reasons.set(item.amendment.amendmentReason, (reasons.get(item.amendment.amendmentReason) ?? 0) + 1);
      const sourceLabel = item.amendment.triggerSourceId ? `Trigger Source #${item.amendment.triggerSourceId}` : "Not assigned";
      sources.set(sourceLabel, (sources.get(sourceLabel) ?? 0) + 1);
      const month = item.amendment.dateStarted.toISOString().slice(0, 7);
      monthly.set(month, (monthly.get(month) ?? 0) + 1);
      const bucket = aging.find(entry => entry.status === item.amendment.workflowStatus)!;
      bucket.averageDays += daysBetween(item.amendment.lastWorkflowStatusChange);
      bucket.count += 1;
    }

    const departmentPerformance = Array.from(byPreparer.entries()).map(([name, value]) => ({
      name,
      ...value,
      total: value.active + value.closed,
      closureRate: value.active + value.closed ? (value.closed / (value.active + value.closed)) * 100 : 0,
    }));
    const eaPerformance = snapshot.team
      .filter(member => member.active && ["EA Reviewer", "Admin"].includes(member.role))
      .map(member => {
        const assigned = snapshot.amendments.filter(item => item.amendment.assignedEaReviewerId === member.id);
        return {
          name: member.name ?? member.email ?? `User #${member.id}`,
          assigned: assigned.length,
          inReview: assigned.filter(item => ["Ready for EA Review", "EA Review"].includes(item.amendment.workflowStatus)).length,
          closed: assigned.filter(item => item.amendment.workflowStatus === "Closed").length,
        };
      });
    const turnaroundTimes = snapshot.amendments
      .filter(item => item.amendment.dateClosed)
      .map(item => ({
        id: item.amendment.amendmentRecordId,
        client: item.client.clientName,
        preparer: item.preparerName ?? "Unassigned",
        days: daysBetween(item.amendment.dateStarted, item.amendment.dateClosed!),
        closedAt: item.amendment.dateClosed!,
      }))
      .sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime());

    return {
      generatedAt: new Date(),
      departmentPerformance,
      preparerPerformance: departmentPerformance,
      eaPerformance,
      turnaroundTimes,
      monthlyVolume: Array.from(monthly.entries())
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      topAmendmentReasons: Array.from(reasons.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      sourceAnalysis: Array.from(sources.entries())
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count),
      workflowAging: aging.map(item => ({
        status: item.status,
        count: item.count,
        averageDays: item.count ? item.averageDays / item.count : 0,
      })),
      taxYearAnalysis: snapshot.years.reduce<Array<{ taxYear: number; count: number }>>((acc, item) => {
        const current = acc.find(entry => entry.taxYear === item.taxYear);
        if (current) current.count += 1;
        else acc.push({ taxYear: item.taxYear, count: 1 });
        return acc;
      }, []),
      productivity: departmentPerformance.map(item => ({
        name: item.name,
        active: item.active,
        closed: item.closed,
        total: item.total,
        closureRate: item.closureRate,
      })),
      operationalRows: snapshot.amendments.map(item => ({
        id: item.amendment.amendmentRecordId,
        client: item.client.clientName,
        status: item.amendment.workflowStatus,
        preparer: item.preparerName ?? "Unassigned",
        reason: item.amendment.amendmentReason,
        daysInStatus: daysBetween(item.amendment.lastWorkflowStatusChange),
      })),
    };
  }),

  workQueue: protectedProcedure
    .input(z.object({ mode: z.enum(["My Queue", "Unassigned", "EA Review", "All Items"]).default("My Queue") }).default({ mode: "My Queue" }))
    .query(async ({ ctx, input }) => {
      requireCapability(ctx.user, "view");
      const db = await requireDb();
      const conditions = [ne(amendmentRecords.workflowStatus, "Closed"), isNull(amendmentRecords.mergedIntoAmendmentId)];
      if (input.mode === "My Queue") conditions.push(eq(amendmentRecords.currentOwnerId, ctx.user.id));
      if (input.mode === "EA Review") {
        conditions.push(inArray(amendmentRecords.workflowStatus, ["Ready for EA Review", "EA Review"]));
      }
      const rows = await db
        .select({ amendment: amendmentRecords, client: clientRecords, ownerName: users.name })
        .from(amendmentRecords)
        .innerJoin(clientRecords, eq(amendmentRecords.clientId, clientRecords.id))
        .leftJoin(users, eq(amendmentRecords.currentOwnerId, users.id))
        .where(and(...conditions))
        .orderBy(desc(amendmentRecords.priority), amendmentRecords.dueDate);
      return input.mode === "Unassigned" ? rows.filter(row => !row.amendment.currentOwnerId) : rows;
    }),

  export: protectedProcedure
    .input(
      z.object({
        format: z.enum(["csv", "xlsx", "pdf"]),
        includeClosed: z.boolean().default(false),
        selectedIds: z.array(z.number().int().positive()).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "export");
      const db = await requireDb();
      const rows = await db
        .select({
          amendmentRecordId: amendmentRecords.amendmentRecordId,
          clientId: clientRecords.clientId,
          clientName: clientRecords.clientName,
          workflowStatus: amendmentRecords.workflowStatus,
          priority: amendmentRecords.priority,
          amendmentReason: amendmentRecords.amendmentReason,
          nextAction: amendmentRecords.nextAction,
          dateStarted: amendmentRecords.dateStarted,
          dateClosed: amendmentRecords.dateClosed,
          lastUpdated: amendmentRecords.updatedAt,
        })
        .from(amendmentRecords)
        .innerJoin(clientRecords, eq(amendmentRecords.clientId, clientRecords.id))
        .where(
          and(
            input.includeClosed ? undefined : ne(amendmentRecords.workflowStatus, "Closed"),
            input.selectedIds?.length ? inArray(amendmentRecords.id, input.selectedIds) : undefined,
          ),
        )
        .orderBy(desc(amendmentRecords.updatedAt));
      const flatRows = rows.map(row => ({
        "Amendment Record ID": row.amendmentRecordId,
        "Client ID": row.clientId,
        "Client Name": row.clientName,
        "Workflow Status": row.workflowStatus,
        Priority: row.priority,
        "Amendment Reason": row.amendmentReason,
        "Next Action": row.nextAction ?? "",
        "Date Started": row.dateStarted.toISOString(),
        "Date Closed": row.dateClosed?.toISOString() ?? "",
        "Last Updated": row.lastUpdated.toISOString(),
      }));

      const stamp = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
      let filename = `TaxAce-Amendments-${stamp}.${input.format}`;
      let contentType = "text/csv";
      let body: Buffer | string;

      if (input.format === "csv") {
        const sheet = XLSX.utils.json_to_sheet(flatRows);
        body = XLSX.utils.sheet_to_csv(sheet);
      } else if (input.format === "xlsx") {
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(flatRows), "Amendments");
        body = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
        contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      } else {
        const PDFDocument = (await import("pdfkit")).default;
        const doc = new PDFDocument({ margin: 40, size: "LETTER" });
        const chunks: Buffer[] = [];
        doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
        doc.fontSize(18).text("TaxAce Amendment Report");
        doc.moveDown(0.5).fontSize(9).fillColor("#56606F").text(`Generated ${new Date().toISOString()}`);
        doc.moveDown().fillColor("#111827");
        for (const row of flatRows) {
          doc.fontSize(10).text(`${row["Amendment Record ID"]} · ${row["Client Name"]} · ${row["Workflow Status"]}`);
          doc.fontSize(8).fillColor("#56606F").text(`Priority: ${row.Priority} · Reason: ${row["Amendment Reason"]}`);
          doc.moveDown(0.5).fillColor("#111827");
          if (doc.y > 700) doc.addPage();
        }
        doc.end();
        body = await new Promise<Buffer>((resolve, reject) => {
          doc.on("end", () => resolve(Buffer.concat(chunks)));
          doc.on("error", reject);
        });
        contentType = "application/pdf";
      }

      const stored = await storagePut(`taxace/exports/${ctx.user.id}/${filename}`, body, contentType);
      await writeActivity(db, {
        actorType: "user",
        actorUserId: ctx.user.id,
        action: "Operational report exported",
        entityType: "Report Export",
        newValue: {
          format: input.format,
          includeClosed: input.includeClosed,
          selectedIds: input.selectedIds ?? null,
          rowCount: flatRows.length,
        },
      });
      return { filename, url: await storageGetSignedUrl(stored.key) };
    }),
});

export const searchRouter = router({
  global: protectedProcedure
    .input(z.object({ query: z.string().trim().min(2).max(120) }))
    .query(async ({ ctx, input }) => {
      requireCapability(ctx.user, "view");
      const db = await requireDb();
      const clients = await db
        .select({ id: clientRecords.id, clientId: clientRecords.clientId, clientName: clientRecords.clientName })
        .from(clientRecords)
        .where(or(like(clientRecords.clientName, `%${input.query}%`), like(clientRecords.clientId, `%${input.query}%`)))
        .limit(15);
      const amendments = await db
        .select({
          id: amendmentRecords.id,
          amendmentRecordId: amendmentRecords.amendmentRecordId,
          amendmentReason: amendmentRecords.amendmentReason,
          workflowStatus: amendmentRecords.workflowStatus,
          clientName: clientRecords.clientName,
        })
        .from(amendmentRecords)
        .innerJoin(clientRecords, eq(amendmentRecords.clientId, clientRecords.id))
        .where(
          or(
            like(amendmentRecords.amendmentRecordId, `%${input.query}%`),
            like(amendmentRecords.amendmentReason, `%${input.query}%`),
            like(amendmentRecords.workflowStatus, `%${input.query}%`),
            like(clientRecords.clientName, `%${input.query}%`),
          ),
        )
        .limit(25);
      const numericYear = Number(input.query);
      const taxYears = Number.isInteger(numericYear)
        ? await db
            .select({ id: taxYearRecords.id, amendmentId: taxYearRecords.amendmentId, taxYear: taxYearRecords.taxYear })
            .from(taxYearRecords)
            .where(eq(taxYearRecords.taxYear, numericYear))
            .limit(15)
        : [];
      return { clients, amendments, taxYears };
    }),
});

export const savedViewsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    requireCapability(ctx.user, "view");
    const db = await requireDb();
    return db
      .select()
      .from(savedViews)
      .where(or(eq(savedViews.userId, ctx.user.id), eq(savedViews.shared, true)))
      .orderBy(savedViews.workspace, savedViews.name);
  }),
  save: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        workspace: z.enum(["Opportunity Center", "Amendment Tracker", "Pipeline", "Reporting & Analytics", "Work Queues"]),
        filters: z.record(z.string(), z.unknown()),
        visibleColumns: z.array(z.string()).nullable(),
        sortConfig: z.record(z.string(), z.unknown()).nullable(),
        grouping: z.record(z.string(), z.unknown()).nullable(),
        shared: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "view");
      if (input.shared) requireCapability(ctx.user, "manageSharedViews");
      const db = await requireDb();
      await db
        .insert(savedViews)
        .values({ userId: ctx.user.id, ...input })
        .onConflictDoUpdate({
          target: [savedViews.userId, savedViews.workspace, savedViews.name],
          set: {
            filters: input.filters,
            visibleColumns: input.visibleColumns,
            sortConfig: input.sortConfig,
            grouping: input.grouping,
            shared: input.shared,
          },
        });
      return { success: true } as const;
    }),
  remove: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    requireCapability(ctx.user, "view");
    const db = await requireDb();
    const [view] = await db.select().from(savedViews).where(eq(savedViews.id, input.id)).limit(1);
    if (!view) throw new TRPCError({ code: "NOT_FOUND", message: "Saved View not found." });
    if (view.userId !== ctx.user.id && !hasCapability(ctx.user.role, "manageSharedViews")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You may delete only your own Saved Views." });
    }
    await db.delete(savedViews).where(eq(savedViews.id, input.id));
    return { success: true } as const;
  }),
});
