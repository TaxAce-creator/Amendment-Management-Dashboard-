import "dotenv/config";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { sql } from "drizzle-orm";
import express from "express";
import { createServer } from "http";
import net from "net";
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
import { serveStatic, setupVite } from "./vite.js";

const LISTEN_HOST = process.env.HOST?.trim() || "0.0.0.0";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, LISTEN_HOST, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  validateRuntimeEnvironment();

  const app = express();
  const server = createServer(app);

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

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = Number.parseInt(process.env.PORT || "3000", 10);
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, LISTEN_HOST, () => {
    console.log(`Server listening on ${LISTEN_HOST}:${port}`);
    console.log(`Local URL: http://127.0.0.1:${port}/`);
  });
}

startServer().catch(error => {
  console.error("Server failed to start", error);
  process.exitCode = 1;
});
