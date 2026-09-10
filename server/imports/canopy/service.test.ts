import { describe, expect, it } from "vitest";
import { shouldCreatePendingReviewForImportedWorkGroup } from "./service.js";

describe("Canopy opportunity eligibility", () => {
  it("creates a Pending Review for a first eligible imported work group", () => {
    expect(shouldCreatePendingReviewForImportedWorkGroup({
      hasActiveReview: false,
      hasPriorReview: false,
      hasActiveAmendment: false,
      actions: ["New"],
    })).toBe(true);
  });

  it("does not create a duplicate while an active review exists", () => {
    expect(shouldCreatePendingReviewForImportedWorkGroup({
      hasActiveReview: true,
      hasPriorReview: true,
      hasActiveAmendment: false,
      actions: ["Changed"],
    })).toBe(false);
  });

  it("does not create a review while the client has active amendment work", () => {
    expect(shouldCreatePendingReviewForImportedWorkGroup({
      hasActiveReview: false,
      hasPriorReview: true,
      hasActiveAmendment: true,
      actions: ["Changed"],
    })).toBe(false);
  });

  it("does not reopen a completed review for an older snapshot", () => {
    expect(shouldCreatePendingReviewForImportedWorkGroup({
      hasActiveReview: false,
      hasPriorReview: true,
      hasActiveAmendment: false,
      actions: ["Older Snapshot", "Older Snapshot"],
    })).toBe(false);
  });

  it("does not reopen a completed review for unchanged or duplicate-occurrence rows", () => {
    expect(shouldCreatePendingReviewForImportedWorkGroup({
      hasActiveReview: false,
      hasPriorReview: true,
      hasActiveAmendment: false,
      actions: ["Unchanged", "Duplicate Occurrence"],
    })).toBe(false);
  });

  it("reopens eligibility when a later source snapshot actually changes the work group", () => {
    expect(shouldCreatePendingReviewForImportedWorkGroup({
      hasActiveReview: false,
      hasPriorReview: true,
      hasActiveAmendment: false,
      actions: ["Unchanged", "Changed"],
    })).toBe(true);
  });

  it("reopens eligibility when a later source snapshot adds a logical task", () => {
    expect(shouldCreatePendingReviewForImportedWorkGroup({
      hasActiveReview: false,
      hasPriorReview: true,
      hasActiveAmendment: false,
      actions: ["New"],
    })).toBe(true);
  });
});
