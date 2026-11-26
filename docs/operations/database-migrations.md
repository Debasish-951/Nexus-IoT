# Database Migrations

**Status:** prepared, not yet the default. Production schema changes are still applied with `pnpm --filter @workspace/db run push`, as the [VM deployment checklist](vm-deployment-checklist.md) describes. This page describes the reviewed-migration workflow that can replace it, and the one-time step to adopt it.

## Why change

`drizzle-kit push` compares the schema in `lib/db/src/schema/` with the live database and changes the database directly. Nothing is written down for review, and a rename can be proposed as "drop the old column, add a new one", which deletes that column's data. Migrations are SQL files generated from the schema, read and committed before they run, and applied in order. The database records which ones it has.

## Files

| Path | What it is |
|---|---|
| `lib/db/migrations/0000_baseline.sql` | The whole schema as of November 2026 |
| `lib/db/migrations/meta/` | Drizzle's journal and schema snapshots. Commit these with the SQL. |
| `lib/db/src/baseline-migrations.ts` | One-time adoption script for an existing database |

## Making a schema change with migrations

1. Change the schema files in `lib/db/src/schema/`.
2. Generate the migration, with a short name:
   ```bash
   pnpm --filter @workspace/db run generate -- --name add_widget_owner
   ```
3. Read the new SQL file in `lib/db/migrations/`. Look in particular for `DROP` statements and for renames shown as drop plus add. Edit the SQL if needed (for example `ALTER TABLE ... RENAME COLUMN` instead of drop and add).
4. Commit the SQL file and the updated `meta/` files together with the schema change.
5. On each installation, back up first ([backup-restore.md](backup-restore.md)), then:
   ```bash
   pnpm --filter @workspace/db run migrate
   ```

## Adopting migrations on an existing installation (one time)

An installation built with `push` already has all tables, so the baseline must be recorded as applied rather than run.

1. Back up the database.
2. Deploy the code version that contains `0000_baseline.sql`.
3. Bring the schema up to date with that code:
   ```bash
   pnpm --filter @workspace/db run push
   ```
4. Record the baseline:
   ```bash
   pnpm --filter @workspace/db run baseline-migrations
   ```
5. Check that nothing is pending:
   ```bash
   pnpm --filter @workspace/db run migrate
   ```
6. From now on use `generate` and `migrate`. Do not run `push` on this database again; it would change the schema without recording a migration.

A new, empty database needs no baseline step: run `migrate` and it creates everything.

## Switching the documented default

When every installation has been through the adoption step, change the VM deployment checklist to use `migrate` instead of `push`, and update CLAUDE.md. Until then both paths work: `push` ignores the migration files.

## Indexes and schema hygiene (audit 23 Nov 2026, M-17 and L-26)

### New indexes (applied by `push`)

`assets_identifier_idx` on `assets(identifier)` (ingest looks up every payload's device id), `assets_parent_id_idx` on `assets(parent_id)` (tree walks and deletes) and `alarm_history_asset_triggered_idx` on `alarm_history(asset_id, triggered_at)`. They are additive. `push` builds them with a plain `CREATE INDEX`, which blocks writes to that table while it runs: seconds for `assets`; for a very large `alarm_history`, build it first by hand so `push` finds it already there:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS alarm_history_asset_triggered_idx ON alarm_history (asset_id, triggered_at);
```

On the migration workflow, generate a migration for these after merging (`generate`), as for any schema change.

### Repeated telemetry: optional unique index (owner-run)

Ingest no longer stores a reading that exactly repeats the newest stored one (same asset, metric, device timestamp and value), which is what a gateway retry produces. It does not catch a retry of an older message that newer data has already overtaken, and rows stored before the fix may already contain repeats. The table can hold tens of millions of rows, so the schema deliberately has **no** unique constraint: `push` would try to build it in one blocking step and fail on the first existing repeat.

An owner who wants every repeat refused can add the index by hand, in a quiet period, after a backup. The insert already uses `ON CONFLICT DO NOTHING`, so no code change is needed and repeats are then skipped silently.

1. Count the repeats (read-only; slow on a large table):
   ```sql
   SELECT count(*) FROM (
     SELECT 1 FROM telemetry GROUP BY asset_id, metric, "timestamp" HAVING count(*) > 1
   ) d;
   ```
2. Remove them, keeping one row of each group (run per month on a big table by adding a `"timestamp"` range to both queries):
   ```sql
   DELETE FROM telemetry t
   USING telemetry k
   WHERE t.asset_id = k.asset_id AND t.metric = k.metric AND t."timestamp" = k."timestamp"
     AND t.id > k.id;
   ```
3. Build the index without blocking ingest. On a non-partitioned table:
   ```sql
   CREATE UNIQUE INDEX CONCURRENTLY telemetry_asset_metric_ts_uq ON telemetry (asset_id, metric, "timestamp");
   ```
   On a partitioned table (`partition-telemetry` has been run), `CONCURRENTLY` is not available on the parent: build it `CONCURRENTLY` on each `telemetry_parts.p*` partition, then `CREATE UNIQUE INDEX ... ON ONLY telemetry (...)` and `ALTER INDEX ... ATTACH PARTITION` for each one.
4. If step 3 fails, a repeat arrived meanwhile: drop the invalid index (`DROP INDEX CONCURRENTLY telemetry_asset_metric_ts_uq`), repeat steps 2 and 3.

`push` does not know this index and may offer to drop it; answer no, or add it to `lib/db/src/schema/telemetry.ts` as `uniqueIndex("telemetry_asset_metric_ts_uq")` once every installation has it. The existing `idx_telemetry_asset_metric_ts` then becomes redundant and can be dropped.

### CHECK constraints on enum-like columns (not added)

Several text columns hold one of a fixed set of values, enforced only by the API: `alarms.status` (active, acknowledged, cleared), `alarms.severity` and `alarm_rules.severity` (critical, high, medium, low, info), `alarm_rules.alarm_type`, `alarm_rules.operator`, `attributes.type`, `users.role`, `users.status`. A CHECK constraint is not added in the schema because the existing data cannot be shown to be valid on every installation (older versions and hand edits), and a failing constraint would make `push` stop half way. To add one, first confirm no row breaks it, for example:

```sql
SELECT status, count(*) FROM alarms WHERE status NOT IN ('active','acknowledged','cleared') GROUP BY status;
```

and only when that returns nothing add it to the Drizzle schema with `check()` so `push` and the schema agree (a constraint added only by hand is dropped by the next `push`).

### Other notes

- `security_events` is pruned by age (`SECURITY_EVENT_RETENTION_DAYS`, 90) and capped at `SECURITY_EVENT_MAX_ROWS` (500,000) rows. Unlike the audit log it is not hash-chained, so it is evidence for investigation, not tamper-evident. Raise the cap, or export it, if you need longer history.
- `users.mfa_secret` is an unused seam for a future TOTP feature and would hold a plaintext secret. Nothing writes it, the API never returns it, and since this change the per-request sign-in lookup no longer reads it. It is kept so `push` does not drop a column; a later release drops it (or replaces it with an encrypted column) when MFA is built. Check it is empty with `SELECT count(*) FROM users WHERE mfa_secret IS NOT NULL;`.
