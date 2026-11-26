# Data Management

Governance → Data Management is where administrators see how much sensor data is stored, how fast it grows and whether it is complete, and control when old readings are deleted. It has six tabs.

| Tab | What it is for |
|---|---|
| Overview | Alerts, storage and growth, free disk space, data per project and per asset, summary status |
| Retention | Retention policies, approvals waiting, bad-data removal, legal holds, pruning history (with CSV reports), age limits of other records |
| Data health | Which assets stopped sending, hourly coverage and gaps, busiest metrics, refused ingest requests |
| Archives & backups | Backup status reported by the backup script, daily archive files with download and restore |
| Database | What uses the disk (every table, uploads, archives, backups), monthly partitions, database health with Vacuum |
| Settings | Alert thresholds and webhook, quiet time for assets, pruning window, approval of large deletions, archiving, summary levels |

Reading needs the Data Management module (its own module in Access Control since November 2026; before that it came with Reports, and a user whose Reports access was set individually keeps that setting until Data Management is set). Operators and Viewers do not get it by default (since the 23 Nov 2026 audit); an administrator can still switch it on per user. Anything that deletes, restores, changes settings, downloads raw data or shows database queries also needs the Manage assets permission. Project-restricted users cannot open the page (it covers every project). Every change is written to the activity log.

The previous single-page design is kept as `pages/DataManagementClassic.tsx`; build with `VITE_DATA_MANAGEMENT_CLASSIC=true` to show it instead.

## Summaries

A background job (`artifacts/api-server/src/services/rollups.ts`) summarises raw telemetry per asset and metric at two levels:

| Level | Table | Default retention | Used by charts with steps of |
|---|---|---|---|
| 15 minutes | `telemetry_rollups_15m` | 365 days (Settings; 0 = not built) | 15 minutes to under 1 hour, and as the finer source for longer steps |
| Hourly | `telemetry_rollups` | 1825 days (`RETENTION_ROLLUP_DAYS`, or Settings) | 1 hour and longer |

- On first start each level works through existing data from the oldest reading in 6-hour slices; progress shows on the Overview. Then it runs every 10 minutes and re-counts the last 6 hours for late readings.
- Pruning never deletes raw readings that are not summarised yet.
- `/system/aggregate` (dashboard widgets, reports) fills every quarter hour without raw readings from the 15-minute level, and every hour with neither from the hourly level. Long-term charts therefore survive short raw retention, and gaps in the middle of the history (legal holds, removed bad data) are filled too.
- `TELEMETRY_ROLLUPS=false` switches the job off. Per-asset counts and estimates then disappear and pruning deletes without keeping summaries.

## Storage, growth and projects

- Row totals are the planner estimate (`pg_class.reltuples`); oldest/newest use the timestamp index; everything per asset, metric, day and project comes from the hourly summaries, cached for a minute and refreshed when the summaries move on.
- "Kept for ever, per month" counts readings no policy covers; that is what keeps filling the disk. "Days until full" uses it with the free space at `STORAGE_DISK_PATH` (default `/`) on the API server.
- A project is a root asset; each asset counts towards its root.
- PostgreSQL reuses the space of deleted rows; the file only shrinks with VACUUM FULL, pg_repack, or by dropping partitions.

## Retention and estimates

- The most specific enabled policy decides per reading (asset and metric, then asset, then metric, then all). Same rule in pruning and in estimates.
- The policy dialog, Run pruning now and policy deletion show an estimate from the summaries. In tests it was within 0.3% of the readings actually deleted, including legal holds and archiving.
- **Pruning window** (Settings): the hourly job deletes readings only between the set times (plant time). Other records are still pruned hourly; Run pruning now is not limited. The scheduler checks every 10 minutes, so a window shorter than an hour gets a telemetry run as soon as it opens.
- One failing table does not stop the pruning of the others; each failure is recorded in the pruning history and raises the "Pruning run had a problem" alert.
- **Late readings.** Summaries recount the last 6 hours on each run. Readings that arrive later than that (a gateway catching up) are added to the summaries of their hour and quarter hour on the next run (within 10 minutes). Limits: these totals wait in memory, so readings of that kind that arrive in the 10 minutes before an API restart are not summarised, nor are late readings in the first seconds after start-up; at most 100,000 late buckets wait at once (more are logged and left out).

## Approval of large deletions

When switched on (Settings, off by default), these wait for a second administrator when they would delete more readings than the limit:

- bad-data removal,
- Run pruning now,
- creating, changing or deleting a policy (the extra readings it would delete),
- releasing a legal hold (always, while approval is on),
- settings changes that weaken these safeguards: switching approval off, raising its limit, switching archiving off, or keeping summaries for less time. Other settings changes apply at once.

Approving, rejecting, releasing a hold, changing Data Management settings and deleting a policy need the **approve_data_changes** permission, which only Super Admin, Company Admin and Admin hold. Engineers and Developers can still request removals and policy changes. The request appears under Retention → Waiting for approval. The requester cannot approve their own request but can withdraw it. When no estimate is possible (summaries switched off with `TELEMETRY_ROLLUPS=false`), a change that could delete readings waits for approval instead of going through. Approving a policy, settings or hold change carries it out at once; an approved removal or pruning run starts in the background, shows as Running, and its result (with the readings deleted so far if it failed part-way) appears under Bad-data removals and approvals. A pruning run that cannot start because another is running goes back to waiting. Removals that were running when the API stopped are marked failed at the next start. The hourly run of policies that already exist needs no approval. Installations with a single administrator should leave this off.

## Remove bad data

Retention → Remove bad data deletes the readings of one asset (optionally one metric) in a time range, with a required reason. The dialog shows the count first (exact up to 2,000,000; above that it says "more than", and with approval on the removal always waits for approval). It is refused if a legal hold covers part of the range, and a hold placed while it runs protects its readings from that moment. The removal runs in the background. By default the summaries of those periods are removed too; periods that still have raw readings are recounted either way.

## Legal holds

A hold names an asset, metric and period (any of them may be "any"). Pruning, partition drops and bad-data removal skip held readings. An asset or project whose readings are under a hold cannot be deleted (409 `hold_conflict`). Holds can end by themselves at a set time or be released (approve_data_changes; a second administrator while approval is on); released holds stay listed.

Deleting an asset or project deletes its metadata at once and its readings and both summary levels in batches in the background.

## Archive before delete

When switched on (Settings), pruning first writes every complete UTC day it is about to touch to `ARCHIVE_DIR` (default `var/archives`) as `telemetry/YYYY/MM/YYYY-MM-DD.jsonl.gz`: one JSON line per reading with id, asset, device, metric, value, quality and timestamp, plus a SHA-256 in `data_archives`. Pruning waits while archiving fails, and an alert is raised.

- **Download** returns the day's file (needs Manage assets; logged).
- **Restore** checks the file's SHA-256 first, places a legal hold on the day, then re-inserts the day's readings, skipping those still present. A missing file gives 410 `archive_file_missing`, a changed file 422 `archive_checksum_mismatch`; nothing is inserted.
- Mount a network share or object storage at `ARCHIVE_DIR` to keep archives off the server. The first run archives every day up to the oldest cutoff; plan for roughly a fifth of the telemetry table size.

## Backups

The app records backups that the backup script reports. Install `scripts/ops/nexus-backup.sh` as described in [backup-restore.md](../operations/backup-restore.md) and grant it once:

```sql
GRANT INSERT ON backup_runs TO nexus_backup;
```

Each run records start/finish, result, size, location, whether uploads were included, whether the file was read back, whether it was copied off the server (`OFFSITE_CMD`), the host and a message. The Archives & backups tab shows the status, and an alert is raised when no backup is reported, the last one failed, or the last good one is older than the limit (default 26 hours).

## Alerts

Checked every 10 minutes (and with Check now). Each condition raises one alert that is updated while it lasts and cleared when it goes away:

| Alert | Raised when (defaults, Settings) |
|---|---|
| Disk space low | free space below 15% (critical below half of that) |
| Disk expected to fill up | full within 30 days at the current net growth |
| No backup reported / Last backup failed / Backup out of date | no backup report / last run failed / last good one older than 26 h |
| Summaries are behind | more than 3 hours behind |
| Pruning run had a problem | the last run recorded an error |
| Many ingest requests refused | more than 100 in the last hour |
| Asset(s) stopped sending | an asset that sent in the last 7 days has been quiet longer than the quiet time (60 min) |
| Archiving failed | archiving is on and its last run failed |
| Partition maintenance failed | creating or dropping a monthly partition was refused (usually the database role lacks the right; see backup-restore.md) |

Alerts show in the bell (for users with the Data Management module) and on the Overview, are written to the activity log, and are posted as JSON to the optional webhook (`{source, event: "raised"|"cleared", key, severity, title, message, at, installation}`). The webhook URL is masked when read back. It goes through the same outbound guard as alarm webhooks: private, loopback and link-local targets are refused (unless `ALLOW_PRIVATE_WEBHOOK_TARGETS=true`) and redirects are not followed. Email, SMS and WhatsApp delivery do not exist in the platform yet, so Notification Groups cannot receive these alerts.

## Data health

- Per asset: last reading, quiet or not, share of hours with readings over the last 7 days, missing hours and the longest gaps (from the hourly summaries).
- Busiest metrics over 24 hours, with readings per minute and the interval, to find devices that send far more often than needed.
- Refused ingest requests and MQTT messages, counted per hour, source, endpoint, status and error code (`ingest_rejections`, written every 30 seconds, kept 30 days). Only the error text is kept, never the payload, tokens or client ids from the URL.

## Database

- Size of every table (partitions counted as `telemetry`), the uploads folder, archives, the last backup and the disk.
- Connections (database and app pool), cache hit ratio, queries running longer than 10 seconds (first 160 characters), dead rows and reclaimable space per table, last vacuum and analyse.
- **Vacuum** runs `VACUUM (ANALYZE)` on one table in the background; it does not block readings or writes.

## Monthly partitions

`telemetry` can be converted to one partition per month. Pruning then drops a whole month in one statement and frees its disk space at once, when an all-assets policy exists, the whole month is past the longest retention, summarised, archived (if on) and not under a legal hold. Partial months are still pruned row by row. The current and next two months are created ahead automatically. The database role the API runs as needs the rights listed in [backup-restore.md](../operations/backup-restore.md) section 2.1; when creating or dropping a partition is refused, the Partition maintenance failed alert is raised, the job stops trying for 6 hours and expired months are pruned row by row.

The conversion is a one-off operator step on the server, after a backup:

```bash
pnpm --filter @workspace/db run partition-telemetry              # check only
pnpm --filter @workspace/db run partition-telemetry -- --yes     # convert
pnpm --filter @workspace/db run partition-telemetry -- --rollback
pnpm --filter @workspace/db run partition-telemetry -- --drop-old
```

- It pauses pruning, builds a partitioned copy (partitions in the `telemetry_parts` schema), mirrors new and deleted readings with a trigger while it copies history day by day, builds the indexes, then swaps the tables in one short transaction (ingest waits a moment). Tested with readings arriving during the copy and the swap, including late ones: none lost.
- It needs free disk space about the size of the telemetry table. The old table is kept as `telemetry_parts.telemetry_unpartitioned` until `--drop-old`.
- `--rollback` swaps back, carrying readings that arrived after the swap.
- `drizzle push` cannot manage a partitioned table (it does not see the parent and would try to create `telemetry` again; a table filter did not stop it and offered to drop the partitions). `lib/db/drizzle.config.ts` therefore detects the partitioned table and leaves `telemetry.ts` out of push, and the partitions live in a schema push never reads. Keep using `pnpm --filter @workspace/db run push` as before.

## Settings reference

Stored as JSON in `job_state` (`data_settings`); change them on the Settings tab.

| Setting | Default |
|---|---|
| Alerts: free disk below / full within / no good backup for / summaries behind / refused per hour above | 15% / 30 days / 26 h / 3 h / 100 (0 switches a check off) |
| Alerts: assets that stop sending | on |
| Webhook URL | none |
| Quiet after | 60 minutes |
| Pruning window | off, 01:00–05:00 |
| Approval of large deletions | off, above 1,000,000 readings |
| Archive before delete | off |
| 15-minute summaries / hourly summaries | 365 days / `RETENTION_ROLLUP_DAYS` (1825) |

Server environment variables: `TELEMETRY_ROLLUPS`, `STORAGE_DISK_PATH`, `ARCHIVE_DIR`, `RETENTION_ROLLUP_DAYS`, `RETENTION_RUNS_DAYS` (see `.env.example`).

## Deploying

New tables: `telemetry_rollups`, `telemetry_rollups_15m`, `job_state`, `retention_runs`, `backup_runs`, `system_alerts`, `data_holds`, `data_archives`, `data_change_requests`, `ingest_rejections`. Run `pnpm --filter @workspace/db run push` before starting the new API. On first start the summaries build in the background (about five minutes per level for 40 million readings in tests).
