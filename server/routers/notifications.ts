import { and, eq, isNull, ne, or } from "drizzle-orm";
import {
  agingThresholds,
  amendmentRecords,
  clientRecords,
  notificationPreferences,
} from "../../drizzle/schema";
import { requireCapability } from "../authorization";
import { requireDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

const DAY_MS = 86_400_000;

function ageInDays(value: Date): number {
  return Math.max(0, Math.floor((Date.now() - value.getTime()) / DAY_MS));
}

export type OperationalAlert = {
  id: string;
  amendmentId: number;
  amendmentRecordId: string;
  clientName: string;
  category: "Assignment" | "Overdue" | "Client Signature" | "Document Request" | "EA Review";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  href: string;
  occurredAt: Date;
};

export const notificationsRouter = router({
  center: protectedProcedure.query(async ({ ctx }) => {
    requireCapability(ctx.user, "view");
    const db = await requireDb();
    const [preferenceRows, thresholds, rows] = await Promise.all([
      db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, ctx.user.id)).limit(1),
      db.select().from(agingThresholds),
      db
        .select({ amendment: amendmentRecords, clientName: clientRecords.clientName })
        .from(amendmentRecords)
        .innerJoin(clientRecords, eq(amendmentRecords.clientId, clientRecords.id))
        .where(
          and(
            ne(amendmentRecords.workflowStatus, "Closed"),
            isNull(amendmentRecords.mergedIntoAmendmentId),
            or(
              eq(amendmentRecords.currentOwnerId, ctx.user.id),
              eq(amendmentRecords.assignedPreparerId, ctx.user.id),
              eq(amendmentRecords.assignedEaReviewerId, ctx.user.id),
            ),
          ),
        ),
    ]);

    const preferences = preferenceRows[0] ?? {
      assignments: true,
      overdue: true,
      clientSignature: true,
      documentRequests: true,
      eaReview: true,
    };
    const alerts: OperationalAlert[] = [];

    for (const row of rows) {
      const record = row.amendment;
      const href = `/amendments/${record.id}`;
      const assignedToUser =
        record.currentOwnerId === ctx.user.id ||
        record.assignedPreparerId === ctx.user.id ||
        record.assignedEaReviewerId === ctx.user.id;

      const overdueThreshold = thresholds.find(item => item.workflowStatus === record.workflowStatus)?.overdueDays ?? 30;
      const overdueByDate = Boolean(record.dueDate && record.dueDate.getTime() < Date.now());
      const overdueByAging = ageInDays(record.lastWorkflowStatusChange) >= overdueThreshold;
      if (preferences.overdue && assignedToUser && (overdueByDate || overdueByAging)) {
        alerts.push({
          id: `overdue:${record.id}`,
          amendmentId: record.id,
          amendmentRecordId: record.amendmentRecordId,
          clientName: row.clientName,
          category: "Overdue",
          severity: "critical",
          title: `Overdue: ${row.clientName}`,
          detail: `${record.amendmentRecordId} · ${record.workflowStatus} · ${ageInDays(record.lastWorkflowStatusChange)} days in status`,
          href,
          occurredAt: record.lastWorkflowStatusChange,
        });
      }

      if (
        preferences.documentRequests &&
        record.workflowStatus === "With Client" &&
        record.lastClientRequestAt &&
        (!record.lastClientResponseAt || record.lastClientResponseAt.getTime() < record.lastClientRequestAt.getTime())
      ) {
        alerts.push({
          id: `documents:${record.id}`,
          amendmentId: record.id,
          amendmentRecordId: record.amendmentRecordId,
          clientName: row.clientName,
          category: "Document Request",
          severity: "warning",
          title: `Client response pending: ${row.clientName}`,
          detail: `${record.amendmentRecordId} · client request sent ${ageInDays(record.lastClientRequestAt)} days ago`,
          href,
          occurredAt: record.lastClientRequestAt,
        });
      }

      if (preferences.clientSignature && record.workflowStatus === "Ready for Signature" && !record.signatureReceivedAt) {
        alerts.push({
          id: `signature:${record.id}`,
          amendmentId: record.id,
          amendmentRecordId: record.amendmentRecordId,
          clientName: row.clientName,
          category: "Client Signature",
          severity: "warning",
          title: `Signature needed: ${row.clientName}`,
          detail: `${record.amendmentRecordId} is Ready for Signature`,
          href,
          occurredAt: record.lastWorkflowStatusChange,
        });
      }

      if (
        preferences.eaReview &&
        ["Ready for EA Review", "EA Review"].includes(record.workflowStatus) &&
        (record.assignedEaReviewerId === ctx.user.id || ["Admin", "EA Reviewer"].includes(ctx.user.role))
      ) {
        alerts.push({
          id: `ea-review:${record.id}`,
          amendmentId: record.id,
          amendmentRecordId: record.amendmentRecordId,
          clientName: row.clientName,
          category: "EA Review",
          severity: record.workflowStatus === "Ready for EA Review" ? "warning" : "info",
          title: `${record.workflowStatus}: ${row.clientName}`,
          detail: `${record.amendmentRecordId} · review queue`,
          href,
          occurredAt: record.lastWorkflowStatusChange,
        });
      }

      if (
        preferences.assignments &&
        assignedToUser &&
        !alerts.some(alert => alert.amendmentId === record.id && alert.category !== "Assignment")
      ) {
        alerts.push({
          id: `assignment:${record.id}`,
          amendmentId: record.id,
          amendmentRecordId: record.amendmentRecordId,
          clientName: row.clientName,
          category: "Assignment",
          severity: "info",
          title: `Assigned work: ${row.clientName}`,
          detail: `${record.amendmentRecordId} · ${record.workflowStatus}`,
          href,
          occurredAt: record.updatedAt,
        });
      }
    }

    const severityRank = { critical: 0, warning: 1, info: 2 } as const;
    alerts.sort((a, b) => {
      const severityDifference = severityRank[a.severity] - severityRank[b.severity];
      return severityDifference || b.occurredAt.getTime() - a.occurredAt.getTime();
    });

    return {
      generatedAt: new Date(),
      activeCount: alerts.length,
      criticalCount: alerts.filter(alert => alert.severity === "critical").length,
      alerts: alerts.slice(0, 30),
      preferences: {
        assignments: Boolean(preferences.assignments),
        overdue: Boolean(preferences.overdue),
        clientSignature: Boolean(preferences.clientSignature),
        documentRequests: Boolean(preferences.documentRequests),
        eaReview: Boolean(preferences.eaReview),
      },
    };
  }),
});
