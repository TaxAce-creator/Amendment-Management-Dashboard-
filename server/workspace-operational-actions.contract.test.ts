import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(new URL("../client/src/pages/AmendmentWorkspace.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("../client/src/components/WorkspaceOperationalActions.tsx", import.meta.url), "utf8");
const documents = readFileSync(new URL("./routers/documents.ts", import.meta.url), "utf8");
const workspaceActions = readFileSync(new URL("./routers/workspaceActions.ts", import.meta.url), "utf8");
const appRouter = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const taxace = readFileSync(new URL("../shared/taxace.ts", import.meta.url), "utf8");

describe("Amendment Workspace workflow action contract", () => {
  it("exposes approved forward and backward transitions instead of one hard-coded next status", () => {
    expect(actions).toContain('Investigation: ["With Client", "In Progress"]');
    expect(actions).toContain('"With Client": ["Investigation", "In Progress"]');
    expect(actions).toContain('"In Progress": ["With Client", "Ready for EA Review"]');
    expect(actions).toContain('"Waiting for Payment": ["EA Review", "Ready for Signature"]');
    expect(actions).toContain('Accepted: ["Waiting on IRS / FTB", "Closed"]');
    expect(actions).toContain("Change Workflow Status");
    expect(actions).toContain("Return to EA Review");
    expect(workspace).toContain("<WorkspaceOperationalActions");
  });

  it("keeps server transition policy aligned with the Workspace controls", () => {
    expect(taxace).toContain('"Ready for EA Review": ["In Progress", "EA Review"]');
    expect(taxace).toContain('"Ready to File": ["Ready for Signature", "Filed"]');
    expect(taxace).toContain('"Waiting on IRS / FTB": ["Filed", "Accepted"]');
    expect(taxace).toContain("Closed: []");
  });

  it("provides UI controls for workflow prerequisites without modeling a client as a tool user", () => {
    expect(actions).toContain("Confirm Payment");
    expect(actions).toContain("Record Signature Received");
    expect(actions).not.toContain("Record Client Response");
    expect(workspaceActions).toContain('payment: "Payment confirmed"');
    expect(workspaceActions).toContain('signature: "Client signature received"');
  });
});

describe("internal Canopy document monitoring contract", () => {
  it("requires a selected document and moves active work to With Client when Canopy verification is pending", () => {
    expect(actions).toContain("Track Required Documents");
    expect(actions).toContain("selectedDocumentIds.length === 0");
    expect(documents).toContain('z.array(z.number().int().positive()).min(1, "Select at least one required document.")');
    expect(documents).toContain('status: "Requested"');
    expect(documents).toContain('workflowStatus: "With Client"');
    expect(documents).toContain('action: "Required documents recorded"');
  });

  it("keeps monitoring internal and makes Canopy verification explicit", () => {
    expect(actions).toContain("internal TaxAce monitoring checklist");
    expect(actions).toContain("No message, request, upload, portal action, or Canopy write-back is sent from this tool.");
    expect(actions).toContain("Verified Received");
    expect(documents).toContain('"Document verified in Canopy"');
    expect(documents).toContain('action: "Required documents verified in Canopy"');
    expect(appRouter).toContain("documents: documentsRouter");
    expect(appRouter).toContain("workspaceActions: workspaceActionsRouter");
  });

  it("does not auto-advance after all documents are verified", () => {
    expect(actions).toContain("the workflow does not advance automatically");
    expect(documents).toContain("Workflow remains With Client until TaxAce staff manually resumes the amendment.");
  });
});

describe("Assessment completeness", () => {
  it("renders the persisted documentation and estimated refund/balance fields", () => {
    expect(workspace).toContain("Documentation Status");
    expect(workspace).toContain("Estimated Refund / Balance Due");
    expect(workspace).toContain("estimatedRefundBalanceDue");
  });
});
