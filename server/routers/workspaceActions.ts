import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { amendmentRecords } from "../../drizzle/schema.js";
import { writeActivity } from "../activity.js";
import { requireCapability } from "../authorization.js";
import { requireDb } from "../db.js";
import { protectedProcedure, router } from "../_core/trpc.js";

const milestoneSchema = z.enum(["payment", "signature", "clientResponse"]);

const milestoneLabels = {
  payment: "Payment confirmed",
  signature: "Client signature received",
  clientResponse: "Client response recorded",
} as const;

export const workspaceActionsRouter = router({
  recordMilestone: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), milestone: milestoneSchema, note: z.string().trim().max(2000).nullable().default(null) }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "coordinateWorkflow");
      const db = await requireDb();
      return db.transaction(async tx => {
        const [record] = await tx.select().from(amendmentRecords).where(eq(amendmentRecords.id, input.id)).limit(1);
        if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Amendment Record not found." });
        if (record.mergedIntoAmendmentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Update the surviving merged Amendment Record instead." });
        if (record.workflowStatus === "Closed") throw new TRPCError({ code: "BAD_REQUEST", message: "Closed Amendment Records cannot receive workflow milestones." });

        const now = new Date();
        const fields = input.milestone === "payment"
          ? { paymentConfirmedAt: now }
          : input.milestone === "signature"
            ? { signatureReceivedAt: now }
            : { lastClientResponseAt: now };
        const previousValue = input.milestone === "payment"
          ? { paymentConfirmedAt: record.paymentConfirmedAt?.toISOString() ?? null }
          : input.milestone === "signature"
            ? { signatureReceivedAt: record.signatureReceivedAt?.toISOString() ?? null }
            : { lastClientResponseAt: record.lastClientResponseAt?.toISOString() ?? null };
        const newValue = input.milestone === "payment"
          ? { paymentConfirmedAt: now.toISOString() }
          : input.milestone === "signature"
            ? { signatureReceivedAt: now.toISOString() }
            : { lastClientResponseAt: now.toISOString() };

        await tx
          .update(amendmentRecords)
          .set({ ...fields, version: record.version + 1 })
          .where(and(eq(amendmentRecords.id, record.id), eq(amendmentRecords.version, record.version)));
        await writeActivity(tx, {
          actorType: "user",
          actorUserId: ctx.user.id,
          action: milestoneLabels[input.milestone],
          entityType: "Amendment Record",
          entityId: record.id,
          clientId: record.clientId,
          amendmentId: record.id,
          previousValue,
          newValue,
          note: input.note,
        });
        return { success: true, milestone: input.milestone, recordedAt: now } as const;
      });
    }),
});
