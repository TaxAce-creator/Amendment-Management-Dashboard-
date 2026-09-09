import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { User } from "../../drizzle/schema";
import { oidcLoginStates, userSessions, users } from "../../drizzle/schema";
import { requireDb } from "../db";
import { ENV } from "../_core/env";
import { randomOpaqueToken, sha256 } from "./security";

const LOGIN_STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type ConsumedLoginState = {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
};

export async function createLoginState(input: {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
}): Promise<void> {
  const db = await requireDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOGIN_STATE_TTL_MS);

  await db.delete(oidcLoginStates).where(lt(oidcLoginStates.expiresAt, now));
  await db.insert(oidcLoginStates).values({
    stateHash: sha256(input.state),
    codeVerifier: input.codeVerifier,
    nonce: input.nonce,
    returnTo: input.returnTo,
    expiresAt,
  });
}

export async function consumeLoginState(state: string): Promise<ConsumedLoginState | null> {
  const db = await requireDb();
  const stateHash = sha256(state);
  const now = new Date();

  return db.transaction(async tx => {
    const rows = await tx
      .select()
      .from(oidcLoginStates)
      .where(and(eq(oidcLoginStates.stateHash, stateHash), gt(oidcLoginStates.expiresAt, now)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    await tx.delete(oidcLoginStates).where(eq(oidcLoginStates.id, row.id));
    return {
      codeVerifier: row.codeVerifier,
      nonce: row.nonce,
      returnTo: row.returnTo,
    };
  });
}

export async function createUserSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const db = await requireDb();
  const token = randomOpaqueToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ENV.sessionTtlHours * 60 * 60 * 1000);

  await db.delete(userSessions).where(lt(userSessions.expiresAt, now));
  await db.insert(userSessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt,
    lastSeenAt: now,
  });

  return { token, expiresAt };
}

export async function findUserBySessionToken(token: string): Promise<User | null> {
  const db = await requireDb();
  const now = new Date();
  const rows = await db
    .select({ session: userSessions, user: users })
    .from(userSessions)
    .innerJoin(users, eq(userSessions.userId, users.id))
    .where(
      and(
        eq(userSessions.tokenHash, sha256(token)),
        gt(userSessions.expiresAt, now),
        isNull(userSessions.revokedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (now.getTime() - row.session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    await db
      .update(userSessions)
      .set({ lastSeenAt: now })
      .where(eq(userSessions.id, row.session.id));
  }

  return row.user;
}

export async function revokeUserSession(token: string): Promise<void> {
  const db = await requireDb();
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.tokenHash, sha256(token)), isNull(userSessions.revokedAt)));
}

export async function revokeAllUserSessions(userId: number): Promise<void> {
  const db = await requireDb();
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));
}
