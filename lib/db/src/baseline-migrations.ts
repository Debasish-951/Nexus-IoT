/**
 * One-time step for moving an EXISTING database from `drizzle-kit push` to
 * reviewed migrations.
 *
 * A database built with `push` already has every table that the baseline
 * migration (migrations/0000_baseline.sql) would create, so `migrate` would fail
 * on its first CREATE TABLE. This script records the baseline as already
 * applied, in the same table and format drizzle's migrator uses
 * (drizzle.__drizzle_migrations: sha256 of the SQL file, journal timestamp).
 * After it, `migrate` applies only migrations newer than the baseline.
 *
 * Run it only after bringing the database up to date with `push` using the
 * same code version that generated the baseline, so the schema really matches.
 * A fresh, empty database does not need it: run `migrate` directly.
 *
 * Usage:
 *   pnpm --filter @workspace/db run push                  # schema matches this code
 *   pnpm --filter @workspace/db run baseline-migrations   # mark the baseline applied
 *   pnpm --filter @workspace/db run migrate               # nothing to apply
 *
 * See docs/operations/database-migrations.md.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || "../../.env" });

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const MIGRATIONS = path.resolve(process.cwd(), "migrations");

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("❌  DATABASE_URL is not set.");
    process.exit(1);
  }
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  const baseline = journal.entries[0];
  if (!baseline) {
    console.error("❌  No migrations found. Run `pnpm --filter @workspace/db run generate` first.");
    process.exit(1);
  }
  const sql = fs.readFileSync(path.join(MIGRATIONS, `${baseline.tag}.sql`)).toString();
  const hash = crypto.createHash("sha256").update(sql).digest("hex");

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const existing = await client.query("select to_regclass('public.assets') as t");
    if (!existing.rows[0]?.t) {
      console.error("❌  This database has no application tables. It is not a `push` database: run `migrate` instead.");
      process.exit(1);
    }
    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await client.query(
      'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
    );
    const applied = await client.query('select hash, created_at from "drizzle"."__drizzle_migrations" order by created_at');
    if (applied.rows.length > 0) {
      const same = applied.rows.some((r) => r.hash === hash);
      console.log(same
        ? `✅  Baseline ${baseline.tag} is already recorded. Nothing to do.`
        : `❌  This database already has ${applied.rows.length} recorded migration(s) that are not this baseline. Not changing anything.`);
      process.exit(same ? 0 : 1);
    }
    await client.query('insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)', [hash, baseline.when]);
    console.log(`✅  Recorded ${baseline.tag} as applied. From now on use \`generate\` and \`migrate\` for schema changes.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("❌  Baseline failed:", (err as Error).message);
  process.exit(1);
});
