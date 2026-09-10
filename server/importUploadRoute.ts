import { eq } from "drizzle-orm";
import express, { type Express } from "express";
import { importBatchesV2 } from "../drizzle/canopySchema.js";
import { hasCapability } from "../shared/taxace.js";
import { authenticateRequest } from "./auth/adapter.js";
import { requireDb } from "./db.js";
import { enforceTrustedOrigin } from "./_core/origin.js";
import { storagePut } from "./storage.js";

function importMaxBytes(): number {
  const configured = Number(process.env.IMPORT_MAX_BYTES ?? 50 * 1024 * 1024);
  return Number.isFinite(configured) && configured > 0 ? configured : 50 * 1024 * 1024;
}

export function registerImportUploadRoute(app: Express) {
  app.put(
    "/api/imports/:id/upload",
    enforceTrustedOrigin,
    express.raw({ type: "*/*", limit: importMaxBytes() }),
    async (req, res) => {
      try {
        const user = await authenticateRequest(req);
        if (!user) {
          res.status(401).json({ error: "Authentication required." });
          return;
        }
        if (!hasCapability(user.role, "import")) {
          res.status(403).json({ error: `Your ${user.role} role does not permit this TaxAce action.` });
          return;
        }

        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: "A valid Import Batch id is required." });
          return;
        }

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          res.status(400).json({ error: "The uploaded Canopy file is empty." });
          return;
        }

        const db = await requireDb();
        const [batch] = await db.select().from(importBatchesV2).where(eq(importBatchesV2.id, id)).limit(1);
        if (!batch) {
          res.status(404).json({ error: "Import Batch not found." });
          return;
        }
        if (batch.uploaderId !== user.id) {
          res.status(403).json({ error: "This Import Batch belongs to another TaxAce user." });
          return;
        }
        if (["Committed", "Cancelled"].includes(batch.status)) {
          res.status(409).json({ error: "This Import Batch has already been finalized." });
          return;
        }
        if (!batch.storageKey) {
          res.status(400).json({ error: "The Import Batch does not have a protected storage key." });
          return;
        }

        const contentType = req.get("content-type")?.split(";")[0]?.trim() || batch.contentType || "application/octet-stream";
        await storagePut(batch.storageKey, req.body, contentType);
        res.status(204).end();
      } catch (error) {
        console.error("[Canopy Import] Same-origin upload failed", error);
        res.status(500).json({ error: "The protected Canopy file upload failed." });
      }
    },
  );
}