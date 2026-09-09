import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("temporary test authentication boundary", () => {
  const routesSource = readFileSync("server/auth/routes.ts", "utf8");
  const serverSource = readFileSync("server/_core/index.ts", "utf8");

  it("does not apply the proxy-sensitive origin guard inside the temporary test-login route", () => {
    const routeStart = routesSource.indexOf('app.post("/auth/test-login"');
    const callbackStart = routesSource.indexOf('app.get("/auth/callback"');
    expect(routeStart).toBeGreaterThan(-1);
    expect(callbackStart).toBeGreaterThan(routeStart);

    const testRoute = routesSource.slice(routeStart, callbackStart);
    expect(testRoute).not.toContain("isTrustedRequestOrigin");
    expect(testRoute).toContain('ENV.authMode !== "test"');
    expect(testRoute).toContain("secureStringEqual(accessCode, ENV.testAuthAccessCode)");
    expect(testRoute).toContain("getUserByEmail(ENV.testAuthEmail)");
    expect(testRoute).toContain("createUserSession(provisionedUser.id)");
  });

  it("keeps origin protection on normal state-changing tRPC requests", () => {
    expect(serverSource).toContain('app.use("/api/trpc", enforceTrustedOrigin)');
  });
});
