/**
 * One-shot cutover for databases that predate the authentication upgrade.
 *
 * Every existing row has a CLEARTEXT value in `users.password_hash`. This
 * script does NOT silently re-hash it in place, because doing so would mean
 * trusting a secret that may already have leaked through a backup, a console
 * log, or the seed output that used to print it.
 *
 * Instead, for every account still holding a legacy credential it:
 *   1. nulls `password_hash`,
 *   2. sets `status = 'invited'`,
 *   3. issues a fresh single-use activation token,
 *   4. prints the activation link.
 *
 * Users re-onboard through the normal activation flow and choose their own
 * password. No credential is ever known to two people.
 *
 * Usage:
 *   pnpm --filter @workspace/db run migrate:auth            # dry run — reports only
 *   pnpm --filter @workspace/db run migrate:auth -- --apply # perform the migration
 *
 * Run `pnpm --filter @workspace/db run push` first so the new columns exist.
 */

import * as dotenv from "dotenv";
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || "../../.env" });

import crypto from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { usersTable, authTokensTable } from "./schema/index.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("❌  DATABASE_URL is not set. Copy .env.example → .env and set it.");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const BASE_URL = (process.env.AUTH_PUBLIC_URL ?? "http://localhost:5173").replace(/\/+$/, "");
const TTL_HOURS = Number(process.env.AUTH_ACTIVATION_TTL_HOURS ?? 72);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main(): Promise<void> {
  console.log(`\n🔐  Authentication cutover — ${APPLY ? "APPLYING" : "DRY RUN"}\n`);

  // A legacy credential is any non-null password_hash that is not in the
  // scrypt$… format written by lib/password.ts.
  const legacy = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      email: usersTable.email,
      fullName: usersTable.fullName,
      role: usersTable.role,
      status: usersTable.status,
    })
    .from(usersTable)
    .where(and(
      sql`${usersTable.passwordHash} IS NOT NULL`,
      sql`${usersTable.passwordHash} NOT LIKE 'scrypt$%'`,
    ));

  const noCredential = await db
    .select({ id: usersTable.id, username: usersTable.username, email: usersTable.email, fullName: usersTable.fullName, role: usersTable.role })
    .from(usersTable)
    .where(isNull(usersTable.passwordHash));

  console.log(`  Accounts with a legacy cleartext credential : ${legacy.length}`);
  console.log(`  Accounts with no credential at all          : ${noCredential.length}`);

  const targets = [...legacy, ...noCredential];
  if (targets.length === 0) {
    console.log("\n✅  Nothing to migrate — every account already uses a hashed credential.\n");
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log("\n  These accounts would be reset to `invited` and re-issued an activation link:\n");
    for (const u of targets) {
      console.log(`    ${u.username.padEnd(14)} ${u.email.padEnd(32)} (${u.role})`);
    }
    console.log("\n  Re-run with --apply to perform the migration.");
    console.log("  ⚠️  Take a pg_dump first. Affected users cannot sign in until they re-activate.\n");
    await pool.end();
    return;
  }

  console.log("\n  🔑  Activation links (single use, expire in " + TTL_HOURS + "h):\n");

  for (const user of targets) {
    await db.update(usersTable).set({
      passwordHash: null,
      status: "invited",
      invitedAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
      mustChangePassword: false,
    }).where(eq(usersTable.id, user.id));

    // Supersede any outstanding activation token for this account.
    await db.update(authTokensTable)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(authTokensTable.userId, user.id),
        eq(authTokensTable.type, "activation"),
        isNull(authTokensTable.consumedAt),
        isNull(authTokensTable.revokedAt),
      ));

    const raw = crypto.randomBytes(32).toString("base64url");
    await db.insert(authTokensTable).values({
      userId: user.id,
      type: "activation",
      tokenHash: crypto.createHash("sha256").update(raw).digest("hex"),
      expiresAt: new Date(Date.now() + TTL_HOURS * 3_600_000),
    });

    console.log(`    ${user.username.padEnd(14)} ${BASE_URL}/activate?token=${raw}`);
  }

  console.log(`\n✅  Migrated ${targets.length} account(s).`);
  console.log("    Send each user their link, or use Users → Resend invitation once the");
  console.log("    email transport is configured (AUTH_EMAIL_TRANSPORT).\n");

  await pool.end();
}

main().catch(async (err) => {
  console.error("\n❌  Migration failed:", err);
  await pool.end();
  process.exit(1);
});
