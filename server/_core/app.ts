import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { sql } from "drizzle-orm";
import express, { type Express } from "express";
import { registerAuthRoutes } from "../auth/routes.js";
import { requireDb } from "../db.js";
import { applySecurityHeaders } from "../httpSecurity.js";
import { registerImportUploadRoute } from "../importUploadRoute.js";
import { registerReportDownloadRoute } from "../reportDownloadRoute.js";
import { appRouter } from "../routers.js";
import { storageReady } from "../storage.js";
import { createContext } from "./context.js";
import { validateRuntimeEnvironment } from "./env.js";
import { enforceTrustedOrigin } from "./origin.js";

// Builds the Express app with every route except static asset serving.
//
// This is shared by two runtimes:
//   - server/_core/index.ts: a traditional long-running Node process
//     (Docker, Railway, Fly, a VM) that also serves the built client and
//     calls app.listen().
//   - api/index.ts: a Vercel serverless function. Vercel serves the built
//     client (dist/public) directly from its CDN via `vercel.json`, and
//     only routes /api/*, /auth/*, /health/* to this function, so static
//     serving is intentionally left out here.
//
// The app instance is cached at module scope so a warm serverless
// invocation (or repeated local calls) reuses the same Express app and,
// via server/db.ts's own module-level singleton, the same pg connection
// pool instead of reconnecting on every request.
let cachedApp: Express | null = null;

export async function createApp(): Promise<Express> {
  if (cachedApp) return cachedApp;

  validateRuntimeEnvironment();

  const app = express();

  app.disable("x-powered-by");
  app.use(applySecurityHeaders);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.get("/health/live", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/health/ready", async (_req, res) => {
    let database: "ready" | "unavailable" = "unavailable";
    let storage: "ready" | "unavailable" = "unavailable";
    try {
      const db = await requireDb();
      await db.execute(sql`select 1`);
      database = "ready";
      await storageReady();
      storage = "ready";
      res.status(200).json({ ok: true, database, storage });
    } catch (error) {
      console.error("[Health] Readiness check failed", error);
      res.status(503).json({ ok: false, database, storage });
    }
  });

  registerAuthRoutes(app);
  registerImportUploadRoute(app);
  registerReportDownloadRoute(app);

  app.use("/api/trpc", enforceTrustedOrigin);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  cachedApp = app;
  return app;
}
