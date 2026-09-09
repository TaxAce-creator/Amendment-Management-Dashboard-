import { and, desc, eq, like, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { clientRecords, opportunityReviews, users } from "../../drizzle/schema";
import { OPPORTUNITY_STATUSES, PRIORITIES } from "../../shared/taxace";
import { writeActivity } from "../activity";
import { requireCapability } from "../authorization";
import { requireDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

const draftOpportunityStatusSchema = z.enum(["Pending Review", "Under Review"]);

export const opportunitiesRouter = router({
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
      return db
        .select({ opportunity: opportunityReviews, client: clientRecords, reviewerName: users.name })
        .from(opportunityReviews)
        .innerJoin(clientRecords, eq(opportunityReviews.clientId, clientRecords.id))
        .leftJoin(users, eq(opportunityReviews.assignedReviewerId, users.id))
        .where(and(...conditions))
        .orderBy(desc(opportunityReviews.updatedAt));
    }),

  updateReview: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: draftOpportunityStatusSchema,
        recommendation: z
          .enum([
            "Recommend Amendment",
            "Additional Review Required",
            "Awaiting Documentation",
            "No Amendment Recommended",
          ])
          .nullable(),
        priority: z.enum(PRIORITIES),
        amendmentReasonSummary: z.string().trim().max(4000).nullable(),
        documentsReceivedSummary: z.string().trim().max(4000).nullable(),
        documentsNeededSummary: z.string().trim().max(4000).nullable(),
        reviewNotes: z.string().trim().max(8000).nullable(),
        amendmentAssessment: z.string().trim().max(8000).nullable(),
        estimatedTaxImpact: z.number().finite().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "reviewOpportunity");
      const db = await requireDb();
      const [existing] = await db.select().from(opportunityReviews).where(eq(opportunityReviews.id, input.id)).limit(1);
      if (!existing || !existing.active) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity Review not found." });
      }
      if (existing.opportunityStatus === "Ready to Create Amendment") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This Opportunity Review has completed Amendment Audit Pro. Use Audit Pro for further decision changes.",
        });
      }

      await db.transaction(async tx => {
        await tx
          .update(opportunityReviews)
          .set({
            opportunityStatus: input.status,
            recommendation: input.recommendation,
            priority: input.priority,
            amendmentReasonSummary: input.amendmentReasonSummary,
            documentsReceivedSummary: input.documentsReceivedSummary,
            documentsNeededSummary: input.documentsNeededSummary,
            reviewNotes: input.reviewNotes,
            amendmentAssessment: input.amendmentAssessment,
            estimatedTaxImpact: input.estimatedTaxImpact?.toString() ?? null,
          })
          .where(eq(opportunityReviews.id, input.id));
        await tx.update(clientRecords).set({ opportunityStatus: input.status }).where(eq(clientRecords.id, existing.clientId));
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: "Opportunity Review draft updated",
          entityType: "Opportunity Review",
          entityId: input.id,
          clientId: existing.clientId,
          previousValue: { status: existing.opportunityStatus, recommendation: existing.recommendation },
          newValue: { status: input.status, recommendation: input.recommendation },
        });
      });
      return { success: true } as const;
    }),
});
