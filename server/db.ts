import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as coreSchema from "../drizzle/schema";
import * as auditProSchema from "../drizzle/auditProSchema";
import { users } from "../drizzle/schema";
import { normalizeEmail } from "./auth/security";

const schema = { ...coreSchema, ...auditProSchema };

let pool: Pool | null = null;

function createDatabase(client: Pool) {
  return drizzle(client, { schema });
}

let _db: ReturnType<typeof createDatabase> | null = null;

function databaseSslEnabled(): boolean {
  return String(process.env.DATABASE_SSL ?? "false").toLowerCase() === "true";
}

function createPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");

  return new Pool({
    connectionString: url,
    max: 10,
    keepAlive: true,
    ssl: databaseSslEnabled() ? { rejectUnauthorized: true } : undefined,
  });
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    pool = pool ?? createPool();
    _db = createDatabase(pool);
  }
  return _db;
}

export async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db;
}

export async function closeDbPool() {
  if (pool) await pool.end();
  pool = null;
  _db = null;
}

export async function getUserByEmail(email: string) {
  const db = await requireDb();
  const normalizedEmail = normalizeEmail(email);
  const rows = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  return rows[0];
}

export async function getUserById(userId: number) {
  const db = await requireDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0];
}

export async function bindGoogleIdentityToProvisionedUser(input: {
  userId: number;
  issuer: string;
  subject: string;
}) {
  const db = await requireDb();

  return db.transaction(async tx => {
    const userRows = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1);
    const user = userRows[0];
    if (!user) throw new Error("Provisioned user no longer exists.");
    if (!user.active) throw new Error("Provisioned user is inactive.");

    if (user.authIssuer || user.authSubject) {
      if (user.authIssuer !== input.issuer || user.authSubject !== input.subject) {
        throw new Error("This TaxAce account is already bound to a different Google identity.");
      }
    } else {
      const collision = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.authIssuer, input.issuer), eq(users.authSubject, input.subject)))
        .limit(1);
      if (collision[0] && collision[0].id !== user.id) {
        throw new Error("This Google identity is already bound to another TaxAce account.");
      }
    }

    const now = new Date();
    await tx
      .update(users)
      .set({ authIssuer: input.issuer, authSubject: input.subject, lastSignedIn: now })
      .where(eq(users.id, user.id));

    const updatedRows = await tx.select().from(users).where(eq(users.id, user.id)).limit(1);
    const updated = updatedRows[0];
    if (!updated) throw new Error("Failed to load the authenticated user.");
    return updated;
  });
}

export async function createProvisionedUser(input: {
  email: string;
  name?: string | null;
  role: "Admin" | "EA Reviewer" | "Preparer" | "Viewer";
}) {
  const db = await requireDb();
  const email = normalizeEmail(input.email);
  await db.insert(users).values({
    email,
    name: input.name?.trim() || null,
    role: input.role,
    active: true,
  });
  return getUserByEmail(email);
}
