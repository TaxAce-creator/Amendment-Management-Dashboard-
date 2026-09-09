import { describe, expect, it } from "vitest";
import {
  invalidatedAmendmentLevelFinancials,
  snapshotAmendmentLevelFinancials,
  structuralFinancialReviewNextAction,
} from "./transactionPolicy";

describe("structural financial provenance policy", () => {
  it("invalidates amendment-level aggregates instead of distributing them", () => {
    expect(invalidatedAmendmentLevelFinancials()).toEqual({
      auditEstimatedTaxImpact: null,
      federalTaxImpact: null,
      californiaTaxImpact: null,
      estimatedRefundBalanceDue: null,
    });
  });

  it("preserves previous aggregates for append-only activity provenance", () => {
    const values = {
      auditEstimatedTaxImpact: "1000.00",
      federalTaxImpact: "750.00",
      californiaTaxImpact: "250.00",
      estimatedRefundBalanceDue: "1000.00",
    };

    expect(snapshotAmendmentLevelFinancials(values)).toEqual(values);
  });

  it("requires recalculation after split or merge while retaining the prior next action", () => {
    const split = structuralFinancialReviewNextAction("split", "Call client");
    const merge = structuralFinancialReviewNextAction("merge", null);

    expect(split).toMatch(/Recalculate amendment-level financial impacts after split/);
    expect(split).toMatch(/Previous next action: Call client/);
    expect(merge).toMatch(/Recalculate amendment-level financial impacts after merge/);
  });
});
