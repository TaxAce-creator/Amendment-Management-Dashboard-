import type { Express } from "express";
import { hasCapability } from "../shared/taxace.js";
import { authenticateRequest } from "./auth/adapter.js";
import { storageReadBuffer } from "./storage.js";

const REPORT_FILENAME_PATTERN = /^TaxAce-Amendment-Report-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.(csv|xlsx|pdf)$/;

const REPORT_CONTENT_TYPES: Record<string, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export function reportStorageKey(userId: number, filename: string): string | null {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (!REPORT_FILENAME_PATTERN.test(filename)) return null;
  return `taxace/exports/${userId}/${filename}`;
}

export function registerReportDownloadRoute(app: Express) {
  app.get("/api/report-exports/:filename", async (req, res) => {
    try {
      const user = await authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }
      if (!hasCapability(user.role, "export")) {
        res.status(403).json({ error: `Your ${user.role} role does not permit TaxAce exports.` });
        return;
      }

      const filename = req.params.filename;
      const storageKey = reportStorageKey(user.id, filename);
      if (!storageKey) {
        res.status(400).json({ error: "A valid TaxAce Amendment Report filename is required." });
        return;
      }

      const extension = filename.split(".").pop()?.toLowerCase() ?? "";
      const contentType = REPORT_CONTENT_TYPES[extension];
      if (!contentType) {
        res.status(400).json({ error: "Unsupported report format." });
        return;
      }

      const body = await storageReadBuffer(storageKey);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(body.length));
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.status(200).send(body);
    } catch (error) {
      console.error("[Report Export] Protected download failed", error);
      res.status(500).json({ error: "The prepared report could not be downloaded." });
    }
  });
}
