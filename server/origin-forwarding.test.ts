import type { Request } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { isTrustedRequestOrigin } from "./_core/origin.js";

function requestWithHeaders(headers: Record<string, string>, secure = false, localPort?: number): Request {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    secure,
    socket: localPort ? { localPort } : undefined,
    get(name: string) {
      return normalized[name.toLowerCase()];
    },
  } as Request;
}

afterEach(() => {
  delete process.env.CODESPACE_NAME;
});

describe("trusted request origin", () => {
  it("accepts the exact public origin reported by a forwarding proxy", () => {
    const origin = "https://solid-orbit-example-3000.app.github.dev";
    const req = requestWithHeaders({
      origin,
      "x-forwarded-proto": "https",
      "x-forwarded-host": "solid-orbit-example-3000.app.github.dev",
      host: "localhost:3000",
    });

    expect(isTrustedRequestOrigin(req)).toBe(true);
  });

  it("rejects a different Codespaces origin instead of trusting the whole hosting domain", () => {
    const req = requestWithHeaders({
      origin: "https://different-space-3000.app.github.dev",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "solid-orbit-example-3000.app.github.dev",
      host: "localhost:3000",
    });

    expect(isTrustedRequestOrigin(req)).toBe(false);
  });

  it("rejects an unrelated cross-origin request even when forwarded headers are present", () => {
    const req = requestWithHeaders({
      origin: "https://attacker.example",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "solid-orbit-example-3000.app.github.dev",
      host: "localhost:3000",
    });

    expect(isTrustedRequestOrigin(req)).toBe(false);
  });

  it("accepts a direct same-origin request", () => {
    const req = requestWithHeaders({
      origin: "http://localhost:3000",
      host: "localhost:3000",
    });

    expect(isTrustedRequestOrigin(req)).toBe(true);
  });

  it("accepts the exact Codespaces tunnel origin when GitHub forwards only an internal host", () => {
    process.env.CODESPACE_NAME = "fantastic-broccoli-example";
    const req = requestWithHeaders({
      origin: "https://fantastic-broccoli-example-3001.app.github.dev",
      host: "localhost:3001",
    }, false, 3001);

    expect(isTrustedRequestOrigin(req)).toBe(true);
  });

  it("rejects a different Codespaces port in the internal-host fallback", () => {
    process.env.CODESPACE_NAME = "fantastic-broccoli-example";
    const req = requestWithHeaders({
      origin: "https://fantastic-broccoli-example-3000.app.github.dev",
      host: "localhost:3001",
    }, false, 3001);

    expect(isTrustedRequestOrigin(req)).toBe(false);
  });

  it("rejects a different Codespace name in the internal-host fallback", () => {
    process.env.CODESPACE_NAME = "fantastic-broccoli-example";
    const req = requestWithHeaders({
      origin: "https://other-space-3001.app.github.dev",
      host: "localhost:3001",
    }, false, 3001);

    expect(isTrustedRequestOrigin(req)).toBe(false);
  });
});
