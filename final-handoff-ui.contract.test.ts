import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relative: string) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("final handoff operational UI contracts", () => {
  it("keeps Opportunity Center review actions accessible without a wide manager table", () => {
    const source = read("../client/src/pages/OpportunityCenter.tsx");
    expect(source).toContain("Opportunity Review Queue");
    expect(source).toContain("Launch Amendment Audit Pro");
    expect(source).toContain("Amendment Audit Summary");
    expect(source).not.toContain("<th>Amendment Reason</th>");
  });

  it("protects unsaved Amendment Audit Pro work and exposes durable save state", () => {
    const source = read("../client/src/pages/OpportunityCenter.tsx");
    expect(source).toContain("auditBaseline");
    expect(source).toContain("Unsaved changes");
    expect(source).toContain("Discard unsaved Amendment Audit Pro changes?");
    expect(source).toContain("Saving…");
  });

  it("constrains bulk Workflow Status choices and locks the Tracker while applying", () => {
    const source = read("../client/src/pages/AmendmentTracker.tsx");
    expect(source).toContain("WORKFLOW_TRANSITIONS");
    expect(source).toContain("commonStatusTargets");
    expect(source).toContain("bulkApplying");
    expect(source).toContain("Applying to ${selected.length}…");
    expect(source).toContain("Only statuses structurally valid for every selected record are shown.");
  });

  it("keeps operational tab destinations visible without horizontal tab navigation", () => {
    const source = read("../client/src/index.css");
    expect(source).toContain('[data-slot="tabs-list"]');
    expect(source).toContain("flex-wrap: wrap !important");
    expect(source).toContain("overflow-x: visible !important");
  });

  it("keeps local bootstrap and compose example configuration aligned", () => {
    const bootstrap = read("../scripts/bootstrap-admin.ts");
    const env = read("../.env.example");
    expect(bootstrap).toContain('import "dotenv/config"');
    expect(env).toContain("taxace_local_change_me");
    expect(env).toContain("S3_SECRET_ACCESS_KEY=taxace_local_change_me");
  });

  it("binds the application server to a forwardable interface for Codespaces and containers", () => {
    const source = read("./_core/index.ts");
    expect(source).toContain('const LISTEN_HOST = process.env.HOST?.trim() || "0.0.0.0"');
    expect(source).toContain("server.listen(port, LISTEN_HOST");
    expect(source).toContain("server.listen(port, LISTEN_HOST, () =>");
  });
});
