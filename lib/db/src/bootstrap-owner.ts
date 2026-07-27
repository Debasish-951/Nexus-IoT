/**
 * Bootstrap (or recover) the platform owner account.
 *
 * Solves the chicken-and-egg problem the invitation workflow creates: only an
 * administrator can invite users, so the very first administrator has to be
 * established out of band. It is also the documented recovery path when every
 * admin is locked out — see docs/security/auth-upgrade.md §5.6.
 *
 * What it does, for one named account:
 *   1. promotes it to the requested role (default `super_admin`),
 *   2. clears any existing password and returns it to `invited`,
 *   3. revokes every live session and outstanding token,
 *   4. issues a fresh single-use activation link and prints it.
 *
 * It never sets a password. The owner chooses their own via the activation
 * page, so no credential is ever known to two people — the same rule that
 * applies to every other account on the platform.
 *
 * Usage:
 *   pnpm --filter @workspace/db run bootstrap                       # dry run, targets `admin`
 *   pnpm --filter @workspace/db run bootstrap -- --apply
 *   pnpm --filter @workspace/db run bootstrap -- --user you@corp.com --apply
 *   pnpm --filter @workspace/db run bootstrap -- --user owner --role admin --apply
 *   pnpm --filter @workspace/db run bootstrap -- --user you@corp.com --name "Jane Doe" --create --apply
 *
 * Add --temp-password to issue a short-lived password instead of a link:
 *   pnpm --filter @workspace/db run bootstrap -- --user you@corp.com --temp-password --minutes 15 --apply
 */

import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import crypto from "node:crypto";
import { promisify } from "node:util";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { usersTable, authTokensTable, sessionsTable } from "./schema/index.js";

// ── Credential helpers ───────────────────────────────────────────────────────
// Duplicated from api-server/src/lib/password.ts rather than imported: lib/db
// must not depend on an artifact (artifacts are leaf nodes). The stored format
// is the contract between them — keep these in step if that format changes.

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

function generateTemporaryPassword(): string {
  const UPPER = "ACDEFHJKLMNPQRTUVWXY";
  const LOWER = "abcdefghjkmnpqrtuvwxy";
  const DIGIT = "34679";
  const pick = (a: string) => a[crypto.randomInt(a.length)];

  const group = () => {
    const c = [pick(UPPER), pick(DIGIT), pick(LOWER), pick(LOWER)];
    for (let i = c.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [c[i], c[j]] = [c[j], c[i]];
    }
    return c.join("");
  };

  const groups: string[] = [];
  do { groups.push(group()); } while (groups.join("-").length < 12);
  return groups.join("-");
}

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("❌  DATABASE_URL is not set. Copy .env.example → .env and set it.");
  process.exit(1);
}

// ── Arguments ────────────────────────────────────────────────────────────────

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}

const APPLY  = process.argv.includes("--apply");
const CREATE = process.argv.includes("--create");
const TEMP   = process.argv.includes("--temp-password");
const TARGET = arg("user", "admin")!;
const ROLE   = arg("role", "super_admin")!;
const NAME   = arg("name");
/** Minutes a --temp-password stays valid. Default 15, capped at 24h. */
const MINUTES = Math.min(Math.max(Math.round(Number(arg("minutes", "15"))) || 15, 1), 24 * 60);

const VALID_ROLES = ["super_admin", "admin", "customer_admin", "engineer", "operator", "viewer"];
if (!VALID_ROLES.includes(ROLE)) {
  console.error(`❌  Unknown role "${ROLE}". Expected one of: ${VALID_ROLES.join(", ")}`);
  process.exit(1);
}

const BASE_URL  = (process.env.AUTH_PUBLIC_URL ?? "http://localhost:5173").replace(/\/+$/, "");
const TTL_HOURS = Number(process.env.AUTH_ACTIVATION_TTL_HOURS ?? 72);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main(): Promise<void> {
  console.log(`\n👑  Owner bootstrap — ${APPLY ? "APPLYING" : "DRY RUN"}\n`);

  let [user] = await db
    .select()
    .from(usersTable)
    .where(or(
      eq(usersTable.username, TARGET),
      sql`lower(${usersTable.email}) = lower(${TARGET})`,
    ));

  // ── Create the account if asked and it does not exist ──────────────────────
  if (!user) {
    if (!CREATE) {
      console.error(`❌  No user matches "${TARGET}" (by username or email).`);
      console.error(`    Pass --create --name "Your Name" to create it, or --user <existing>.\n`);
      await pool.end();
      process.exit(1);
    }
    if (!TARGET.includes("@")) {
      console.error(`❌  --create needs --user to be an email address (got "${TARGET}").\n`);
      await pool.end();
      process.exit(1);
    }
    if (!NAME) {
      console.error(`❌  --create also needs --name "Your Name".\n`);
      await pool.end();
      process.exit(1);
    }

    const username = TARGET.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64) || "owner";
    console.log(`  Will CREATE  ${username}  <${TARGET}>  role=${ROLE}`);

    if (!APPLY) {
      console.log(TEMP
        ? `\n  Re-run with --apply to create it and print a ${MINUTES}-minute temporary password.\n`
        : "\n  Re-run with --apply to create the account and print its activation link.\n");
      await pool.end();
      return;
    }

    [user] = await db.insert(usersTable).values({
      username,
      email: TARGET.toLowerCase(),
      fullName: NAME,
      role: ROLE,
      status: "invited",
      invitedAt: new Date(),
    }).returning();
  } else {
    console.log(`  Target       ${user.username}  <${user.email}>`);
    console.log(`  Role         ${user.role}${user.role === ROLE ? "" : `  →  ${ROLE}`}`);
    console.log(TEMP
      ? `  Credential   temporary password, valid ${MINUTES} minutes, must be changed on first use`
      : `  Status       ${user.status}  →  invited (password cleared)`);

    if (!APPLY) {
      console.log("\n  Re-run with --apply to perform this.");
      console.log("  ⚠️  Any existing password for this account stops working immediately.\n");
      await pool.end();
      return;
    }

    await db.update(usersTable).set({
      role: ROLE,
      ...(TEMP ? {} : {
        status: "invited",
        passwordHash: null,
        passwordUpdatedAt: null,
        mustChangePassword: false,
        passwordExpiresAt: null,
        invitedAt: new Date(),
      }),
      failedLoginAttempts: 0,
      lockedUntil: null,
    }).where(eq(usersTable.id, user.id));
  }

  // ── Revoke everything outstanding ──────────────────────────────────────────
  const killedSessions = await db
    .update(sessionsTable)
    .set({ revokedAt: new Date(), revokedReason: "owner_bootstrap" })
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

  // ── Issue the credential ───────────────────────────────────────────────────
  if (TEMP) {
    const temporary = generateTemporaryPassword();
    const expiresAt = new Date(Date.now() + MINUTES * 60_000);

    await db.update(usersTable).set({
      passwordHash: await hashPassword(temporary),
      passwordUpdatedAt: new Date(),
      mustChangePassword: true,
      passwordExpiresAt: expiresAt,
      status: "active",
      activatedAt: user.activatedAt ?? new Date(),
    }).where(eq(usersTable.id, user.id));

    console.log(`\n✅  ${user.username} is now role "${ROLE}", status "active".`);
    if (killedSessions.length > 0) {
      console.log(`    Revoked ${killedSessions.length} active session(s).`);
    }
    console.log(`\n  🔐  TEMPORARY PASSWORD — valid ${MINUTES} minutes, single purpose:\n`);
    console.log(`      Sign in at : ${BASE_URL}/login`);
    console.log(`      Username   : ${user.username}`);
    console.log(`      Email      : ${user.email}`);
    console.log(`      Password   : ${temporary}`);
    console.log(`      Expires    : ${expiresAt.toLocaleString()}\n`);
    console.log(`  This password can do NOTHING except set a new one — every other`);
    console.log(`  endpoint returns 403 until you change it. After ${MINUTES} minutes it stops`);
    console.log(`  working entirely; re-run this command to issue another.\n`);

    await pool.end();
    return;
  }

  const raw = crypto.randomBytes(32).toString("base64url");
  await db.insert(authTokensTable).values({
    userId: user.id,
    type: "activation",
    tokenHash: crypto.createHash("sha256").update(raw).digest("hex"),
    expiresAt: new Date(Date.now() + TTL_HOURS * 3_600_000),
  });

  console.log(`\n✅  ${user.username} is now role "${ROLE}", status "invited".`);
  if (killedSessions.length > 0) {
    console.log(`    Revoked ${killedSessions.length} active session(s).`);
  }
  console.log(`\n  🔑  Activation link (single use, expires in ${TTL_HOURS}h):\n`);
  console.log(`      ${BASE_URL}/activate?token=${raw}\n`);
  console.log(`  Open it, choose a password, then sign in as "${user.username}" or "${user.email}".\n`);

  await pool.end();
}

main().catch(async (err) => {
  console.error("\n❌  Bootstrap failed:", err);
  await pool.end();
  process.exit(1);
});
