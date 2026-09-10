import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { isTrustedRequestOrigin } from "./origin.js";

function requestWithOrigin(origin?: string): Request {
  return {
    get(name: string) {
      if (name.toLowerCase() === "origin") return origin;
      return undefined;
    },
  } as Request;
}

describe("trusted origin enforcement", () => {
  it("accepts same-origin browser requests", () => {
    expect(isTrustedRequestOrigin(requestWithOrigin("http://localhost:3000"))).toBe(true);
  });

  it("rejects cross-origin browser requests", () => {
    expect(isTrustedRequestOrigin(requestWithOrigin("https://evil.example"))).toBe(false);
  });

  it("allows requests without an Origin header for non-browser/internal clients", () => {
    expect(isTrustedRequestOrigin(requestWithOrigin())).toBe(true);
  });
});
