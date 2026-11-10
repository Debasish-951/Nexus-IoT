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
