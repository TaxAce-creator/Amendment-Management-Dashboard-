import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME } from "../../shared/const";
import { isAuthorizedTaxAceEmail } from "../authorization";
import { findUserBySessionToken } from "./sessionStore";
import { readCookie } from "./security";

export async function authenticateRequest(req: Request): Promise<User | null> {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;

  const user = await findUserBySessionToken(token);
  if (!user || !user.active || !isAuthorizedTaxAceEmail(user.email)) return null;
  return user;
}
