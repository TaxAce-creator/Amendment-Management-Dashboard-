import type { Request } from "express";
import type { User } from "../../drizzle/schema.js";
import { COOKIE_NAME } from "../../shared/const.js";
import { isAuthorizedTaxAceEmail } from "../authorization.js";
import { findUserBySessionToken } from "./sessionStore.js";
import { readCookie } from "./security.js";

export async function authenticateRequest(req: Request): Promise<User | null> {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;

  const user = await findUserBySessionToken(token);
  if (!user || !user.active || !isAuthorizedTaxAceEmail(user.email)) return null;
  return user;
}
