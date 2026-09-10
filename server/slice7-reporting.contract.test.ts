import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reports = readFileSync(new URL("../client/src/pages/Reports.tsx", import.meta.url), "utf8");
const reportExports = readFileSync(new URL("./routers/reportExports.ts", import.meta.url), "utf8");
const appRouter = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

describe("Slice 7 filtered reporting export contract", () => {
  it("wires the dedicated filtered export router", () => {
    expect(appRouter).toContain('from "./routers/reportExports.js"');
    expect(appRouter).toContain("reportExports: reportExportsRouter");
    expect(reports).toContain("trpc.reportExports.export.useMutation");
  });

  it("passes visible Overview search and workflow filters into downloads", () => {
    expect(reports).toContain("search: query");
    expect(reports).toContain('status: status === "all" ? undefined');
    expect(reports).toContain("Downloads use the current Overview search and Workflow Status filters.");
    expect(reportExports).toContain('search: z.string().trim()');
  });

  it("exports persisted preparer identity and records filter provenance in Activity History", () => {
    expect(reportExports).toContain('"Assigned Preparer"');
    expect(reportExports).toContain('action: "Filtered operational report exported"');
    expect(reportExports).toContain("rowCount: flatRows.length");
    expect(reportExports).toContain("search: input.search || null");
    expect(reportExports).toContain("status: input.status ?? null");
  });
});
