import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { opportunityAuditDetails } from "../../drizzle/auditProSchema";
import {
  amendmentRecords,
  amendmentSourceLinks,
  assignments,
  canopyTaskClusters,
  canopyTaskObservations,
  canopyWorkGroups,
  clientRecords,
  importBatches,
  opportunityReviews,
  taxYearRecords,
  users,
} from "../../drizzle/schema";
import {
  activeCoverageKey,
  hasCapability,
  OPPORTUNITY_STATUSES,
  PRIORITIES,
} from "../../shared/taxace";
import { writeActivity } from "../activity";
import { requireCapability } from "../authorization";
import { requireDb } from "../db";
import { validateCreationTaxYears } from "../transactionPolicy";
import { protectedProcedure, router } from "../_core/trpc";

const recommendationSchema = z.enum([
  "Recommend Amendment",
  "Additional Review Required",
  "Awaiting Documentation",
  "No Amendment Recommended",
]);
const prioritySchema = z.enum(PRIORITIES);
const outcomeSchema = z.enum(["No Amendment Needed", "Deferred", "Ready to Create Amendment"]);
const jurisdictionSchema = z.enum(["Federal", "California", "Federal & California", "Other State"]);

const auditFieldsSchema = z.object({
  recommendation: recommendationSchema.nullable(),
  priority: prioritySchema,
  amendmentReasonSummary: z.string().trim().max(4000).nullable(),
  documentsReceivedSummary: z.string().trim().max(4000).nullable(),
  documentsNeededSummary: z.string().trim().max(4000).nullable(),
  amendmentAssessment: z.string().trim().max(8000).nullable(),
  riskIssueNotes: z.string().trim().max(8000).nullable(),
  reviewNotes: z.string().trim().max(8000).nullable(),
  estimatedTaxImpact: z.number().finite().nullable(),
});

function publicRecordId(): string {
  return `TA-${new Date().getUTCFullYear()}-${nanoid(7).toUpperCase()}`;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

async function upsertAuditDetails(
  tx: Awaited<ReturnType<typeof requireDb>>,
  input: {
    opportunityReviewId: number;
    actorUserId: number;
    riskIssueNotes?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
  },
) {
  const [existing] = await tx
    .select()
    .from(opportunityAuditDetails)
    .where(eq(opportunityAuditDetails.opportunityReviewId, input.opportunityReviewId))
    .limit(1);

  if (existing) {
    await tx
      .update(opportunityAuditDetails)
      .set({
        riskIssueNotes: input.riskIssueNotes === undefined ? existing.riskIssueNotes : input.riskIssueNotes,
        auditStartedAt: input.startedAt === undefined ? existing.auditStartedAt : input.startedAt,
        auditCompletedAt: input.completedAt === undefined ? existing.auditCompletedAt : input.completedAt,
        updatedById: input.actorUserId,
      })
      .where(eq(opportunityAuditDetails.id, existing.id));
    return;
  }

  await tx.insert(opportunityAuditDetails).values({
    opportunityReviewId: input.opportunityReviewId,
    riskIssueNotes: input.riskIssueNotes ?? null,
    auditStartedAt: input.startedAt ?? null,
    auditCompletedAt: input.completedAt ?? null,
    updatedById: input.actorUserId,
  });
}

async function loadSourceContext(db: Awaited<ReturnType<typeof requireDb>>, sourceWorkGroupId: number | null) {
  if (!sourceWorkGroupId) return null;

  const [workGroup] = await db
    .select()
    .from(canopyWorkGroups)
    .where(eq(canopyWorkGroups.id, sourceWorkGroupId))
    .limit(1);
  if (!workGroup) return null;

  const clusters = await db
    .select()
    .from(canopyTaskClusters)
    .where(eq(canopyTaskClusters.workGroupId, sourceWorkGroupId))
    .orderBy(canopyTaskClusters.taxYear, canopyTaskClusters.task);

  const [batch] = await db
    .select()
    .from(importBatches)
    .where(eq(importBatches.id, workGroup.lastSeenBatchId))
    .limit(1);

  const sourceRows = await db
    .select()
    .from(canopyTaskObservations)
    .where(
      and(
        eq(canopyTaskObservations.workGroupId, sourceWorkGroupId),
        eq(canopyTaskObservations.importBatchId, workGroup.lastSeenBatchId),
      ),
    )
    .orderBy(canopyTaskObservations.sourceRowNumber);

  return {
    workGroup,
    taxYears: unique(clusters.map(cluster => cluster.taxYear)).sort((a, b) => a - b),
    currentTasks: clusters.map(cluster => ({
      id: cluster.id,
      task: cluster.task,
      taskType: cluster.taskType,
      taxYear: cluster.taxYear,
      returnType: cluster.returnType,
      canopyStatus: cluster.currentSourceStatus,
      dueDate: cluster.currentDueDate,
      assignees: cluster.currentAssignees,
      assigneeRaw: cluster.currentAssigneeRaw,
      pinned: cluster.currentPinned,
      pinnedRaw: cluster.currentPinnedRaw,
      conflict: cluster.currentConflict,
      sourceMultiplicity: cluster.sourceMultiplicity,
    })),
    provenance: batch
      ? {
          importBatchId: batch.id,
          batchId: batch.batchId,
          filename: batch.originalFilename,
          sourceExportedAt: batch.sourceExportedAt,
          parserVersion: batch.parserVersion,
          fileHash: batch.fileHash,
        }
      : null,
    sourceRows: sourceRows.map(row => ({
      sourceRowNumber: row.sourceRowNumber,
      task: row.task,
      taskType: row.taskType,
      taxYear: row.taxYear,
      canopyStatus: row.sourceStatus,
      dueDate: row.dueDate,
      assigneeRaw: row.assigneeRaw,
      pinned: row.pinned,
      outcome: row.outcome,
    })),
  };
}

async function loadAuditContext(db: Awaited<ReturnType<typeof requireDb>>, id: number) {
  const [base] = await db
    .select({
      opportunity: opportunityReviews,
      client: clientRecords,
      reviewerName: users.name,
      reviewerEmail: users.email,
    })
    .from(opportunityReviews)
    .innerJoin(clientRecords, eq(opportunityReviews.clientId, clientRecords.id))
    .leftJoin(users, eq(opportunityReviews.assignedReviewerId, users.id))
    .where(eq(opportunityReviews.id, id))
    .limit(1);

  if (!base) throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity Review not found." });

  const [detail] = await db
    .select()
    .from(opportunityAuditDetails)
    .where(eq(opportunityAuditDetails.opportunityReviewId, id))
    .limit(1);

  return {
    ...base,
    auditDetail: detail ?? null,
    source: await loadSourceContext(db, base.opportunity.sourceWorkGroupId),
  };
}

export const auditProRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(160).default(""),
          status: z.enum(OPPORTUNITY_STATUSES).optional(),
        })
        .default({ search: "" }),
    )
    .query(async ({ ctx, input }) => {
      requireCapability(ctx.user, "view");
      const db = await requireDb();
      const conditions = [eq(opportunityReviews.active, true)];
      if (input.status) conditions.push(eq(opportunityReviews.opportunityStatus, input.status));
      if (input.search) {
        conditions.push(
          or(like(clientRecords.clientName, `%${input.search}%`), like(clientRecords.clientId, `%${input.search}%`))!,
        );
      }

      const rows = await db
        .select({
          opportunity: opportunityReviews,
          client: clientRecords,
          reviewerName: users.name,
          sourceWorkGroup: canopyWorkGroups,
        })
        .from(opportunityReviews)
        .innerJoin(clientRecords, eq(opportunityReviews.clientId, clientRecords.id))
        .leftJoin(users, eq(opportunityReviews.assignedReviewerId, users.id))
        .leftJoin(canopyWorkGroups, eq(opportunityReviews.sourceWorkGroupId, canopyWorkGroups.id))
        .where(and(...conditions))
        .orderBy(desc(opportunityReviews.updatedAt));

      const workGroupIds = unique(
        rows.map(row => row.sourceWorkGroup?.id).filter((value): value is number => typeof value === "number"),
      );
      const clusters = workGroupIds.length
        ? await db.select().from(canopyTaskClusters).where(inArray(canopyTaskClusters.workGroupId, workGroupIds))
        : [];

      return rows.map(row => {
        const sourceTasks = row.sourceWorkGroup
          ? clusters.filter(cluster => cluster.workGroupId === row.sourceWorkGroup?.id)
          : [];
        return {
          ...row,
          sourceSummary: row.sourceWorkGroup
            ? {
                taxYears: unique(sourceTasks.map(task => task.taxYear)).sort((a, b) => a - b),
                taskCount: sourceTasks.length,
                statuses: unique(sourceTasks.map(task => task.currentSourceStatus).filter(Boolean)),
                assignees: unique(sourceTasks.flatMap(task => task.currentAssignees ?? [])),
                dueDates: unique(sourceTasks.map(task => task.currentDueDate).filter((value): value is string => Boolean(value))),
              }
            : null,
        };
      });
    }),

  context: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      requireCapability(ctx.user, "view");
      const db = await requireDb();
      return loadAuditContext(db, input.id);
    }),

  launch: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "reviewOpportunity");
      const db = await requireDb();
      return db.transaction(async tx => {
        const [review] = await tx.select().from(opportunityReviews).where(eq(opportunityReviews.id, input.id)).limit(1);
        if (!review || !review.active) {
          throw new TRPCError({ code: "CONFLICT", message: "This Opportunity Review is no longer active." });
        }
        const [detail] = await tx
          .select()
          .from(opportunityAuditDetails)
          .where(eq(opportunityAuditDetails.opportunityReviewId, review.id))
          .limit(1);
        await upsertAuditDetails(tx as any, {
          opportunityReviewId: review.id,
          actorUserId: ctx.user.id,
          startedAt: detail?.auditStartedAt ?? new Date(),
        });
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: detail ? "Amendment Audit Pro reopened" : "Amendment Audit Pro opened",
          entityType: "Opportunity Review",
          entityId: review.id,
          clientId: review.clientId,
          previousValue: { status: review.opportunityStatus },
          newValue: { status: review.opportunityStatus },
          note: "Opening Audit Pro does not change Opportunity Status.",
        });
        return { success: true, status: review.opportunityStatus } as const;
      });
    }),

  save: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }).merge(auditFieldsSchema))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "reviewOpportunity");
      const db = await requireDb();
      return db.transaction(async tx => {
        const [review] = await tx.select().from(opportunityReviews).where(eq(opportunityReviews.id, input.id)).limit(1);
        if (!review || !review.active) {
          throw new TRPCError({ code: "CONFLICT", message: "This Opportunity Review is no longer active." });
        }
        const nextStatus = review.opportunityStatus === "Pending Review" ? "Under Review" : review.opportunityStatus;
        const statusChanged = nextStatus !== review.opportunityStatus;
        const assignedReviewerId = review.assignedReviewerId ?? ctx.user.id;
        await tx
          .update(opportunityReviews)
          .set({
            opportunityStatus: nextStatus,
            assignedReviewerId,
            recommendation: input.recommendation,
            priority: input.priority,
            amendmentReasonSummary: input.amendmentReasonSummary,
            documentsReceivedSummary: input.documentsReceivedSummary,
            documentsNeededSummary: input.documentsNeededSummary,
            amendmentAssessment: input.amendmentAssessment,
            reviewNotes: input.reviewNotes,
            estimatedTaxImpact: input.estimatedTaxImpact?.toString() ?? null,
          })
          .where(eq(opportunityReviews.id, review.id));
        await tx.update(clientRecords).set({ opportunityStatus: nextStatus }).where(eq(clientRecords.id, review.clientId));
        const [detail] = await tx
          .select()
          .from(opportunityAuditDetails)
          .where(eq(opportunityAuditDetails.opportunityReviewId, review.id))
          .limit(1);
        await upsertAuditDetails(tx as any, {
          opportunityReviewId: review.id,
          actorUserId: ctx.user.id,
          riskIssueNotes: input.riskIssueNotes,
          startedAt: detail?.auditStartedAt ?? new Date(),
        });
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: statusChanged ? "Opportunity Review moved to Under Review" : "Amendment Audit Pro draft saved",
          entityType: "Opportunity Review",
          entityId: review.id,
          clientId: review.clientId,
          previousValue: { status: review.opportunityStatus, assignedReviewerId: review.assignedReviewerId },
          newValue: { status: nextStatus, assignedReviewerId, recommendation: input.recommendation, priority: input.priority },
          note: statusChanged ? "Triggered by the first Audit Pro draft save." : undefined,
        });
        return { success: true, status: nextStatus, statusChanged } as const;
      });
    }),

  complete: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), outcome: outcomeSchema }).merge(auditFieldsSchema))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "reviewOpportunity");
      if (input.outcome === "Ready to Create Amendment") {
        if (!input.amendmentReasonSummary?.trim()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Amendment Reason is required before an amendment can be created." });
        }
        if (!input.amendmentAssessment?.trim()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Amendment Assessment is required before an amendment can be created." });
        }
        if (!input.recommendation) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Recommendation is required before an amendment can be created." });
        }
      }

      const db = await requireDb();
      await db.transaction(async tx => {
        const [review] = await tx.select().from(opportunityReviews).where(eq(opportunityReviews.id, input.id)).limit(1);
        if (!review || !review.active) {
          throw new TRPCError({ code: "CONFLICT", message: "This Opportunity Review is no longer active." });
        }
        const closesReview = input.outcome === "No Amendment Needed" || input.outcome === "Deferred";
        const assignedReviewerId = review.assignedReviewerId ?? ctx.user.id;
        await tx
          .update(opportunityReviews)
          .set({
            opportunityStatus: input.outcome,
            assignedReviewerId,
            recommendation: input.recommendation,
            priority: input.priority,
            amendmentReasonSummary: input.amendmentReasonSummary,
            documentsReceivedSummary: input.documentsReceivedSummary,
            documentsNeededSummary: input.documentsNeededSummary,
            amendmentAssessment: input.amendmentAssessment,
            reviewNotes: input.reviewNotes,
            estimatedTaxImpact: input.estimatedTaxImpact?.toString() ?? null,
            amendmentOpportunity: input.outcome === "Ready to Create Amendment" ? true : input.outcome === "No Amendment Needed" ? false : null,
            reviewCompletionDate: new Date(),
            active: !closesReview,
          })
          .where(eq(opportunityReviews.id, review.id));
        await tx.update(clientRecords).set({ opportunityStatus: input.outcome }).where(eq(clientRecords.id, review.clientId));
        const [detail] = await tx
          .select()
          .from(opportunityAuditDetails)
          .where(eq(opportunityAuditDetails.opportunityReviewId, review.id))
          .limit(1);
        await upsertAuditDetails(tx as any, {
          opportunityReviewId: review.id,
          actorUserId: ctx.user.id,
          riskIssueNotes: input.riskIssueNotes,
          startedAt: detail?.auditStartedAt ?? new Date(),
          completedAt: new Date(),
        });
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: `Amendment Audit Pro completed: ${input.outcome}`,
          entityType: "Opportunity Review",
          entityId: review.id,
          clientId: review.clientId,
          previousValue: { status: review.opportunityStatus, assignedReviewerId: review.assignedReviewerId },
          newValue: { status: input.outcome, assignedReviewerId, recommendation: input.recommendation, priority: input.priority },
        });
      });
      return { success: true } as const;
    }),

  createAmendment: protectedProcedure
    .input(
      z.object({
        opportunityReviewId: z.number().int().positive(),
        amendmentReason: z.string().trim().min(3).max(8000),
        amendmentAssessment: z.string().trim().min(3).max(8000),
        riskIssueNotes: z.string().trim().max(8000).nullable(),
        amendmentType: z.string().trim().min(1).max(160),
        taxYears: z
          .array(
            z.object({
              taxYear: z.number().int().min(1990).max(new Date().getUTCFullYear() + 1),
              jurisdiction: jurisdictionSchema,
            }),
          )
          .min(1, "At least one Tax Year Record is required."),
        assignedPreparerId: z.number().int().positive(),
        currentOwnerId: z.number().int().positive(),
        assignedEaReviewerId: z.number().int().positive().nullable(),
        priority: prioritySchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "createAmendment");
      const creationPlan = validateCreationTaxYears(input.taxYears.map(item => item.taxYear));
      if (!creationPlan.ok) throw new TRPCError({ code: "BAD_REQUEST", message: creationPlan.message });

      const db = await requireDb();
      return db.transaction(async tx => {
        const [review] = await tx
          .select()
          .from(opportunityReviews)
          .where(eq(opportunityReviews.id, input.opportunityReviewId))
          .limit(1);
        if (!review || !review.active) {
          throw new TRPCError({ code: "CONFLICT", message: "This Opportunity Review is no longer active." });
        }
        if (review.opportunityStatus !== "Ready to Create Amendment") {
          throw new TRPCError({ code: "CONFLICT", message: "Complete Amendment Audit Pro with Ready to Create Amendment before creating the record." });
        }

        if (review.sourceWorkGroupId) {
          const sourceClusters = await tx
            .select({ taxYear: canopyTaskClusters.taxYear })
            .from(canopyTaskClusters)
            .where(eq(canopyTaskClusters.workGroupId, review.sourceWorkGroupId));
          const sourceYears = new Set(sourceClusters.map(item => item.taxYear));
          const invalidYears = creationPlan.uniqueYears.filter(year => !sourceYears.has(year));
          if (invalidYears.length > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Tax Year ${invalidYears.join(", ")} is not present in the linked Canopy source work group.`,
            });
          }
        }

        const assigneeIds = unique(
          [input.assignedPreparerId, input.currentOwnerId, input.assignedEaReviewerId].filter(
            (value): value is number => typeof value === "number",
          ),
        );
        const assignees = await tx.select().from(users).where(inArray(users.id, assigneeIds));
        if (assignees.length !== assigneeIds.length || assignees.some(user => !user.active)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Every assignee must be an active TaxAce user." });
        }
        const preparer = assignees.find(user => user.id === input.assignedPreparerId);
        if (!preparer || !hasCapability(preparer.role, "createAmendment")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Assigned Preparer must have Admin-equivalent amendment access." });
        }

        const overlapKeys = creationPlan.uniqueYears.map(year => activeCoverageKey(review.clientId, year));
        const overlaps = await tx
          .select()
          .from(taxYearRecords)
          .where(inArray(taxYearRecords.activeCoverageKey, overlapKeys));
        if (overlaps.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `An active Amendment Record already covers Tax Year ${overlaps.map(item => item.taxYear).join(", ")}.`,
          });
        }

        const publicId = publicRecordId();
        const inserted = await tx
          .insert(amendmentRecords)
          .values({
            amendmentRecordId: publicId,
            clientId: review.clientId,
            workflowStatus: "Investigation",
            amendmentReason: input.amendmentReason,
            amendmentType: input.amendmentType,
            assessmentSummary: input.amendmentAssessment,
            documentsReceivedSummary: review.documentsReceivedSummary,
            documentsNeededSummary: review.documentsNeededSummary,
            documentationStatus: review.documentsNeededSummary ? "Documents needed" : "Not assessed",
            auditEstimatedTaxImpact: review.estimatedTaxImpact,
            estimatedRefundBalanceDue: null,
            riskIfNotAmended: input.riskIssueNotes,
            priority: input.priority,
            nextAction: "Complete investigation and document the amendment assessment.",
            assignedPreparerId: input.assignedPreparerId,
            assignedEaReviewerId: input.assignedEaReviewerId,
            currentOwnerId: input.currentOwnerId,
          })
          .returning({ id: amendmentRecords.id });
        const amendmentId = inserted[0]?.id;
        if (!amendmentId) throw new Error("Amendment Record could not be created.");

        await tx.insert(taxYearRecords).values(
          input.taxYears.map(item => ({
            amendmentId,
            clientId: review.clientId,
            taxYear: item.taxYear,
            jurisdiction: item.jurisdiction,
            taxYearStatus: "Investigation" as const,
            assignedUserId: input.assignedPreparerId,
            activeCoverageKey: activeCoverageKey(review.clientId, item.taxYear),
          })),
        );

        const assignmentRows: Array<{
          amendmentId: number;
          assignmentRole: "Assigned Preparer" | "EA Reviewer" | "Current Owner";
          assigneeId: number;
          assignedById: number;
        }> = [
          {
            amendmentId,
            assignmentRole: "Assigned Preparer",
            assigneeId: input.assignedPreparerId,
            assignedById: ctx.user.id,
          },
          {
            amendmentId,
            assignmentRole: "Current Owner",
            assigneeId: input.currentOwnerId,
            assignedById: ctx.user.id,
          },
        ];
        if (input.assignedEaReviewerId) {
          assignmentRows.push({
            amendmentId,
            assignmentRole: "EA Reviewer",
            assigneeId: input.assignedEaReviewerId,
            assignedById: ctx.user.id,
          });
        }
        await tx.insert(assignments).values(assignmentRows);

        if (review.sourceWorkGroupId) {
          await tx.insert(amendmentSourceLinks).values({ amendmentId, workGroupId: review.sourceWorkGroupId });
        }

        await tx
          .update(opportunityReviews)
          .set({
            active: false,
            amendmentOpportunity: true,
            amendmentReasonSummary: input.amendmentReason,
            amendmentAssessment: input.amendmentAssessment,
            priority: input.priority,
            reviewCompletionDate: new Date(),
          })
          .where(eq(opportunityReviews.id, review.id));
        await tx
          .update(clientRecords)
          .set({ opportunityStatus: "Ready to Create Amendment" })
          .where(eq(clientRecords.id, review.clientId));
        await upsertAuditDetails(tx as any, {
          opportunityReviewId: review.id,
          actorUserId: ctx.user.id,
          riskIssueNotes: input.riskIssueNotes,
          completedAt: new Date(),
        });

        const correlationId = crypto.randomUUID();
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: "Amendment Record created from Audit Pro",
          entityType: "Amendment Record",
          entityId: amendmentId,
          clientId: review.clientId,
          amendmentId,
          newValue: {
            amendmentRecordId: publicId,
            workflowStatus: "Investigation",
            auditEstimatedTaxImpact: review.estimatedTaxImpact,
            taxYears: creationPlan.uniqueYears,
            sourceWorkGroupId: review.sourceWorkGroupId,
          },
          correlationId,
        });
        await writeActivity(tx, {
          actorType: "system",
          action: "Opportunity Review completed with controlled Create Amendment",
          entityType: "Opportunity Review",
          entityId: review.id,
          clientId: review.clientId,
          amendmentId,
          newValue: { sourceWorkGroupId: review.sourceWorkGroupId },
          correlationId,
        });

        return { id: amendmentId, amendmentRecordId: publicId };
      });
    }),
});
