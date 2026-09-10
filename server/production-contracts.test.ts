import { describe, expect, it, vi } from "vitest";
import { isAuthorizedTaxAceEmail, requireCapability } from "./authorization.js";
import { writeActivity } from "./activity.js";
import {
  executeAtomically,
  planMergeTaxYearMoves,
  planSplitPreservation,
  validateClosureTaxYears,
  validateCreationTaxYears,
  validateMergePreservation,
} from "./transactionPolicy.js";
import { runCrossWorkspaceRefreshers } from "../client/src/lib/refreshPolicy.js";
import { appRouter } from "./routers.js";
import type { TrpcContext } from "./_core/context.js";

const user = (role: "Admin" | "EA Reviewer" | "Preparer" | "Viewer") => ({ role, active: true, email: "team@taxacebsi.com" });

function roleContext(role: "EA Reviewer" | "Preparer"): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: role === "EA Reviewer" ? 201 : 202,
      authIssuer: "https://accounts.google.com",
      authSubject: `test-${role.toLowerCase().replaceAll(" ", "-")}`,
      name: `Test ${role}`,
      email: `${role === "EA Reviewer" ? "reviewer" : "preparer"}@taxacebsi.com`,
      role,
      active: true,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("server-side role enforcement", () => {
  it("rejects inactive users and unauthorized capabilities", () => {
    expect(() => requireCapability({ ...user("Admin"), active: false } as any, "manageSettings")).toThrow(/inactive/);
    expect(() => requireCapability(user("Viewer") as any, "editTechnical")).toThrow(/does not permit/);
    expect(() => requireCapability(user("EA Reviewer") as any, "performEaReview")).not.toThrow();
  });

  it("accepts only normalized taxacebsi.com email identities", () => {
    expect(isAuthorizedTaxAceEmail("Person@TaxAceBSI.com")).toBe(true);
    expect(isAuthorizedTaxAceEmail("person@taxace.com")).toBe(false);
    expect(isAuthorizedTaxAceEmail("person@other.example")).toBe(false);
    expect(isAuthorizedTaxAceEmail(null)).toBe(false);
  });

  it.each(["EA Reviewer", "Preparer"] as const)(
    "allows %s through protected Admin-equivalent Settings capability procedures",
    async role => {
      const caller = appRouter.createCaller(roleContext(role));
      await expect(caller.settings.can({ capability: "manageSettings" })).resolves.toEqual({ allowed: true });
      await expect(caller.settings.can({ capability: "manageUsers" })).resolves.toEqual({ allowed: true });
    },
  );
});

describe("create and close amendment transaction policy", () => {
  it("requires unique Tax Year Records during creation", () => {
    expect(validateCreationTaxYears([])).toMatchObject({ ok: false });
    expect(validateCreationTaxYears([2022, 2022])).toMatchObject({ ok: false });
    expect(validateCreationTaxYears([2022, 2023])).toEqual({ ok: true, uniqueYears: [2022, 2023] });
  });

  it("requires every Tax Year Record to close before Amendment Record closure", () => {
    expect(validateClosureTaxYears([])).toMatchObject({ ok: false });
    expect(validateClosureTaxYears(["Closed", "Accepted"])).toMatchObject({ ok: false });
    expect(validateClosureTaxYears(["Closed", "Closed"])).toEqual({ ok: true });
  });
});

describe("split and merge preservation", () => {
  it("moves only selected Tax Year Records and keeps at least one on the source", () => {
    expect(planSplitPreservation([1, 2, 3], [2])).toEqual({ ok: true, movedIds: [2], remainingIds: [1, 3] });
    expect(planSplitPreservation([1, 2], [1, 2])).toMatchObject({ ok: false });
    expect(planSplitPreservation([1, 2], [7])).toMatchObject({ ok: false });
  });

  it("preserves disjoint tax years and rejects cross-client or overlapping merges", () => {
    expect(validateMergePreservation({ sourceId: 1, targetId: 2, sourceClientId: 9, targetClientId: 9, sourceYears: [2022], targetYears: [2023] })).toEqual({ ok: true, preservedYears: [2023, 2022] });
    expect(validateMergePreservation({ sourceId: 1, targetId: 2, sourceClientId: 9, targetClientId: 8, sourceYears: [2022], targetYears: [2023] })).toMatchObject({ ok: false });
    expect(validateMergePreservation({ sourceId: 1, targetId: 2, sourceClientId: 9, targetClientId: 9, sourceYears: [2023], targetYears: [2023] })).toMatchObject({ ok: false });
  });

  it("plans source Tax Year Records to move onto the merge target without dropping active coverage", () => {
    expect(planMergeTaxYearMoves({ targetAmendmentId: 22, clientId: 9, sourceYears: [{ id: 41, taxYear: 2022 }, { id: 42, taxYear: 2023 }] })).toEqual([
      { taxYearRecordId: 41, amendmentId: 22, activeCoverageKey: "9:2022" },
      { taxYearRecordId: 42, amendmentId: 22, activeCoverageKey: "9:2023" },
    ]);
  });
});

describe("atomic import failure", () => {
  it("rolls back all staged changes when one row throws", async () => {
    const state = { clients: ["existing"], activities: [] as string[] };
    const database = {
      async transaction<T>(callback: (tx: typeof state) => Promise<T>): Promise<T> {
        const draft = structuredClone(state);
        try {
          const result = await callback(draft);
          state.clients = draft.clients;
          state.activities = draft.activities;
          return result;
        } catch (error) {
          throw error;
        }
      },
    };
    await expect(executeAtomically(database, async tx => {
      tx.clients.push("row-1");
      tx.activities.push("row-1-imported");
      throw new Error("row-2 failed");
    })).rejects.toThrow(/row-2 failed/);
    expect(state).toEqual({ clients: ["existing"], activities: [] });
  });
});

describe("Activity History generation", () => {
  it("writes normalized immutable event values with a correlation id", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = { insert: vi.fn(() => ({ values })) };
    await writeActivity(db, { actorType: "user", actorUserId: 4, action: "Import committed", entityType: "Import Batch", entityId: 12 });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ actorType: "user", actorUserId: 4, action: "Import committed", entityType: "Import Batch", entityId: 12, correlationId: expect.any(String) }));
  });
});

describe("cross-workspace data refresh", () => {
  it("refreshes workspace, tracker, dashboard, and activity after material changes", async () => {
    const refreshers = { workspace: vi.fn(async () => undefined), tracker: vi.fn(async () => undefined), dashboard: vi.fn(async () => undefined), activity: vi.fn(async () => undefined) };
    await runCrossWorkspaceRefreshers(refreshers);
    Object.values(refreshers).forEach(refresh => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
