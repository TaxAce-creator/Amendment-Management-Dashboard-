export type SplitPlan =
  | { ok: true; movedIds: number[]; remainingIds: number[] }
  | { ok: false; message: string };

export type AmendmentLevelFinancials = {
  auditEstimatedTaxImpact: string | null;
  federalTaxImpact: string | null;
  californiaTaxImpact: string | null;
  estimatedRefundBalanceDue: string | null;
};

export function validateCreationTaxYears(taxYears: number[]): { ok: true; uniqueYears: number[] } | { ok: false; message: string } {
  if (taxYears.length === 0) return { ok: false, message: "At least one Tax Year Record is required." };
  const uniqueYears = Array.from(new Set(taxYears));
  if (uniqueYears.length !== taxYears.length) return { ok: false, message: "Each selected Tax Year may appear only once." };
  return { ok: true, uniqueYears };
}

export function validateClosureTaxYears(statuses: string[]): { ok: true } | { ok: false; message: string } {
  if (statuses.length === 0 || statuses.some(status => status !== "Closed")) {
    return { ok: false, message: "All Tax Year Records must be Closed before the Amendment Record can be closed." };
  }
  return { ok: true };
}

export function planSplitPreservation(sourceIds: number[], selectedIds: number[]): SplitPlan {
  const source = new Set(sourceIds);
  if (selectedIds.length === 0) return { ok: false, message: "Select at least one Tax Year Record to split." };
  if (new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => !source.has(id))) {
    return { ok: false, message: "Every selected Tax Year Record must belong to the source amendment." };
  }
  const remainingIds = sourceIds.filter(id => !selectedIds.includes(id));
  if (remainingIds.length === 0) return { ok: false, message: "At least one Tax Year Record must remain on the source amendment." };
  return { ok: true, movedIds: [...selectedIds], remainingIds };
}

export function validateMergePreservation(input: {
  sourceId: number;
  targetId: number;
  sourceClientId: number;
  targetClientId: number;
  sourceYears: number[];
  targetYears: number[];
}): { ok: true; preservedYears: number[] } | { ok: false; message: string } {
  if (input.sourceId === input.targetId) return { ok: false, message: "Source and target Amendment Records must be different." };
  if (input.sourceClientId !== input.targetClientId) return { ok: false, message: "Only Amendment Records for the same Client Record may be merged." };
  const target = new Set(input.targetYears);
  const overlaps = input.sourceYears.filter(year => target.has(year));
  if (overlaps.length > 0) return { ok: false, message: `The records overlap on Tax Year ${overlaps.join(", ")}.` };
  return { ok: true, preservedYears: [...input.targetYears, ...input.sourceYears] };
}

export function planMergeTaxYearMoves(input: {
  targetAmendmentId: number;
  clientId: number;
  sourceYears: Array<{ id: number; taxYear: number }>;
}) {
  return input.sourceYears.map(year => ({
    taxYearRecordId: year.id,
    amendmentId: input.targetAmendmentId,
    activeCoverageKey: `${input.clientId}:${year.taxYear}`,
  }));
}

/**
 * Amendment-level financial fields describe the complete set of Tax Year Records on
 * an Amendment Record. A split or merge changes that set, so copying or retaining
 * those totals would silently misstate provenance. Structural operations therefore
 * invalidate the amendment-level aggregates and preserve their previous values only
 * in append-only Activity History. Tax Year estimated/final impacts remain attached
 * to their Tax Year Records and move transactionally with those records.
 */
export function snapshotAmendmentLevelFinancials(input: AmendmentLevelFinancials): AmendmentLevelFinancials {
  return {
    auditEstimatedTaxImpact: input.auditEstimatedTaxImpact,
    federalTaxImpact: input.federalTaxImpact,
    californiaTaxImpact: input.californiaTaxImpact,
    estimatedRefundBalanceDue: input.estimatedRefundBalanceDue,
  };
}

export function invalidatedAmendmentLevelFinancials(): AmendmentLevelFinancials {
  return {
    auditEstimatedTaxImpact: null,
    federalTaxImpact: null,
    californiaTaxImpact: null,
    estimatedRefundBalanceDue: null,
  };
}

export function structuralFinancialReviewNextAction(operation: "split" | "merge", existingNextAction?: string | null): string {
  const requirement = `Recalculate amendment-level financial impacts after ${operation} before relying on totals. Tax Year estimated/final impacts were preserved with their Tax Year Records.`;
  const previous = existingNextAction?.trim();
  return previous ? `${requirement} Previous next action: ${previous}` : requirement;
}

export async function executeAtomically<T>(
  database: { transaction: (callback: (tx: any) => Promise<T>) => Promise<T> },
  callback: (tx: any) => Promise<T>,
): Promise<T> {
  return database.transaction(callback);
}
