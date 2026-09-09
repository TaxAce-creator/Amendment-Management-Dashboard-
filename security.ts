import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function secureStringEqual(actual: string, expected: string): boolean {
  const actualDigest = Buffer.from(sha256(actual), "hex");
  const expectedDigest = Buffer.from(sha256(expected), "hex");
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const rawValue = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return null;
    }
  }

  return null;
}

export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/";
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";
  if (candidate.includes("\\")) return "/";
  return candidate;
}
