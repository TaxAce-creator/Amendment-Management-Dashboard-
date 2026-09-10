import { and, eq, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { savedViews } from "../../drizzle/schema.js";
import { requireCapability } from "../authorization.js";
import { requireDb } from "../db.js";
import { protectedProcedure, router } from "../_core/trpc.js";

const workspaceSchema = z.enum([
  "Opportunity Center",
  "Amendment Tracker",
  "Pipeline",
  "Reporting & Analytics",
  "Work Queues",
]);

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
        workspace: workspaceSchema,
        filters: z.record(z.string(), z.unknown()),
        visibleColumns: z.array(z.string()).nullable(),
        sortConfig: z.record(z.string(), z.unknown()).nullable(),
        grouping: z.record(z.string(), z.unknown()).nullable(),
        shared: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "manageSharedViews");
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
      const [saved] = await db
        .select()
        .from(savedViews)
        .where(
          and(
            eq(savedViews.userId, ctx.user.id),
            eq(savedViews.workspace, input.workspace),
            eq(savedViews.name, input.name),
          ),
        )
        .limit(1);
      return saved ?? null;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "manageSharedViews");
      const db = await requireDb();
      const [view] = await db.select().from(savedViews).where(eq(savedViews.id, input.id)).limit(1);
      if (!view) throw new TRPCError({ code: "NOT_FOUND", message: "Saved View not found." });
      if (view.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You may delete only Saved Views that you own." });
      }
      await db.delete(savedViews).where(eq(savedViews.id, input.id));
      return { success: true } as const;
    }),
});
