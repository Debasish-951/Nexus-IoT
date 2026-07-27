/**
 * Local development seed script.
 *
 * Creates the minimum data needed to use the platform locally:
 *   - 3 users  (admin, engineer, operator)
 *   - 1 plant  → 1 machine asset hierarchy
 *   - 2 alarm rules on the machine
 *   - 1 API client for testing ingest
 *
 * Safe to run multiple times — all inserts use ON CONFLICT DO NOTHING.
 *
 * Usage:
 *   pnpm --filter @workspace/db run seed
 */

import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" }); // Points up to the root Nexus-IoT folder

import crypto from "node:crypto";
import { sql, eq, and, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  usersTable, assetsTable, alarmRulesTable, apiClientsTable, authTokensTable,
} from "./schema/index.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("❌  DATABASE_URL is not set. Copy .env.example → .env and set it.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// ─── Fixed IDs so the seed is idempotent ─────────────────────────────────────

const IDs = {
  userAdmin:    "00000001-0000-0000-0000-000000000001",
  userEngineer: "00000002-0000-0000-0000-000000000001",
  userOperator: "00000003-0000-0000-0000-000000000001",
  plant:        "00000010-0000-0000-0000-000000000001",
  machine:      "00000011-0000-0000-0000-000000000001",
  ruleTemp:     "00000020-0000-0000-0000-000000000001",
  ruleVibr:     "00000021-0000-0000-0000-000000000001",
  apiClient:    "00000030-0000-0000-0000-000000000001",
} as const;

/**
 * Issue a fresh, single-use activation token for every account that still has
 * no password, and print the link. Mirrors what the API does when an admin
 * invites a user — the seed just has no mail transport, so it prints instead.
 *
 * Must stay in sync with `api-server/src/lib/tokens.ts` (32 random bytes,
 * base64url, SHA-256 at rest).
 */
async function issueActivationLinks(): Promise<void> {
  const baseUrl = (process.env.AUTH_PUBLIC_URL ?? "http://localhost:5173").replace(/\/+$/, "");
  const ttlHours = Number(process.env.AUTH_ACTIVATION_TTL_HOURS ?? 72);

  const pending = await db
    .select({ id: usersTable.id, username: usersTable.username, email: usersTable.email })
    .from(usersTable)
    .where(isNull(usersTable.passwordHash));

  if (pending.length === 0) return;

  console.log("\n  🔑  Activation links (single use, expire in " + ttlHours + "h):");
  for (const user of pending) {
    // Supersede any outstanding activation token for this account.
    await db
      .update(authTokensTable)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(authTokensTable.userId, user.id),
        eq(authTokensTable.type, "activation"),
        isNull(authTokensTable.consumedAt),
        isNull(authTokensTable.revokedAt),
      ));

    const raw = crypto.randomBytes(32).toString("base64url");
    await db.insert(authTokensTable).values({
      userId:    user.id,
      type:      "activation",
      tokenHash: crypto.createHash("sha256").update(raw).digest("hex"),
      expiresAt: new Date(Date.now() + ttlHours * 3_600_000),
    });

    console.log(`        ${user.username.padEnd(10)} ${baseUrl}/activate?token=${raw}`);
  }
  console.log("");
}

async function seed() {
  console.log("🌱  Seeding local development database...\n");

  // ── Users ─────────────────────────────────────────────────────────────────
  //
  // Seeded accounts are created **without a password**, in `invited` status.
  // The seed then prints a one-time activation link per account.
  //
  // This is deliberate: shipping a known credential like admin/admin123 is the
  // single highest-severity finding in the security review, and "it's only the
  // dev seed" is exactly how such credentials reach production. There is no
  // flag to restore the old behaviour.
  await db.insert(usersTable).values([
    {
      id:       IDs.userAdmin,
      username: "admin",
      email:    "admin@local.dev",
      fullName: "Administrator",
      role:     "admin",
      status:   "invited",
      invitedAt: new Date(),
    },
    {
      id:       IDs.userEngineer,
      username: "jsmith",
      email:    "jsmith@local.dev",
      fullName: "Jane Smith",
      role:     "engineer",
      status:   "invited",
      invitedAt: new Date(),
    },
    {
      id:       IDs.userOperator,
      username: "mwilson",
      email:    "mwilson@local.dev",
      fullName: "Mike Wilson",
      role:     "operator",
      status:   "invited",
      invitedAt: new Date(),
    },
  ]).onConflictDoNothing({ target: usersTable.id });

  // Re-seeding an older database: strip any legacy cleartext credential rather
  // than leaving it to be compared against a scrypt hash (or, worse, matched).
  const downgraded = await db
    .update(usersTable)
    .set({ passwordHash: null, status: "invited", invitedAt: new Date() })
    .where(and(
      sql`${usersTable.passwordHash} IS NOT NULL`,
      sql`${usersTable.passwordHash} NOT LIKE 'scrypt$%'`,
    ))
    .returning({ id: usersTable.id, username: usersTable.username });
  if (downgraded.length > 0) {
    console.log(`  ⚠️   Cleared ${downgraded.length} legacy cleartext password(s): ` +
      downgraded.map((u) => u.username).join(", "));
  }

  await issueActivationLinks();
  console.log("  ✅  Users        (admin · jsmith · mwilson — activation links above)");

  // ── Assets ────────────────────────────────────────────────────────────────
  await db.insert(assetsTable).values([
    {
      id:          IDs.plant,
      name:        "Demo Plant",
      identifier:  "demo-plant-001",
      description: "Sample root plant for local development",
      tags:        ["demo"],
    },
    {
      id:          IDs.machine,
      name:        "Demo Pump",
      identifier:  "demo-pump-001",
      parentId:    IDs.plant,
      description: "Sample pump asset — send telemetry to identifier demo-pump-001",
      tags:        ["demo", "pump"],
    },
  ]).onConflictDoNothing();
  console.log("  ✅  Assets       (Demo Plant → Demo Pump)");

  // ── Alarm rules ───────────────────────────────────────────────────────────
  await db.insert(alarmRulesTable).values([
    {
      id:          IDs.ruleTemp,
      name:        "High Temperature",
      description: "Triggers when temperature exceeds 80 °C",
      assetId:     IDs.machine,
      alarmType:   "threshold",
      severity:    "high",
      metric:      "temperature",
      operator:    "gt",
      threshold:   80,
      deadband:    2,
      enabled:     true,
    },
    {
      id:          IDs.ruleVibr,
      name:        "High Vibration",
      description: "Triggers when vibration exceeds 5 mm/s",
      assetId:     IDs.machine,
      alarmType:   "threshold",
      severity:    "medium",
      metric:      "vibration",
      operator:    "gt",
      threshold:   5,
      deadband:    0.5,
      enabled:     true,
    },
  ]).onConflictDoNothing();
  console.log("  ✅  Alarm rules  (High Temperature, High Vibration on Demo Pump)");

  // ── API client ────────────────────────────────────────────────────────────
  await db.insert(apiClientsTable).values([
    {
      id:           IDs.apiClient,
      name:         "Local Dev Client",
      description:  "Pre-seeded API client for local testing. Secret: local-dev-secret",
      clientId:     "local-dev-client",
      clientSecret: "local-dev-secret",
      scopes:       ["ingest:write", "telemetry:read", "assets:read", "alarms:read"],
      status:       "active",
      allowedIps:   [],
    },
  ]).onConflictDoNothing();
  console.log("  ✅  API client   (local-dev-client / local-dev-secret)");

  console.log(`
✅  Seed complete!

Quick-start payload to test ingest:

  curl -X POST http://localhost:8080/api/ingest/payload \\
    -H "Content-Type: application/json" \\
    -H "X-API-Key: local-dev-secret" \\
    -d '{"deviceId":"demo-pump-001","timestamp":"${new Date().toISOString()}","metrics":{"temperature":72.5,"vibration":2.1}}'

Next step: open one of the activation links above to set a password.
There are no default credentials — accounts stay unusable until activated.
  admin (admin) · jsmith (engineer) · mwilson (operator)
`);
}

seed()
  .catch((err) => {
    console.error("❌  Seed failed:", err);
    process.exit(1);
  })
  .finally(() => pool.end());
