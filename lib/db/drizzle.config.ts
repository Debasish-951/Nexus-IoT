import * as dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

// 1. Load the .env file from the root directory BEFORE checking the variable
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || "../../.env" });

// 2. Now process.env will have your DATABASE_URL
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

/**
 * Whether `telemetry` has been converted to a monthly-partitioned table by
 * `pnpm --filter @workspace/db run partition-telemetry`.
 *
 * drizzle-kit cannot manage a partitioned table: it does not see the parent and
 * would try to CREATE `telemetry` again on every push, and a table filter does
 * not stop it (tested; it then offered to drop the partitions). So once
 * telemetry is partitioned, its schema file is left out of push and the
 * partition tool owns that table. The partitions themselves live in the
 * `telemetry_parts` schema, which push never looks at.
 *
 * Asked through a child process because this file is loaded synchronously.
 */
function telemetryPartitioned(): boolean {
  const script = `const {Client}=require("pg");(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();const r=await c.query("select relkind from pg_class where oid = to_regclass('public.telemetry')");process.stdout.write(r.rows[0]?.relkind??"");await c.end()})().catch(()=>process.exit(0))`;
  try {
    return execFileSync(process.execPath, ["-e", script], { encoding: "utf8", env: process.env, timeout: 15000 }).trim() === "p";
  } catch {
    return false;
  }
}

const partitioned = telemetryPartitioned();
// Every table file. index.ts only re-exports them, so it is left out (it would
// bring telemetry back in).
const schemaFiles = readdirSync("./src/schema")
  .filter((f) => f.endsWith(".ts") && f !== "index.ts" && !(partitioned && f === "telemetry.ts"))
  .map((f) => `./src/schema/${f}`);
if (partitioned) console.log("telemetry is partitioned: left to the partition tool, not to push");

export default defineConfig({
  schema: schemaFiles,
  // Reviewed migration files, used by `generate` and `migrate`. `push` ignores
  // them. See docs/operations/database-migrations.md.
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
