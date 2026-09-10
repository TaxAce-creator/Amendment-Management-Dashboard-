import { describe, expect, it } from "vitest";
import {
  buildCanopyLogicalKey,
  buildCanopyTaskPreview,
  buildCanopyWorkGroupKey,
  parseCanopyAssignees,
  parseCanopyExportTimestamp,
} from "./parser.js";

function csv(rows: string[][]): Buffer {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return Buffer.from(rows.map(row => row.map(quote).join(",")).join("\n"), "utf8");
}

const headers = [
  "Pinned",
  "Status",
  "Task",
  "Client",
  "Task Type",
  "Parent Task",
  "Tax Year",
  "Return Type",
  "Due date",
  "Assignee",
];

const row = [
  "No",
  "No status",
  "All Items Provided",
  "Jonathon Bacani",
  "Subtask",
  "TP - 2023 Individual Amendment",
  "2023",
  "1040-X",
  "2026-04-29",
  "Nataly Zamora, Amber Bankhead",
];

describe("Canopy task export parser", () => {
  it("parses the real filename timestamp convention", () => {
    expect(parseCanopyExportTimestamp("CanopyTasks_2026-08-21_09.59AM(1).csv")?.toISOString()).toBe("2026-08-21T09:59:00.000Z");
    expect(parseCanopyExportTimestamp("CanopyTasks_2026-08-21_05.34PM(3).csv")?.toISOString()).toBe("2026-08-21T17:34:00.000Z");
    expect(parseCanopyExportTimestamp("renamed.csv")).toBeNull();
  });

  it("parses comma-separated assignees without creating TaxAce users", () => {
    expect(parseCanopyAssignees(" Nataly Zamora, Amber Bankhead, nataly zamora ")).toEqual([
      "Nataly Zamora",
      "Amber Bankhead",
    ]);
  });

  it("builds stable work-group and logical-task keys", () => {
    expect(buildCanopyWorkGroupKey({ client: " Jonathon  Bacani ", parentTask: "TP - 2023 Individual Amendment", returnType: "1040-X" }))
      .toBe("jonathon bacani|tp - 2023 individual amendment|1040-x");
    expect(buildCanopyLogicalKey({
      client: "Jonathon Bacani",
      parentTask: "TP - 2023 Individual Amendment",
      returnType: "1040-X",
      task: "All Items Provided",
      taskType: "Subtask",
      taxYear: 2023,
    })).toBe("jonathon bacani|tp - 2023 individual amendment|1040-x|all items provided|subtask|2023");
  });

  it("treats repeated identical logical rows as duplicate occurrences, not conflicts", () => {
    const preview = buildCanopyTaskPreview({
      filename: "CanopyTasks_2026-08-21_05.34PM(3).csv",
      buffer: csv([headers, row, row]),
    });
    expect(preview.counts.totalRows).toBe(2);
    expect(preview.counts.logicalClusters).toBe(1);
    expect(preview.counts.duplicateOccurrences).toBe(1);
    expect(preview.counts.conflicts).toBe(0);
    expect(preview.rows.map(item => item.action)).toEqual(["New", "Duplicate Occurrence"]);
  });

  it("marks same-key rows with different mutable source values as a conflict", () => {
    const changed = [...row];
    changed[1] = "With client";
    const preview = buildCanopyTaskPreview({
      filename: "CanopyTasks_2026-08-21_05.34PM(3).csv",
      buffer: csv([headers, row, changed]),
    });
    expect(preview.counts.conflicts).toBe(2);
    expect(preview.rows.every(item => item.action === "Duplicate / Conflict")).toBe(true);
  });

  it("does not let an older snapshot roll back a newer current projection", () => {
    const first = buildCanopyTaskPreview({
      filename: "CanopyTasks_2026-08-21_09.59AM(1).csv",
      buffer: csv([headers, row]),
      existingClusters: [{
        logicalKey: buildCanopyLogicalKey({
          client: row[3],
          parentTask: row[5],
          returnType: row[7],
          task: row[2],
          taskType: row[4],
          taxYear: row[6],
        }),
        projectionHash: "different",
        sourceExportedAt: "2026-08-21T17:34:00.000Z",
      }],
    });
    expect(first.rows[0]?.action).toBe("Older Snapshot");
  });

  it("requires the real ten Canopy headers while preserving extras", () => {
    const preview = buildCanopyTaskPreview({
      filename: "CanopyTasks_2026-08-21_05.34PM(3).csv",
      buffer: csv([[...headers, "Extra Column"], [...row, "preserved"]]),
    });
    expect(preview.extraHeaders).toEqual(["Extra Column"]);
    expect(preview.rows[0]?.extraColumns).toEqual({ "Extra Column": "preserved" });
  });
});
