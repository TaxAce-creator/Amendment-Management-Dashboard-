import { TRPCError } from "@trpc/server";
import type { User } from "../drizzle/schema";
import { hasCapability, type Capability } from "../shared/taxace";
import { ENV } from "./_core/env";

export function isAuthorizedTaxAceEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith(`@${ENV.authAllowedDomain}`);
}

export function requireActiveUser(user: User): User {
  if (!user.active) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Your TaxAce access is inactive." });
  }
  if (!isAuthorizedTaxAceEmail(user.email)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `TaxAce access requires an authorized ${ENV.authAllowedDomain} email address.`,
    });
  }
  return user;
}

export function requireCapability(user: User, capability: Capability): User {
  requireActiveUser(user);
  if (!hasCapability(user.role, capability)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your ${user.role} role does not permit this TaxAce action.`,
    });
  }
  return user;
}

export function requireAdmin(user: User): User {
  return requireCapability(user, "manageSettings");
}
