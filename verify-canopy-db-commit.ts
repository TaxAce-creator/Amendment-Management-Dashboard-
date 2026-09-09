import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { and, eq, ne } from "drizzle-orm";
import {
  amendmentRecords,
  canopyClientAliases,
  canopyTaskClusters,
  canopyTaskObservations,
  canopyWorkGroups,
  clientRecords,
  importBatches,
  opportunityReviews,
  users,
} from "../drizzle/schema";
import { closeDbPool, requireDb } from "../server/db";
import { parseCanopyExportTimestamp } from "../server/imports/canopy/parser";
import { commitCanopyTaskBatch, loadCanopyPreviewForBatch } from "../server/imports/canopy/service";
import { storageHead, storagePut } from "../server/storage";

function assertEqual(actual: number, expected: number, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}.`);
}

async function countRows(table: any): Promise<number> {
  const db = await requireDb();
  return (await db.select().from(table)).length;
}

async function requireCleanCanopyState() {
  const counts = {
    clients: await countRows(clientRecords),
    aliases: await countRows(canopyClientAliases),
    workGroups: await countRows(canopyWorkGroups),
    clusters: await countRows(canopyTaskClusters),
    observations: await countRows(canopyTaskObservations),
    opportunities: await countRows(opportunityReviews),
    amendments: await countRows(amendmentRecords),
  };
  for (const [label, value] of Object.entries(counts)) {
    if (value !== 0) {
      throw new Error(`Local acceptance test requires a clean operational/source database. ${label} currently has ${value} row(s).`);
    }
  }
}

async function resolveActor(actorEmail?: string) {
  const db = await requireDb();
  if (actorEmail) {
    const [actor] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, actorEmail.trim().toLowerCase()), eq(users.active, true), ne(users.role, "Viewer")))
      .limit(1);
    if (!actor) throw new Error(`No active full-capability TaxAce user was found for ${actorEmail}.`);
    return actor;
  }
  const [actor] = await db
    .select()
    .from(users)
    .where(and(eq(users.active, true), ne(users.role, "Viewer")))
    .limit(1);
  if (!actor) {
    throw new Error(
      "No active Admin / EA Reviewer / Preparer exists in the local database. Bootstrap a real @taxacebsi.com user, then rerun this verifier.",
    );
  }
  return actor;
}

async function createValidatedBatch(input: {
  path: string;
  actorUserId: number;
  suffix: string;
}) {
  const db = await requireDb();
  const buffer = await readFile(input.path);
  const filename = basename(input.path);
  const sourceExportedAt = parseCanopyExportTimestamp(filename);
  if (!sourceExportedAt) throw new Error(`Could not infer Source Exported At from ${filename}.`);

  const batchPublicId = `VERIFY-${Date.now()}-${input.suffix}`;
  const storageKey = `taxace/canopy-imports/${batchPublicId}/${filename}`;
  const artifact = await storagePut(storageKey, buffer, "text/csv");
  const object = await storageHead(artifact.key);
  if (object.contentLength !== buffer.length) {
    throw new Error(`${filename}: protected object size mismatch after upload.`);
  }

  const inserted = await db
    .insert(importBatches)
    .values({
      batchId: batchPublicId,
      lane: "Canopy Task Import",
      uploaderId: input.actorUserId,
      originalFilename: filename,
      contentType: "text/csv",
      storageKey: artifact.key,
      status: "Uploaded",
      sourceExportedAt,
      sourceExportedAtConfirmed: false,
    })
    .returning({ id: importBatches.id });
  const batchId = inserted[0]?.id;
  if (!batchId) throw new Error(`${filename}: failed to create verification Import Batch.`);

  const preview = await loadCanopyPreviewForBatch(batchId);
  if (preview.counts.rejected > 0 || preview.counts.conflicts > 0) {
    throw new Error(`${filename}: validation unexpectedly produced rejected rows or conflicts.`);
  }

  await db
    .update(importBatches)
    .set({
      status: "Ready to Commit",
      normalizedHeaders: preview.headers,
      fileHash: preview.fileHash,
      sourceExportedAt: preview.sourceExportedAt ? new Date(preview.sourceExportedAt) : sourceExportedAt,
      headerFingerprint: preview.headerFingerprint,
      parserVersion: preview.parserVersion,
      totalRows: preview.counts.totalRows,
      acceptedCount: preview.counts.acceptedRows,
      newCount: preview.counts.new,
      changedCount: preview.counts.changed,
      unchangedCount: preview.counts.unchanged,
      olderSnapshotCount: preview.counts.olderSnapshots,
      duplicateCount: preview.counts.duplicateOccurrences,
      conflictCount: preview.counts.conflicts,
      rejectedCount: preview.counts.rejected,
      clientCount: preview.counts.clients,
      workGroupCount: preview.counts.workGroups,
      logicalClusterCount: preview.counts.logicalClusters,
      errorSummary: null,
    })
    .where(eq(importBatches.id, batchId));

  return { batchId, preview };
}

async function commitFile(input: { path: string; actorUserId: number; suffix: string }) {
  const prepared = await createValidatedBatch(input);
  const result = await commitCanopyTaskBatch({ batchId: prepared.batchId, actorUserId: input.actorUserId });
  return { batchId: prepared.batchId, preview: result.preview };
}

async function assertState(expected: {
  clients: number;
  aliases: number;
  workGroups: number;
  clusters: number;
  observations: number;
  opportunities: number;
}) {
  assertEqual(await countRows(clientRecords), expected.clients, "TaxAce Client Records");
  assertEqual(await countRows(canopyClientAliases), expected.aliases, "Canopy client aliases");
  assertEqual(await countRows(canopyWorkGroups), expected.workGroups, "Canopy work groups");
  assertEqual(await countRows(canopyTaskClusters), expected.clusters, "Canopy logical task clusters");
  assertEqual(await countRows(canopyTaskObservations), expected.observations, "Canopy task observations");
  assertEqual(await countRows(opportunityReviews), expected.opportunities, "Opportunity Reviews");
  assertEqual(await countRows(amendmentRecords), 0, "Amendment Records");
}

async function projectionHashesFor(logicalKeys: string[]) {
  const db = await requireDb();
  const rows = await db.select({ logicalKey: canopyTaskClusters.logicalKey, hash: canopyTaskClusters.currentProjectionHash }).from(canopyTaskClusters);
  const wanted = new Set(logicalKeys);
  return new Map(rows.filter(row => wanted.has(row.logicalKey)).map(row => [row.logicalKey, row.hash]));
}

function assertHashesUnchanged(before: Map<string, string | null>, after: Map<string, string | null>) {
  if (before.size !== after.size) throw new Error("Older snapshot verification could not reload all protected current projections.");
  for (const [key, hash] of before.entries()) {
    if (after.get(key) !== hash) throw new Error(`Older snapshot rolled back current Canopy projection for logical key ${key}.`);
  }
}

async function main() {
  const [morningPath, afternoonPath, actorEmail] = process.argv.slice(2);
  if (!morningPath || !afternoonPath) {
    console.error("Usage: pnpm exec tsx scripts/verify-canopy-db-commit.ts <morning.csv> <afternoon.csv> [actor@taxacebsi.com]");
    process.exitCode = 1;
    return;
  }

  await requireCleanCanopyState();
  const actor = await resolveActor(actorEmail);
  console.log(`Using TaxAce actor: ${actor.email} (${actor.role})`);

  const morning = await commitFile({ path: morningPath, actorUserId: actor.id, suffix: "MORNING" });
  assertEqual(morning.preview.counts.totalRows, 13, "Morning batch source rows");
  assertEqual(morning.preview.counts.new, 13, "Morning batch new logical tasks");
  assertState({ clients: 10, aliases: 10, workGroups: 11, clusters: 13, observations: 13, opportunities: 11 });
  console.log("PASS: morning snapshot committed transactionally with 10 clients / 11 work groups / 13 clusters and zero amendments.");

  const afternoon = await commitFile({ path: afternoonPath, actorUserId: actor.id, suffix: "AFTERNOON" });
  assertEqual(afternoon.preview.counts.totalRows, 267, "Afternoon batch source rows");
  assertEqual(afternoon.preview.counts.new, 250, "Afternoon batch new logical tasks");
  assertEqual(afternoon.preview.counts.changed, 6, "Afternoon batch changed logical tasks");
  assertEqual(afternoon.preview.counts.unchanged, 7, "Afternoon batch unchanged logical tasks");
  assertEqual(afternoon.preview.counts.duplicateOccurrences, 4, "Afternoon batch duplicate occurrences");
  assertState({ clients: 17, aliases: 17, workGroups: 19, clusters: 263, observations: 280, opportunities: 19 });
  console.log("PASS: afternoon snapshot committed with 17 clients / 19 work groups / 263 clusters / 280 observations and zero amendments.");

  const morningKeys = Array.from(new Set(morning.preview.rows.map(row => row.logicalKey)));
  const beforeOlderCommit = await projectionHashesFor(morningKeys);

  const olderMorning = await commitFile({ path: morningPath, actorUserId: actor.id, suffix: "OLDER-MORNING" });
  assertEqual(olderMorning.preview.counts.olderSnapshots, 13, "Older morning snapshot classifications");
  assertState({ clients: 17, aliases: 17, workGroups: 19, clusters: 263, observations: 293, opportunities: 19 });
  const afterOlderCommit = await projectionHashesFor(morningKeys);
  assertHashesUnchanged(beforeOlderCommit, afterOlderCommit);

  console.log("PASS: older morning snapshot retained 13 observations without rolling back current projections.");
  console.log("PASS: transactional Canopy import acceptance verified end-to-end; no Amendment Records were created automatically.");
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
