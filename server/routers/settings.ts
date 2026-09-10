import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  agingThresholds,
  notificationPreferences,
  referenceLists,
  referenceValues,
  TAXACE_ROLES,
  users,
} from "../../drizzle/schema.js";
import {
  hasCapability,
  OPPORTUNITY_STATUSES,
  ROLE_CAPABILITIES,
  TAX_YEAR_STATUSES,
  WORKFLOW_STATUSES,
} from "../../shared/taxace.js";
import { CANOPY_TASK_HEADERS } from "../imports/canopy/contract.js";
import { writeActivity } from "../activity.js";
import { isAuthorizedTaxAceEmail, requireCapability } from "../authorization.js";
import { createProvisionedUser, getUserByEmail, requireDb } from "../db.js";
import { ensureSystemConfiguration } from "../referenceData.js";
import { protectedProcedure, router } from "../_core/trpc.js";
import { normalizeEmail } from "../auth/security.js";
import { revokeAllUserSessions } from "../auth/sessionStore.js";

function slug(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const settingsRouter = router({
  bootstrap: protectedProcedure.query(async ({ ctx }) => {
    requireCapability(ctx.user, "view");
    await ensureSystemConfiguration();
    return { productName: "TaxAce", user: ctx.user, capabilities: ROLE_CAPABILITIES[ctx.user.role], roleModel: TAXACE_ROLES, manualImportBoundary: true };
  }),

  usersForAssignments: protectedProcedure.query(async ({ ctx }) => {
    requireCapability(ctx.user, "view");
    const db = await requireDb();
    return db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.active, true)).orderBy(users.name);
  }),

  configuration: protectedProcedure.query(async ({ ctx }) => {
    requireCapability(ctx.user, "manageSettings");
    await ensureSystemConfiguration();
    const db = await requireDb();
    const [lists, values, thresholds, preferences] = await Promise.all([
      db.select().from(referenceLists).orderBy(referenceLists.label),
      db.select().from(referenceValues).orderBy(referenceValues.listId, referenceValues.sortOrder),
      db.select().from(agingThresholds).orderBy(agingThresholds.workflowStatus),
      db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, ctx.user.id)).limit(1),
    ]);
    return {
      roleModel: TAXACE_ROLES.map(role => ({
        role,
        capabilities: role === "Viewer" ? ROLE_CAPABILITIES[role] : ["Admin-equivalent access", ...ROLE_CAPABILITIES[role]],
        accessLevel: role === "Viewer" ? "Read-only" : "Admin-equivalent",
      })),
      statuses: { opportunity: OPPORTUNITY_STATUSES, workflow: WORKFLOW_STATUSES, taxYear: TAX_YEAR_STATUSES },
      referenceLists: lists.map(list => ({ ...list, values: values.filter(value => value.listId === list.id) })),
      agingThresholds: thresholds,
      notificationPreferences: preferences[0] ?? { userId: ctx.user.id, assignments: true, overdue: true, clientSignature: true, documentRequests: true, eaReview: true },
      canopyImport: {
        acceptedExtensions: [".csv", ".xlsx"],
        sourceHeaders: CANOPY_TASK_HEADERS,
        boundaryStatement: "Manual upload of a Canopy Tasks CSV or Excel export. TaxAce preserves source provenance and does not call Canopy APIs or write back to Canopy.",
      },
      importLanes: ["Canopy Task Import", "Reference Data Import", "Opportunity Import"],
    };
  }),

  users: protectedProcedure.query(async ({ ctx }) => {
    requireCapability(ctx.user, "manageUsers");
    const db = await requireDb();
    return db.select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, lastSignedIn: users.lastSignedIn }).from(users).orderBy(users.name);
  }),

  createUser: protectedProcedure
    .input(z.object({ name: z.string().trim().min(2).max(160), email: z.string().trim().email().max(320), role: z.enum(TAXACE_ROLES) }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "manageUsers");
      const email = normalizeEmail(input.email);
      if (!isAuthorizedTaxAceEmail(email)) throw new TRPCError({ code: "BAD_REQUEST", message: "TaxAce users must use an authorized taxacebsi.com email address." });
      const existing = await getUserByEmail(email);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "A TaxAce user already exists for this email address." });
      const created = await createProvisionedUser({ name: input.name, email, role: input.role });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "User provisioning did not return a user record." });
      const db = await requireDb();
      await writeActivity(db, { actorType: "user", actorUserId: ctx.user.id, action: "User provisioned", entityType: "User Profile", entityId: created.id, newValue: { email: created.email, role: created.role, active: created.active } });
      return { id: created.id } as const;
    }),

  updateUser: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), role: z.enum(TAXACE_ROLES), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "manageUsers");
      if (input.id === ctx.user.id && (!input.active || !hasCapability(input.role, "manageUsers"))) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot remove your own current administration access." });
      const db = await requireDb();
      const [existing] = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "TaxAce user not found." });
      await db.transaction(async tx => {
        await tx.update(users).set({ role: input.role, active: input.active }).where(eq(users.id, input.id));
        await writeActivity(tx, { actorType: "user", actorUserId: ctx.user.id, action: "User access updated", entityType: "User Profile", entityId: input.id, previousValue: { role: existing.role, active: existing.active }, newValue: { role: input.role, active: input.active } });
      });
      if (!input.active) await revokeAllUserSessions(input.id);
      return { success: true } as const;
    }),

  addReferenceValue: protectedProcedure
    .input(z.object({ listId: z.number().int().positive(), label: z.string().trim().min(2).max(180) }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "manageSettings");
      const db = await requireDb();
      const [list] = await db.select().from(referenceLists).where(eq(referenceLists.id, input.listId)).limit(1);
      if (!list) throw new TRPCError({ code: "NOT_FOUND", message: "Reference List not found." });
      const inserted = await db.insert(referenceValues).values({ listId: list.id, key: slug(input.label), label: input.label, active: true, systemLocked: false }).returning({ id: referenceValues.id });
      await writeActivity(db, { actorType: "user", actorUserId: ctx.user.id, action: "Reference value added", entityType: "Reference Value", entityId: inserted[0]?.id, newValue: { list: list.key, label: input.label } });
      return { id: inserted[0]?.id };
    }),

  updateReferenceValue: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), label: z.string().trim().min(2).max(180), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "manageSettings");
      const db = await requireDb();
      const [existing] = await db.select().from(referenceValues).where(eq(referenceValues.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Reference value not found." });
      if (existing.systemLocked && (!input.active || existing.label !== input.label)) throw new TRPCError({ code: "BAD_REQUEST", message: "Canonical system reference values cannot be renamed or deactivated." });
      await db.transaction(async tx => {
        await tx.update(referenceValues).set({ label: input.label, active: input.active }).where(eq(referenceValues.id, input.id));
        await writeActivity(tx, { actorType: "user", actorUserId: ctx.user.id, action: "Reference value updated", entityType: "Reference Value", entityId: existing.id, previousValue: { label: existing.label, active: existing.active }, newValue: { label: input.label, active: input.active } });
      });
      return { success: true } as const;
    }),

  updateAgingThreshold: protectedProcedure
    .input(z.object({ workflowStatus: z.enum(WORKFLOW_STATUSES), approachingDays: z.number().int().min(1).max(365), overdueDays: z.number().int().min(1).max(730) }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "manageSettings");
      if (input.approachingDays >= input.overdueDays) throw new TRPCError({ code: "BAD_REQUEST", message: "Approaching threshold must be less than the overdue threshold." });
      const db = await requireDb();
      await db
        .insert(agingThresholds)
        .values({ ...input, updatedById: ctx.user.id })
        .onConflictDoUpdate({ target: agingThresholds.workflowStatus, set: { ...input, updatedById: ctx.user.id } });
      await writeActivity(db, { actorType: "user", actorUserId: ctx.user.id, action: "Aging threshold updated", entityType: "Aging Threshold", newValue: input });
      return { success: true } as const;
    }),

  updateNotifications: protectedProcedure
    .input(z.object({ assignments: z.boolean(), overdue: z.boolean(), clientSignature: z.boolean(), documentRequests: z.boolean(), eaReview: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireCapability(ctx.user, "manageSettings");
      const db = await requireDb();
      await db
        .insert(notificationPreferences)
        .values({ userId: ctx.user.id, ...input })
        .onConflictDoUpdate({ target: notificationPreferences.userId, set: input });
      await writeActivity(db, { actorType: "user", actorUserId: ctx.user.id, action: "Notification preferences updated", entityType: "Notification Preferences", entityId: ctx.user.id, newValue: input });
      return { success: true } as const;
    }),

  can: protectedProcedure
    .input(z.object({ capability: z.enum(["view", "reviewOpportunity", "createAmendment", "editTechnical", "performEaReview", "coordinateWorkflow", "assign", "changePriority", "archive", "splitMerge", "close", "import", "export", "manageSettings", "manageUsers", "manageSharedViews"]) }))
    .query(({ ctx, input }) => {
      requireCapability(ctx.user, "view");
      return { allowed: hasCapability(ctx.user.role, input.capability) };
    }),
});
