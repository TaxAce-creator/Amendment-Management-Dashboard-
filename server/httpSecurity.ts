import type { NextFunction, Request, Response } from "express";

const authBuckets = new Map<string, { count: number; resetAt: number }>();
const AUTH_WINDOW_MS = 60_000;
const AUTH_MAX_REQUESTS = 20;

function requestKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (forwardedValue?.trim() || req.ip || req.socket.remoteAddress || "unknown").slice(0, 160);
}

function pruneBuckets(now: number) {
  if (authBuckets.size < 2_000) return;
  authBuckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) authBuckets.delete(key);
  });
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

export function authRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const key = requestKey(req);
  const existing = authBuckets.get(key);
  const bucket = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + AUTH_WINDOW_MS } : existing;
  bucket.count += 1;
  authBuckets.set(key, bucket);
  pruneBuckets(now);

  res.setHeader("RateLimit-Limit", String(AUTH_MAX_REQUESTS));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, AUTH_MAX_REQUESTS - bucket.count)));
  res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > AUTH_MAX_REQUESTS) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    res.status(429).type("text/plain").send("Too many authentication requests. Please try again shortly.");
    return;
  }
  next();
}
