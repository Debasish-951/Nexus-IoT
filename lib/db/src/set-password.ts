/**
 * Set a user's password directly.
 *
 * A break-glass utility, not part of the normal onboarding flow. It exists for
 * two situations: standing up the very first owner account, and recovering when
 * email delivery is not yet configured so activation links cannot be sent.
 *
 * The supported paths remain the activation link, the reset link, and an
 * admin-issued temporary password — all of which guarantee the password is
 * known only to the person using it. This script breaks that guarantee: whoever
 * runs it knows the credential. Use it accordingly.
 *
 * The configured password policy IS enforced here by default. `--force` skips
 * it, which is deliberately awkward to type and loudly reported, because a
 * password that the product itself would reject is a real inconsistency: the
 * user will be unable to re-enter it anywhere in the UI, and the next password
 * they choose will be held to the full policy.
 *
 * Usage:
 *   pnpm run set-password -- --user someone@corp.com --password 'S3cret!Phrase'
 *   pnpm run set-password -- --user someone@corp.com --password '...' --must-change
 *   pnpm run set-password -- --user someone@corp.com --password '...' --force
 */

import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import crypto from "node:crypto";
import { promisify } from "node:util";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { usersTable, authTokensTable, sessionsTable } from "./schema/index.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("❌  DATABASE_URL is not set. Copy .env.example → .env and set it.");
  process.exit(1);
}

// ── Arguments ────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : undefined;
}

const TARGET      = arg("user");
const PASSWORD    = arg("password");
const ROLE        = arg("role");
const FORCE       = process.argv.includes("--force");
const MUST_CHANGE = process.argv.includes("--must-change");

if (!TARGET || !PASSWORD) {
  console.error("\n❌  Both --user and --password are required.\n");
  console.error("    pnpm run set-password -- --user you@corp.com --password 'S3cret!Phrase'\n");
  process.exit(1);
}

// ── Credential helpers ───────────────────────────────────────────────────────
// Mirrors api-server/src/lib/password.ts. Duplicated rather than imported
// because lib/db must not depend on an artifact — the stored format is the
// contract between them. Keep in step if that format changes.

const scrypt = promisify(crypto.scrypt) as (
  p: string, s: Buffer, k: number, o: crypto.ScryptOptions,
) => Promise<Buffer>;

const SCRYPT = { N: 65_536, r: 8, p: 2, maxmem: 192 * 1024 * 1024 };

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, 64, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString("base64"), derived.toString("base64")].join("$");
}

/** Subset of the server policy that can be checked without the server config. */
function checkPolicy(password: string, ctx: { username: string; email: string; fullName: string }): string[] {
  const min = Number(process.env.AUTH_PASSWORD_MIN_LENGTH ?? 12);
  const errors: string[] = [];

  if (password.length < min) errors.push(`must be at least ${min} characters (got ${password.length})`);
  if (!/[A-Z]/.test(password)) errors.push("must contain an uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("must contain a lowercase letter");
  if (!/[0-9]/.test(password)) errors.push("must contain a number");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("must contain a symbol");
  if (/(.)\1{3,}/.test(password)) errors.push("must not repeat a character four or more times");

  const lower = password.toLowerCase();
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|wert|erty|asdf|sdfg|zxcv)/.test(lower)) {
    errors.push("must not contain a simple sequence (1234, abcd, qwer…)");
  }

  const needles = [ctx.username, ctx.email.split("@")[0], ...ctx.fullName.split(/\s+/),
    "integrated", "suite", "websynergies", "nexus", "nexusiot"]
    .filter((s) => s && s.length >= 4).map((s) => s.toLowerCase());
  if (needles.some((n) => lower.includes(n))) {
    errors.push("must not contain your name, username, email, or the product name");
  }

  return errors;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main(): Promise<void> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(or(
      eq(usersTable.username, TARGET!),
      sql`lower(${usersTable.email}) = lower(${TARGET})`,
    ));

  if (!user) {
    console.error(`\n❌  No user matches "${TARGET}" (by username or email).\n`);
    await pool.end();
    process.exit(1);
  }

  const violations = checkPolicy(PASSWORD!, user);
  if (violations.length > 0) {
    if (!FORCE) {
      console.error(`\n❌  That password does not meet the platform's policy:\n`);
      for (const v of violations) console.error(`      • it ${v}`);
      console.error(`\n    Choose a compliant password, or re-run with --force to set it anyway.`);
      console.error(`    Note that --force produces a credential the product's own UI would`);
      console.error(`    reject, and the next password the user chooses WILL be held to the`);
      console.error(`    full policy.\n`);
      await pool.end();
      process.exit(1);
    }
    console.warn(`\n⚠️   POLICY BYPASSED (--force). This password violates:`);
    for (const v of violations) console.warn(`      • it ${v}`);
    console.warn(`    Recorded as a deliberate override. Change it soon.\n`);
  }

  await db.update(usersTable).set({
    passwordHash: await hashPassword(PASSWORD!),
    passwordUpdatedAt: new Date(),
    mustChangePassword: MUST_CHANGE,
    // A directly-set password has no clock on it — that is what distinguishes
    // it from an admin-issued temporary password.
    passwordExpiresAt: null,
    status: "active",
    activatedAt: user.activatedAt ?? new Date(),
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...(ROLE ? { role: ROLE } : {}),
  }).where(eq(usersTable.id, user.id));

  // Anything issued against the old credential is now void.
  const killed = await db
    .update(sessionsTable)
    .set({ revokedAt: new Date(), revokedReason: "password_set_by_admin" })
    .where(and(eq(sessionsTable.userId, user.id), isNull(sessionsTable.revokedAt)))
    .returning({ id: sessionsTable.id });

  await db
    .update(authTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(authTokensTable.userId, user.id),
      isNull(authTokensTable.consumedAt),
      isNull(authTokensTable.revokedAt),
    ));

  console.log(`\n✅  Password set for ${user.username} <${user.email}>`);
  console.log(`    Role   : ${ROLE ?? user.role}`);
  console.log(`    Status : active${MUST_CHANGE ? "  (must change on first sign-in)" : ""}`);
  if (killed.length > 0) console.log(`    Revoked ${killed.length} existing session(s).`);
  console.log(`\n    Sign in at ${(process.env.AUTH_PUBLIC_URL ?? "http://localhost:5173").replace(/\/+$/, "")}/login\n`);

  await pool.end();
}

main().catch(async (err) => {
  console.error("\n❌  Failed:", err);
  await pool.end();
  process.exit(1);
});
