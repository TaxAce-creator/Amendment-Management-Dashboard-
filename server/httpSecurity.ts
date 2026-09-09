import { lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { authRateLimitBuckets } from "../drizzle/schema";
import { requireDb } from "./db";

const AUTH_WINDOW_MS = 60_000;
const AUTH_MAX_REQUESTS = 20;

function requestKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (forwardedValue?.trim() || req.ip || req.socket.remoteAddress || "unknown").slice(0, 160);
}

export function applySecurityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://accounts.google.com; object-src 'none'",
    );
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

// Rate-limit state lives in Postgres (auth_rate_limit_buckets), not in process
// memory. This app can run as either a single long-running server or as
// Vercel serverless functions, and a serverless deployment gives every
// invocation/cold-start its own memory — an in-memory Map would silently
// stop enforcing the limit consistently across instances. A single UPSERT
// does the increment-or-reset atomically, so concurrent requests from the
// same key can't race each other into under-counting.
export async function authRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = new Date();
  const key = requestKey(req);
  const windowResetAt = new Date(now.getTime() + AUTH_WINDOW_MS);

  try {
    const db = await requireDb();

    const result = await db.execute(sql`
      INSERT INTO "auth_rate_limit_buckets" ("key", "count", "resetAt")
      VALUES (${key}, 1, ${windowResetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "auth_rate_limit_buckets"."resetAt" <= ${now} THEN 1
          ELSE "auth_rate_limit_buckets"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "auth_rate_limit_buckets"."resetAt" <= ${now} THEN ${windowResetAt}
          ELSE "auth_rate_limit_buckets"."resetAt"
        END
      RETURNING "count", "resetAt"
    `);

    const row = result.rows[0] as { count: number; resetAt: Date } | undefined;
    const count = row?.count ?? 1;
    const resetAt = row?.resetAt ? new Date(row.resetAt).getTime() : windowResetAt.getTime();

    // Occasional, cheap cleanup of long-expired buckets so the table doesn't
    // grow unbounded. Probabilistic rather than on every request, and safe
    // to skip on any given request since it never affects correctness.
    if (Math.random() < 0.02) {
      db.delete(authRateLimitBuckets)
        .where(lt(authRateLimitBuckets.resetAt, new Date(now.getTime() - AUTH_WINDOW_MS)))
        .catch(error => console.error("[RateLimit] Cleanup failed", error));
    }

    res.setHeader("RateLimit-Limit", String(AUTH_MAX_REQUESTS));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, AUTH_MAX_REQUESTS - count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    if (count > AUTH_MAX_REQUESTS) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000))));
      res.status(429).type("text/plain").send("Too many authentication requests. Please try again shortly.");
      return;
    }
    next();
  } catch (error) {
    // Fail open: a transient database hiccup should not take down login
    // entirely. This only weakens a secondary security control (brute-force
    // throttling), not authentication itself, which still requires a valid
    // session/credential either way.
    console.error("[RateLimit] Failed to evaluate auth rate limit, allowing request", error);
    next();
  }
}
