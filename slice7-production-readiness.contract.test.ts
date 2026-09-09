import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Slice 7 production readiness contracts", () => {
  it("ships a non-root production container with health checking and no local secret context", () => {
    const dockerfile = source("Dockerfile");
    const dockerignore = source(".dockerignore");
    expect(dockerfile).toContain("FROM node:20-bookworm-slim");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain('CMD ["node", "dist/index.js"]');
    expect(dockerignore).toContain(".env");
    expect(dockerignore).toContain("private-fixtures");
    expect(dockerignore).toContain("CanopyTasks_*.csv");
  });

  it("supports temporary test auth in non-production while defaulting production to Google OIDC", () => {
    const env = source("server/_core/env.ts");
    const routes = source("server/auth/routes.ts");
    const index = source("server/_core/index.ts");
    const storage = source("server/storage.ts");
    expect(env).toContain('export type AuthMode = "oidc" | "test"');
    expect(env).toContain('IS_PRODUCTION ? "oidc" : "test"');
    expect(env).toContain('ENV.authMode === "oidc"');
    expect(env).toContain("TEST_AUTH_ACCESS_CODE");
    expect(env).toContain('ENV.authAllowedDomain !== "taxacebsi.com"');
    expect(env).toContain('origin.protocol !== "https:"');
    expect(routes).toContain('app.post("/auth/test-login", authRateLimit');
    expect(routes).toContain("createGoogleAuthorizationRequest");
    expect(routes).toContain("exchangeGoogleAuthorizationCode");
    expect(routes).toContain("createUserSession(provisionedUser.id)");
    expect(index).toContain("validateRuntimeEnvironment();");
    expect(index).toContain('app.get("/health/live"');
    expect(index).toContain('app.get("/health/ready"');
    expect(index).toContain("select 1");
    expect(index).toContain("storageReady()");
    expect(storage).toContain("HeadBucketCommand");
  });

  it("keeps strict browser security headers production-only while rate limiting auth endpoints", () => {
    const security = source("server/httpSecurity.ts");
    const routes = source("server/auth/routes.ts");
    expect(security).toContain('process.env.NODE_ENV === "production"');
    expect(security).toContain("Content-Security-Policy");
    expect(security).toContain("Strict-Transport-Security");
    expect(security).toContain("AUTH_MAX_REQUESTS = 20");
    expect(routes).toContain('app.get("/auth/login", authRateLimit');
    expect(routes).toContain('app.post("/auth/test-login", authRateLimit');
    expect(routes).toContain('app.get("/auth/callback", authRateLimit');
  });

  it("code-splits workspace routes and preserves traceable source reporting", () => {
    const app = source("client/src/App.tsx");
    const sourceReporting = source("server/routers/sourceReporting.ts");
    const reports = source("client/src/pages/Reports.tsx");
    expect(app).toContain('lazy(() => import("./pages/Dashboard"))');
    expect(app).toContain("<Suspense");
    expect(sourceReporting).toContain('eq(importBatches.lane, "Canopy Task Import")');
    expect(sourceReporting).toContain("sourceExportedAt");
    expect(sourceReporting).toContain("fileHash");
    expect(reports).toContain("Canopy import batch provenance");
  });
});
