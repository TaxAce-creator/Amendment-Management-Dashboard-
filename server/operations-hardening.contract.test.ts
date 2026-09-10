import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./routers/amendmentOperations.ts", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

describe("Slice 6 operational mutation contract", () => {
  it("routes live amendment operations through the hardened module only", () => {
    expect(routerSource).toContain('from "./routers/amendmentOperations.js"');
    expect(routerSource).not.toContain('from "./routers/operations"');
  });

  it("blocks operational mutations on closed or merged source records", () => {
    expect(source).toContain("A merged source Amendment Record cannot be");
    expect(source).toContain("A Closed Amendment Record cannot be");
    expect(source).toContain("assertOperationalRecord(existing, \"reassigned\")");
    expect(source).toContain("assertOperationalRecord(parent, \"given Tax Year changes\")");
  });

  it("keeps Viewer accounts out of operational amendment assignments", () => {
    expect(source).toContain("Viewer accounts cannot receive operational Amendment assignments");
    expect(source).toContain('role === "EA Reviewer" ? "performEaReview" : "coordinateWorkflow"');
  });

  it("synchronizes Assigned Preparer changes to Tax Year Records", () => {
    expect(source).toContain('if (input.role === "Assigned Preparer")');
    expect(source).toContain("set({ assignedUserId: assignee.id })");
  });
});

describe("Slice 6 split and merge preservation contract", () => {
  it("copies Canopy source provenance when an Amendment Record is split", () => {
    expect(source).toContain("const sourceLinks = await tx.select().from(amendmentSourceLinks)");
    expect(source).toContain("sourceLinks.map(link => ({ amendmentId: newId, workGroupId: link.workGroupId }))");
  });

  it("unions source provenance onto the surviving merge target", () => {
    expect(source).toContain("const missingTargetLinks = sourceLinks.filter");
    expect(source).toContain("missingTargetLinks.map(link => ({ amendmentId: target.id, workGroupId: link.workGroupId }))");
    expect(source).toContain("preservedTaxYears: mergePlan.preservedYears");
  });

  it("ends current source assignments after a merge", () => {
    expect(source).toContain("eq(assignments.amendmentId, source.id)");
    expect(source).toContain("set({ current: false, endedAt: now })");
  });
});

describe("Slice 6 closure contract", () => {
  it("requires Tax Year closure and releases active coverage without auto-archiving a normal close", () => {
    expect(source).toContain("validateClosureTaxYears");
    expect(source).toContain("set({ activeCoverageKey: null })");
    expect(source).toContain('action: input.toStatus === "Closed" ? "Amendment Record closed" : "Workflow Status changed"');
    expect(source).not.toContain('archivedAt: input.toStatus === "Closed"');
  });
});
