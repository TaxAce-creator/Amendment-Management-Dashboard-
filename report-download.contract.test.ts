import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reportStorageKey } from "./reportDownloadRoute";

describe("protected report download contract", () => {
  it("scopes report objects to the authenticated user and rejects path tricks", () => {
    const filename = "TaxAce-Amendment-Report-2026-09-07T10-19-13.csv";
    expect(reportStorageKey(42, filename)).toBe(`taxace/exports/42/${filename}`);
    expect(reportStorageKey(42, "../../secret.csv")).toBeNull();
    expect(reportStorageKey(42, "TaxAce-Amendment-Report-bad.csv")).toBeNull();
  });

  it("returns a same-origin application download URL instead of exposing private object storage", () => {
    const router = readFileSync(new URL("./routers/reportExports.ts", import.meta.url), "utf8");
    expect(router).toContain('url: `/api/report-exports/${encodeURIComponent(filename)}`');
    expect(router).not.toContain("storageGetSignedUrl");
  });

  it("uses a browser download anchor rather than an async popup", () => {
    const reports = readFileSync(new URL("../client/src/pages/Reports.tsx", import.meta.url), "utf8");
    expect(reports).toContain('link.download = filename');
    expect(reports).toContain('startDownload(result.url, result.filename)');
    expect(reports).not.toContain('window.open(result.url');
  });
});
