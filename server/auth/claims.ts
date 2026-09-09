import { ENV } from "../_core/env";
import { normalizeEmail } from "./security";

export type GoogleWorkspaceClaims = {
  iss?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  hd?: unknown;
  name?: unknown;
};

export type ValidatedWorkspaceIdentity = {
  issuer: string;
  subject: string;
  email: string;
  name: string | null;
};

export function validateGoogleWorkspaceClaims(
  claims: GoogleWorkspaceClaims,
): ValidatedWorkspaceIdentity {
  if (typeof claims.iss !== "string" || claims.iss.length === 0) {
    throw new Error("Google identity is missing an issuer.");
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new Error("Google identity is missing a subject identifier.");
  }
  if (claims.email_verified !== true) {
    throw new Error("Google Workspace email must be verified.");
  }
  if (typeof claims.email !== "string" || claims.email.length === 0) {
    throw new Error("Google identity is missing an email address.");
  }
  if (typeof claims.hd !== "string") {
    throw new Error("Google identity is not associated with an approved Workspace domain.");
  }

  const email = normalizeEmail(claims.email);
  const hostedDomain = claims.hd.trim().toLowerCase();
  const allowedDomain = ENV.authAllowedDomain;

  if (hostedDomain !== allowedDomain) {
    throw new Error(`Google Workspace domain must be ${allowedDomain}.`);
  }
  if (!email.endsWith(`@${allowedDomain}`)) {
    throw new Error(`Google Workspace email must end in @${allowedDomain}.`);
  }

  return {
    issuer: claims.iss,
    subject: claims.sub,
    email,
    name: typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : null,
  };
}
