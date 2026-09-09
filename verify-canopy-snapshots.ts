import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { buildCanopyTaskPreview } from "../server/imports/canopy/parser";
import type { CanopyImportPreview, ExistingCanopyClusterProjection } from "../server/imports/canopy/contract";

function projectionsFrom(preview: CanopyImportPreview): ExistingCanopyClusterProjection[] {
  if (!preview.sourceExportedAt) {
    throw new Error("Source Exported At could not be inferred. Use canonical CanopyTasks_YYYY-MM-DD_hh.mmAM/PM filenames.");
  }

  const byLogicalKey = new Map<string, ExistingCanopyClusterProjection>();
  for (const row of preview.rows) {
    if (row.action === "Rejected" || row.action === "Duplicate / Conflict") continue;
    if (!byLogicalKey.has(row.logicalKey)) {
      byLogicalKey.set(row.logicalKey, {
        logicalKey: row.logicalKey,
        projectionHash: row.projectionHash,
        sourceExportedAt: preview.sourceExportedAt,
      });
    }
  }
  return Array.from(byLogicalKey.values());
}

function printSummary(label: string, preview: CanopyImportPreview) {
  console.log(`\n${label}`);
  console.table({
    sourceRows: preview.counts.totalRows,
    clients: preview.counts.clients,
    workGroups: preview.counts.workGroups,
    logicalClusters: preview.counts.logicalClusters,
    new: preview.counts.new,
    changed: preview.counts.changed,
    unchanged: preview.counts.unchanged,
    olderSnapshots: preview.counts.olderSnapshots,
    duplicateOccurrences: preview.counts.duplicateOccurrences,
    conflicts: preview.counts.conflicts,
    rejected: preview.counts.rejected,
  });
}

function assertCount(actual: number, expected: number, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}.`);
  }
}

async function main() {
  const [morningPath, afternoonPath] = process.argv.slice(2);
  if (!morningPath || !afternoonPath) {
    console.error("Usage: pnpm exec tsx scripts/verify-canopy-snapshots.ts <morning.csv> <afternoon.csv>");
    process.exitCode = 1;
    return;
  }

  const [morningBuffer, afternoonBuffer] = await Promise.all([
    readFile(morningPath),
    readFile(afternoonPath),
  ]);

  const morning = buildCanopyTaskPreview({
    filename: basename(morningPath),
    buffer: morningBuffer,
  });

  const afternoonAgainstMorning = buildCanopyTaskPreview({
    filename: basename(afternoonPath),
    buffer: afternoonBuffer,
    existingClusters: projectionsFrom(morning),
  });

  printSummary("Afternoon snapshot compared with morning current projections", afternoonAgainstMorning);

  assertCount(afternoonAgainstMorning.counts.totalRows, 267, "Afternoon source rows");
  assertCount(afternoonAgainstMorning.counts.clients, 17, "Afternoon clients");
  assertCount(afternoonAgainstMorning.counts.workGroups, 19, "Afternoon work groups");
  assertCount(afternoonAgainstMorning.counts.logicalClusters, 263, "Afternoon logical clusters");
  assertCount(afternoonAgainstMorning.counts.new, 250, "Afternoon new logical tasks");
  assertCount(afternoonAgainstMorning.counts.changed, 6, "Afternoon changed logical tasks");
  assertCount(afternoonAgainstMorning.counts.unchanged, 7, "Afternoon unchanged logical tasks");
  assertCount(afternoonAgainstMorning.counts.duplicateOccurrences, 4, "Afternoon duplicate occurrences");
  assertCount(afternoonAgainstMorning.counts.conflicts, 0, "Afternoon conflicts");
  assertCount(afternoonAgainstMorning.counts.rejected, 0, "Afternoon rejected rows");

  const afternoon = buildCanopyTaskPreview({
    filename: basename(afternoonPath),
    buffer: afternoonBuffer,
  });

  const morningAgainstAfternoon = buildCanopyTaskPreview({
    filename: basename(morningPath),
    buffer: morningBuffer,
    existingClusters: projectionsFrom(afternoon),
  });

  printSummary("Morning snapshot compared with newer afternoon current projections", morningAgainstAfternoon);

  assertCount(morningAgainstAfternoon.counts.totalRows, 13, "Morning source rows");
  assertCount(morningAgainstAfternoon.counts.olderSnapshots, 13, "Older snapshot rows");
  assertCount(morningAgainstAfternoon.counts.changed, 0, "Older snapshot changed rows");
  assertCount(morningAgainstAfternoon.counts.unchanged, 0, "Older snapshot unchanged rows");
  assertCount(morningAgainstAfternoon.counts.conflicts, 0, "Older snapshot conflicts");
  assertCount(morningAgainstAfternoon.counts.rejected, 0, "Older snapshot rejected rows");

  console.log("\nPASS: real Canopy snapshot ordering and 7-unchanged / 6-changed regression verified.");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
