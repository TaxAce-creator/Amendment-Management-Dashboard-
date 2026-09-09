import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function viewerContext(): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 909,
      authIssuer: "https://accounts.google.com",
      authSubject: "audit-pro-viewer",
      name: "Audit Pro Viewer",
      email: "viewer@taxacebsi.com",
      role: "Viewer",
      active: true,
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("Amendment Audit Pro authorization", () => {
  it("keeps Viewer mutation access read-only", async () => {
    const caller = appRouter.createCaller(viewerContext());
    const common = {
      recommendation: null,
      priority: "Medium" as const,
      amendmentReasonSummary: null,
      documentsReceivedSummary: null,
      documentsNeededSummary: null,
      amendmentAssessment: null,
      riskIssueNotes: null,
      reviewNotes: null,
      estimatedTaxImpact: null,
    };

    await expect(caller.auditPro.launch({ id: 1 })).rejects.toThrow(/does not permit/i);
    await expect(caller.auditPro.save({ id: 1, ...common })).rejects.toThrow(/does not permit/i);
    await expect(caller.auditPro.complete({ id: 1, outcome: "Deferred", ...common })).rejects.toThrow(/does not permit/i);
    await expect(
      caller.auditPro.createAmendment({
        opportunityReviewId: 1,
        amendmentReason: "Human reviewed reason",
        amendmentAssessment: "Human reviewed assessment",
        riskIssueNotes: null,
        amendmentType: "1040-X",
        taxYears: [{ taxYear: 2024, jurisdiction: "Federal & California" }],
        assignedPreparerId: 2,
        currentOwnerId: 3,
        assignedEaReviewerId: null,
        priority: "Medium",
      }),
    ).rejects.toThrow(/does not permit/i);
  });
});

describe("Amendment Audit Pro workflow contract", () => {
  it("reserves decision outcomes for Audit Pro rather than the legacy review mutation", () => {
    const source = readFileSync(new URL("./routers/opportunities.ts", import.meta.url), "utf8");
    expect(source).toContain('const draftOpportunityStatusSchema = z.enum(["Pending Review", "Under Review"])');
    expect(source).toContain("Use Audit Pro for further decision changes");
  });
});

describe("Amendment Audit Pro UI contract", () => {
  it("exposes the active internal Amendment Audit Pro workflow without an obsolete destination control", () => {
    const source = readFileSync(new URL("../client/src/pages/OpportunityCenter.tsx", import.meta.url), "utf8");
    expect(source).toContain("Launch Amendment Audit Pro");
    expect(source).toContain("No Amendment Needed");
    expect(source).toContain("Ready to Create Amendment");
    expect(source).toContain("Confirm Controlled Creation");
    expect(source).not.toContain("Requires an approved TaxAce destination");
  });
});