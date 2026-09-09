import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  activityHistory,
  amendmentRecords,
  amendmentSourceLinks,
  assignments,
  taxYearRecords,
  users,
} from "../drizzle/schema";
import { activeCoverageKey, WORKFLOW_STATUSES } from "../shared/taxace";
import { writeActivity } from "../server/activity";
import { closeDbPool, requireDb } from "../server/db";
import { appRouter } from "../server/routers";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameNumberSet(actual: number[], expected: number[]): boolean {
  const a = Array.from(new Set(actual)).sort((x, y) => x - y);
  const b = Array.from(new Set(expected)).sort((x, y) => x - y);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function acceptanceRecordId(): string {
  return `TA-S6-${nanoid(8).toUpperCase()}`;
}

async function findUnusedYear(clientId: number, startAt: number, db: Awaited<ReturnType<typeof requireDb>>) {
  let year = startAt;
  while (year >= 2050) {
    const [coverage] = await db
      .select({ id: taxYearRecords.id })
      .from(taxYearRecords)
      .where(eq(taxYearRecords.activeCoverageKey, activeCoverageKey(clientId, year)))
      .limit(1);
    if (!coverage) return year;
    year -= 1;
  }
  throw new Error("Could not find an unused synthetic acceptance Tax Year.");
}

async function main() {
  const actorEmail = String(process.argv[2] ?? "").trim().toLowerCase();
  if (!actorEmail) {
    throw new Error(
      "Usage: pnpm exec tsx scripts/verify-slice6-operations-db.ts <active-taxace-user@taxacebsi.com>",
    );
  }

  const db = await requireDb();
  const [actor] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, actorEmail), eq(users.active, true)))
    .limit(1);
  assert(actor, `Active TaxAce user not found: ${actorEmail}`);
  assert(actor.role !== "Viewer", "Slice 6 acceptance requires Admin / EA Reviewer / Preparer access.");

  const [alternate] = await db
    .select()
    .from(users)
    .where(and(eq(users.active, true), ne(users.id, actor.id), ne(users.role, "Viewer")))
    .orderBy(users.id)
    .limit(1);
  assert(
    alternate,
    "Slice 6 reassignment acceptance needs a second active Admin / EA Reviewer / Preparer user in the local database.",
  );

  const [provenanceSource] = await db
    .select({ amendment: amendmentRecords, workGroupId: amendmentSourceLinks.workGroupId })
    .from(amendmentSourceLinks)
    .innerJoin(amendmentRecords, eq(amendmentRecords.id, amendmentSourceLinks.amendmentId))
    .orderBy(desc(amendmentSourceLinks.id))
    .limit(1);
  assert(
    provenanceSource,
    "No Canopy-linked Amendment Record is available. Run the Slice 5 Audit Pro DB verifier on an unused opportunity first.",
  );

  const clientId = provenanceSource.amendment.clientId;
  const firstSyntheticYear = await findUnusedYear(clientId, 2099, db);
  const secondSyntheticYear = await findUnusedYear(clientId, firstSyntheticYear - 1, db);
  const publicId = acceptanceRecordId();

  const targetId = await db.transaction(async tx => {
    const inserted = await tx
      .insert(amendmentRecords)
      .values({
        amendmentRecordId: publicId,
        clientId,
        workflowStatus: "Investigation",
        amendmentReasonId: provenanceSource.amendment.amendmentReasonId,
        triggerSourceId: provenanceSource.amendment.triggerSourceId,
        amendmentType: provenanceSource.amendment.amendmentType,
        amendmentReason: "Slice 6 isolated operations acceptance test",
        assessmentSummary: "Local-only verification record created by the Slice 6 database acceptance script.",
        documentationStatus: "Acceptance Test",
        priority: "Medium",
        nextAction: "Verify reassignment, split, merge, workflow closure, archive, and Activity History.",
        assignedPreparerId: actor.id,
        currentOwnerId: actor.id,
      })
      .returning({ id: amendmentRecords.id });
    const id = inserted[0]?.id;
    assert(id, "Could not create the isolated Slice 6 acceptance Amendment Record.");

    await tx.insert(taxYearRecords).values({
      amendmentId: id,
      clientId,
      taxYear: firstSyntheticYear,
      taxYearStatus: "Investigation",
      jurisdiction: "Federal",
      assignedUserId: actor.id,
      activeCoverageKey: activeCoverageKey(clientId, firstSyntheticYear),
    });
    await tx.insert(assignments).values([
      {
        amendmentId: id,
        assignmentRole: "Assigned Preparer",
        assigneeId: actor.id,
        assignedById: actor.id,
      },
      {
        amendmentId: id,
        assignmentRole: "Current Owner",
        assigneeId: actor.id,
        assignedById: actor.id,
      },
    ]);
    await tx.insert(amendmentSourceLinks).values({ amendmentId: id, workGroupId: provenanceSource.workGroupId });
    await writeActivity(tx, {
      actorType: "system",
      action: "Slice 6 acceptance Amendment Record created",
      entityType: "Amendment Record",
      entityId: id,
      clientId,
      amendmentId: id,
      newValue: {
        acceptanceOnly: true,
        sourceWorkGroupId: provenanceSource.workGroupId,
        taxYear: firstSyntheticYear,
      },
    });
    return id;
  });

  const sourceLinksBefore = await db
    .select()
    .from(amendmentSourceLinks)
    .where(eq(amendmentSourceLinks.amendmentId, targetId));
  assert(sourceLinksBefore.length > 0, "Isolated acceptance Amendment has no Canopy source link.");

  const caller = appRouter.createCaller({ user: actor, req: {} as any, res: {} as any });

  await caller.assignments.reassign({
    amendmentId: targetId,
    role: "Assigned Preparer",
    assigneeId: alternate.id,
  });

  const [afterReassign] = await db.select().from(amendmentRecords).where(eq(amendmentRecords.id, targetId)).limit(1);
  assert(afterReassign?.assignedPreparerId === alternate.id, "Assigned Preparer did not change on the Amendment Record.");
  const yearsAfterReassign = await db.select().from(taxYearRecords).where(eq(taxYearRecords.amendmentId, targetId));
  assert(yearsAfterReassign.length > 0, "Acceptance target has no Tax Year Records.");
  assert(
    yearsAfterReassign.every(year => year.assignedUserId === alternate.id),
    "Assigned Preparer reassignment did not synchronize all Tax Year Records.",
  );

  await caller.notes.add({
    amendmentId: targetId,
    body: "Slice 6 local acceptance verification note for operational history.",
  });

  const added = await caller.taxYears.add({ amendmentId: targetId, taxYear: secondSyntheticYear, jurisdiction: "Federal" });
  assert(added.id, "Tax Year add mutation did not return a Tax Year Record id.");
  const [addedYear] = await db.select().from(taxYearRecords).where(eq(taxYearRecords.id, added.id!)).limit(1);
  assert(addedYear?.assignedUserId === alternate.id, "New Tax Year Record did not inherit the current Assigned Preparer.");

  const split = await caller.amendments.split({
    sourceAmendmentId: targetId,
    taxYearRecordIds: [added.id!],
    assignedPreparerId: actor.id,
    currentOwnerId: actor.id,
  });
  const splitId = split.id;

  const [splitRecord] = await db.select().from(amendmentRecords).where(eq(amendmentRecords.id, splitId)).limit(1);
  assert(splitRecord?.workflowStatus === "Investigation", "Split Amendment Record did not start in Investigation.");
  const [splitYear] = await db.select().from(taxYearRecords).where(eq(taxYearRecords.id, added.id!)).limit(1);
  assert(splitYear?.amendmentId === splitId, "Selected Tax Year Record did not move to the split Amendment Record.");
  assert(splitYear.assignedUserId === actor.id, "Split Tax Year Record did not adopt the split Assigned Preparer.");

  const splitLinks = await db
    .select()
    .from(amendmentSourceLinks)
    .where(eq(amendmentSourceLinks.amendmentId, splitId));
  assert(
    sameNumberSet(splitLinks.map(link => link.workGroupId), sourceLinksBefore.map(link => link.workGroupId)),
    "Split Amendment Record did not preserve the source Canopy work-group links.",
  );

  const splitAssignments = await db.select().from(assignments).where(eq(assignments.amendmentId, splitId));
  assert(splitAssignments.some(row => row.assignmentRole === "Assigned Preparer" && row.current), "Split Preparer assignment is missing.");
  assert(splitAssignments.some(row => row.assignmentRole === "Current Owner" && row.current), "Split Current Owner assignment is missing.");

  await caller.amendments.merge({ sourceAmendmentId: splitId, targetAmendmentId: targetId });

  const [mergedSource] = await db.select().from(amendmentRecords).where(eq(amendmentRecords.id, splitId)).limit(1);
  assert(mergedSource?.mergedIntoAmendmentId === targetId, "Merged source was not linked to the surviving Amendment Record.");
  assert(mergedSource.workflowStatus === "Closed", "Merged source was not closed.");
  assert(mergedSource.archivedAt, "Merged source was not retained as archived history.");

  const [mergedSyntheticYear] = await db.select().from(taxYearRecords).where(eq(taxYearRecords.id, added.id!)).limit(1);
  assert(mergedSyntheticYear?.amendmentId === targetId, "Merged Tax Year Record did not move to the surviving Amendment Record.");
  assert(
    mergedSyntheticYear.assignedUserId === alternate.id,
    "Merged Tax Year Record did not synchronize to the surviving Amendment Record's Assigned Preparer.",
  );

  const targetLinksAfterMerge = await db
    .select()
    .from(amendmentSourceLinks)
    .where(eq(amendmentSourceLinks.amendmentId, targetId));
  assert(
    sourceLinksBefore.every(source => targetLinksAfterMerge.some(target => target.workGroupId === source.workGroupId)),
    "Merge did not preserve the union of Canopy source links on the surviving Amendment Record.",
  );

  const activeSplitAssignments = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.amendmentId, splitId), eq(assignments.current, true)));
  assert(activeSplitAssignments.length === 0, "Merged source still has current assignments.");

  let mergedMutationRejected = false;
  try {
    await caller.assignments.reassign({ amendmentId: splitId, role: "Current Owner", assigneeId: actor.id });
  } catch (error) {
    mergedMutationRejected = /merged source/i.test(error instanceof Error ? error.message : String(error));
  }
  assert(mergedMutationRejected, "Merged-source operational mutation was not rejected.");

  const yearsToClose = await db.select().from(taxYearRecords).where(eq(taxYearRecords.amendmentId, targetId));
  for (const year of yearsToClose) {
    await caller.taxYears.update({
      id: year.id,
      taxYearStatus: "Closed",
      filingMethod: year.filingMethod,
      jurisdiction: year.jurisdiction,
      federalStatus: year.federalStatus,
      stateStatus: year.stateStatus,
      dateFiled: toIso(year.dateFiled),
      dateAccepted: toIso(year.dateAccepted),
      amendmentResult: year.amendmentResult,
      estimatedImpact: toNumber(year.estimatedImpact),
      finalImpact: toNumber(year.finalImpact),
    });
  }

  let [workflowRecord] = await db.select().from(amendmentRecords).where(eq(amendmentRecords.id, targetId)).limit(1);
  assert(workflowRecord, "Surviving Amendment Record disappeared before workflow acceptance.");

  const nextStatus: Partial<Record<(typeof WORKFLOW_STATUSES)[number], (typeof WORKFLOW_STATUSES)[number]>> = {
    Investigation: "In Progress",
    "With Client": "In Progress",
    "In Progress": "Ready for EA Review",
    "Ready for EA Review": "EA Review",
    "EA Review": "Waiting for Payment",
    "Waiting for Payment": "Ready for Signature",
    "Ready for Signature": "Ready to File",
    "Ready to File": "Filed",
    Filed: "Waiting on IRS / FTB",
    "Waiting on IRS / FTB": "Accepted",
    Accepted: "Closed",
  };

  while (workflowRecord.workflowStatus !== "Closed") {
    if (workflowRecord.workflowStatus === "Waiting for Payment" && !workflowRecord.paymentConfirmedAt) {
      await caller.amendments.recordMilestone({ id: targetId, milestone: "payment" });
    }
    if (workflowRecord.workflowStatus === "Ready for Signature" && !workflowRecord.signatureReceivedAt) {
      await caller.amendments.recordMilestone({ id: targetId, milestone: "signature" });
    }
    const next = nextStatus[workflowRecord.workflowStatus];
    assert(next, `No acceptance transition configured from ${workflowRecord.workflowStatus}.`);
    await caller.amendments.updateWorkflow({
      id: targetId,
      toStatus: next,
      note: "Slice 6 local operational acceptance progression.",
    });
    [workflowRecord] = await db.select().from(amendmentRecords).where(eq(amendmentRecords.id, targetId)).limit(1);
    assert(workflowRecord, "Amendment Record disappeared during workflow progression.");
  }

  assert(workflowRecord.dateClosed, "Closed Amendment Record is missing dateClosed.");
  const closedYears = await db.select().from(taxYearRecords).where(eq(taxYearRecords.amendmentId, targetId));
  assert(closedYears.every(year => year.taxYearStatus === "Closed"), "Not all Tax Year Records remained Closed.");
  assert(closedYears.every(year => year.activeCoverageKey === null), "Closure did not release active Tax Year coverage keys.");
  const currentAssignmentsAfterClose = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.amendmentId, targetId), eq(assignments.current, true)));
  assert(currentAssignmentsAfterClose.length === 0, "Closure did not end current assignments.");

  let closedMutationRejected = false;
  try {
    await caller.assignments.reassign({ amendmentId: targetId, role: "Current Owner", assigneeId: actor.id });
  } catch (error) {
    closedMutationRejected = /Closed Amendment Record/i.test(error instanceof Error ? error.message : String(error));
  }
  assert(closedMutationRejected, "Closed-record operational mutation was not rejected.");

  await caller.amendments.archive({ id: targetId });
  const [archivedTarget] = await db.select().from(amendmentRecords).where(eq(amendmentRecords.id, targetId)).limit(1);
  assert(archivedTarget?.archivedAt, "Closed Amendment Record was not archived by the separate archive action.");

  const activityRows = await db
    .select({ action: activityHistory.action, correlationId: activityHistory.correlationId, amendmentId: activityHistory.amendmentId })
    .from(activityHistory)
    .where(inArray(activityHistory.amendmentId, [targetId, splitId]));
  const actions = new Set(activityRows.map(row => row.action));
  for (const required of [
    "Assigned Preparer reassigned",
    "Internal Note added",
    "Tax Year Record added",
    "Amendment Record split",
    "Amendment Record created from split",
    "Amendment Record merged",
    "Merged source linked to target",
    "Amendment Record closed",
    "Amendment Record archived",
  ]) {
    assert(actions.has(required), `Activity History is missing required Slice 6 event: ${required}`);
  }

  const splitActivity = activityRows.filter(row =>
    ["Amendment Record split", "Amendment Record created from split"].includes(row.action),
  );
  assert(splitActivity.length >= 2, "Expected both correlated split Activity History events.");
  const splitCorrelations = new Map<string, number>();
  for (const row of splitActivity) {
    if (row.correlationId) splitCorrelations.set(row.correlationId, (splitCorrelations.get(row.correlationId) ?? 0) + 1);
  }
  assert(
    Array.from(splitCorrelations.values()).some(count => count >= 2),
    "Split Activity History events do not share a correlation ID.",
  );

  const mergeActivity = activityRows.filter(row =>
    ["Amendment Record merged", "Merged source linked to target"].includes(row.action),
  );
  assert(mergeActivity.length >= 2, "Expected both correlated merge Activity History events.");
  const mergeCorrelations = new Map<string, number>();
  for (const row of mergeActivity) {
    if (row.correlationId) mergeCorrelations.set(row.correlationId, (mergeCorrelations.get(row.correlationId) ?? 0) + 1);
  }
  assert(
    Array.from(mergeCorrelations.values()).some(count => count >= 2),
    "Merge Activity History events do not share a correlation ID.",
  );

  console.log(`PASS: isolated Slice 6 acceptance Amendment ${publicId} was created without modifying the existing Slice 5 Amendment.`);
  console.log(`PASS: reassigned ${publicId} to ${alternate.email} and synchronized Tax Year ownership.`);
  console.log(`PASS: acceptance Tax Years ${firstSyntheticYear} and ${secondSyntheticYear} were isolated from real client Tax Years.`);
  console.log("PASS: split copied Canopy source links and created current Preparer/Owner assignments.");
  console.log("PASS: merge moved Tax Year coverage, synchronized surviving Preparer ownership, preserved source links, and ended source assignments.");
  console.log("PASS: merged-source and Closed-record operational mutations were rejected.");
  console.log("PASS: workflow prerequisites, Tax Year closure, Amendment closure, coverage release, and separate archive action were verified.");
  console.log("PASS: correlated split/merge and material operational Activity History events were verified.");
  console.log("PASS: Phase 3 Slice 6 amendment operations acceptance verified end-to-end.");
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
