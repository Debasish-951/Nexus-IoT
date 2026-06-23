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

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { usersTable, assetsTable, alarmRulesTable, apiClientsTable } from "./schema/index.js";

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

async function seed() {
  console.log("🌱  Seeding local development database...\n");

  // ── Users ─────────────────────────────────────────────────────────────────
  await db.insert(usersTable).values([
    {
      id:       IDs.userAdmin,
      username: "admin",
      email:    "admin@local.dev",
      fullName: "Administrator",
      role:     "admin",
      status:   "active",
    },
    {
      id:       IDs.userEngineer,
      username: "jsmith",
      email:    "jsmith@local.dev",
      fullName: "Jane Smith",
      role:     "engineer",
      status:   "active",
    },
    {
      id:       IDs.userOperator,
      username: "mwilson",
      email:    "mwilson@local.dev",
      fullName: "Mike Wilson",
      role:     "operator",
      status:   "active",
    },
  ]).onConflictDoNothing();
  console.log("  ✅  Users        (admin / jsmith / mwilson)");

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

Log in as: admin / jsmith (engineer) / mwilson (operator)
`);
}

seed()
  .catch((err) => {
    console.error("❌  Seed failed:", err);
    process.exit(1);
  })
  .finally(() => pool.end());
