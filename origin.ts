import type { Request, Response, NextFunction } from "express";
import { ENV } from "./env";

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function firstForwardedValue(value: string | undefined): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

function requestPublicOrigins(req: Request): string[] {
  const forwardedProto = firstForwardedValue(req.get("x-forwarded-proto"));
  const protocol = forwardedProto ?? (req.secure ? "https" : "http");
  if (!["http", "https"].includes(protocol)) return [];

  const hosts = [
    firstForwardedValue(req.get("x-forwarded-host")),
    req.get("host") ?? null,
  ].filter((value): value is string => Boolean(value));

  return Array.from(
    new Set(
      hosts
        .map(host => normalizedOrigin(`${protocol}://${host}`))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function codespacesForwardedOrigin(req: Request): string | null {
  const codespaceName = process.env.CODESPACE_NAME?.trim();
  const localPort = req.socket?.localPort;
  if (!codespaceName || !/^[-a-zA-Z0-9]+$/.test(codespaceName) || !localPort) return null;
  return `https://${codespaceName}-${localPort}.app.github.dev`;
}

export function isTrustedRequestOrigin(req: Request): boolean {
  const origin = req.get("origin");
  if (!origin) return true;

  const actual = normalizedOrigin(origin);
  if (!actual) return false;

  const configuredOrigin = normalizedOrigin(ENV.appOrigin);
  if (configuredOrigin === actual) return true;

  // Trust only the exact public origin represented by this request (including
  // reverse-proxy forwarding headers). Do not trust an entire hosting domain.
  if (requestPublicOrigins(req).includes(actual)) return true;

  // GitHub Codespaces can terminate the public tunnel before forwarding the
  // request with an internal Host header. In that case, derive the one exact
  // public origin for this Codespace and the server's actual local port.
  return codespacesForwardedOrigin(req) === actual;
}

export function enforceTrustedOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }

  if (!isTrustedRequestOrigin(req)) {
    res.status(403).json({ error: "Cross-origin request rejected." });
    return;
  }

  next();
}
