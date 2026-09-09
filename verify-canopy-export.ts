import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { buildCanopyTaskPreview } from "../server/imports/canopy/parser";

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("Usage: pnpm canopy:verify <CanopyTasks.csv> [another-export.csv]");
    process.exitCode = 1;
    return;
  }

  for (const path of paths) {
    const buffer = await readFile(path);
    const preview = buildCanopyTaskPreview({ filename: basename(path), buffer });
    console.log(`\n${basename(path)}`);
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
    console.log(`Source Exported At: ${preview.sourceExportedAt ?? "not inferred"}`);
    console.log(`Parser: ${preview.parserVersion}`);
    console.log(`File SHA-256: ${preview.fileHash}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
