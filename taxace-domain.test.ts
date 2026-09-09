import { describe, expect, it } from "vitest";
import {
  canTransition,
  hasCapability,
  ROLE_CAPABILITIES,
  validateWorkflowTransition,
  WORKFLOW_STATUSES,
} from "../shared/taxace";

describe("TaxAce workflow transition policy", () => {
  it("allows every approved forward and return transition", () => {
    expect(canTransition("Investigation", "With Client")).toBe(true);
    expect(canTransition("With Client", "Investigation")).toBe(true);
    expect(canTransition("EA Review", "In Progress")).toBe(true);
    expect(canTransition("Accepted", "Closed")).toBe(true);
  });

  it("rejects skipped and post-closure transitions", () => {
    expect(canTransition("Investigation", "Filed")).toBe(false);
    expect(canTransition("Closed", "Investigation")).toBe(false);
    expect(WORKFLOW_STATUSES).toHaveLength(12);
  });

  it("enforces payment, signature, and closure prerequisites", () => {
    expect(
      validateWorkflowTransition("Waiting for Payment", "Ready for Signature", {
        paymentConfirmed: false,
        signatureReceived: false,
        allTaxYearsClosed: false,
      }),
    ).toMatch(/Payment must be confirmed/);

    expect(
      validateWorkflowTransition("Ready for Signature", "Ready to File", {
        paymentConfirmed: true,
        signatureReceived: false,
        allTaxYearsClosed: false,
      }),
    ).toMatch(/Client signature/);

    expect(
      validateWorkflowTransition("Accepted", "Closed", {
        paymentConfirmed: true,
        signatureReceived: true,
        allTaxYearsClosed: false,
      }),
    ).toMatch(/All Tax Year Records/);
  });
});

describe("TaxAce role capabilities", () => {
  it("grants identical administrative capabilities to Admin, EA Reviewer, and Preparer", () => {
    expect(ROLE_CAPABILITIES["EA Reviewer"]).toEqual(ROLE_CAPABILITIES.Admin);
    expect(ROLE_CAPABILITIES.Preparer).toEqual(ROLE_CAPABILITIES.Admin);
    expect(hasCapability("Admin", "manageSettings")).toBe(true);
    expect(hasCapability("EA Reviewer", "manageSettings")).toBe(true);
    expect(hasCapability("Preparer", "manageSettings")).toBe(true);
    expect(hasCapability("EA Reviewer", "manageUsers")).toBe(true);
    expect(hasCapability("Preparer", "splitMerge")).toBe(true);
    expect(hasCapability("Preparer", "close")).toBe(true);
    expect(hasCapability("Viewer", "manageSettings")).toBe(false);
  });

  it("keeps Viewer read-only", () => {
    expect(hasCapability("Viewer", "view")).toBe(true);
    expect(hasCapability("Viewer", "createAmendment")).toBe(false);
    expect(hasCapability("Viewer", "assign")).toBe(false);
  });
});
