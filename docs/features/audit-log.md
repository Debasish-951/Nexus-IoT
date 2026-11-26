# Audit Log

The Audit Log (menu **Audit Log**, `/activity-log`, module `activity_log`) records every change made in the application: who did it, what they did, to what, when, from where, whether it worked, and which fields changed. Entries are append-only and hash-chained, so a change or removal made outside the application is detected, within the limits described under [Tamper evidence](#tamper-evidence).

The earlier page (category filter and a 25-row table) is kept behind `VITE_CLASSIC_AUDIT_LOG=true`.

## What is recorded

1. **Explicit entries.** Routes call `logActivity(action, category, targetId, targetName, detail, req, opts?)` (`routes/activity_log.ts`). Every write route records itself, including:
   - alarm rules (create, update, delete, webhook test)
   - attributes (create, update, delete)
   - assets (create, update, delete, maintenance, attribute import, template applied)
   - users, access overrides and sessions
   - brokers, destinations (including tests) and API clients
   - templates, dashboards, twins and uploads
   - Data Management (settings, retention, holds, archives, deletions)
   - AI questions and reports
   - self-service password-reset requests (existing accounts only; unknown names go to `security_events` only)
   - data exports through the export API (`export.downloaded`, with the filters but none of the data)
2. **Safety net.** `middleware/audit.ts` runs on every `/api` request. A write (POST, PUT, PATCH, DELETE) that finishes without any `logActivity()` call gets a generic entry, `api.<method>`, with the route pattern, target id and result. It skips:
   - ingest
   - sign-in flows (these are in `security_events`)
   - read-only POSTs (twin values, AI chat, the alert check, and the retention and range-deletion previews)
   - 401, 404 and 429 responses

   Request bodies are never stored. A dashboard layout autosave is deliberately not recorded (`markAudited()`).
3. **Failures.** Failed and refused writes are recorded with outcome `failure` or `denied`.

## Entry fields

`activity_logs` holds the following:

| Column(s) | Meaning |
|---|---|
| `seq` | Insertion order (sequence `activity_logs_seq`) |
| `action`, `category` | What happened |
| `actor_name`, `actor_role`, `actor_username`, `actor_user_id` | Who. Taken from the signed-in session (or the API client), never from request headers; headers are used only for system jobs |
| `target_id`, `target_name` | What it was done to |
| `detail` | Additional context |
| `changes` | Before and after of each changed field, as jsonb `[{field, from, to}]` |
| `outcome` | `success`, `failure` or `denied` |
| `ip`, `user_agent`, `correlation_id` | Where the request came from, and its reference (the same id the user sees in an error) |
| `asset_id`, `project_id` | The asset, and the project it belongs to |
| `prev_hash`, `hash`, `hash_alg` | The hash chain; `hash_alg` is empty for plain SHA-256 entries and `hmac-sha256:<key id>` for keyed ones |
| `timestamp` | When |

**Redaction** (`lib/audit-core.ts` `diffFields`):
- Fields whose names look like secrets show as `[redacted]`: password, secret, token, API key, private key, credential, authorization header, headers, hash, salt, cookie, session id, OTP/MFA seed.
- The fact that such a field changed is still recorded.
- URLs keep only the scheme, the host and the harmless part of the path. Credentials and the fragment are dropped, the query becomes `?…`, path segments that look like tokens become `…`, and on webhook hosts (Slack, Teams, Discord, Google Chat, Power Automate and similar) every path segment after the first does, because the secret is the path.
- The same URL masking is applied to every URL in `detail`, `target_name` and inside `changes` before the entry is written, so it covers the live feed and CSV exports too. Entries written before this change keep what they stored: the log is append-only, so they cannot be scrubbed.
- Text is made well-formed first: half of a surrogate pair (half an emoji, from cutting text or sent like that) is removed, and long values are cut on a character boundary. PostgreSQL cannot store half a pair, so such an entry used to fail to save (in `changes`) or no longer matched its hash (in text). Entries already affected keep failing verification.
- Long values are shortened to 500 characters.

## Tamper evidence

- **Hash chain.** Each entry stores `hash` over the previous entry's hash and the canonical JSON of its own fields. Entries are appended inside a transaction holding a Postgres advisory lock, so concurrent writes chain in order.
  - Entries written before keyed hashing have `hash_alg` empty and use plain `sha256(prev_hash + "\n" + JSON)`. They keep verifying exactly as before.
  - With `SECRETS_ENC_KEY` set, new entries use HMAC-SHA256 with a key derived from it (`hash_alg = hmac-sha256:<key id>`). Without the key nobody can compute a valid hash for a new or changed entry. When keyed hashing starts, a signed `hmac_start` mark is written. After it (and after any keyed entry), a plain SHA-256 entry fails as `downgrade`.
  - Keep `SECRETS_ENC_KEY` (and any retired `SECRETS_ENC_KEY_<id>`) with the backups: without it, keyed entries report `key_missing`.
- **Guard (owner step).** `lib/db/src/audit-guard-sql.ts` holds the triggers and functions, installed by `pnpm --filter @workspace/db run audit-guard` run as the owner of `activity_logs`:
  - `UPDATE` is refused, except the one-time hash backfill, which may only fill `hash` and `prev_hash` on rows that have none.
  - `DELETE` is refused unless the current database role is the table owner and the delete comes from `audit_prune_upto()`. A session setting alone no longer allows it.
  - `TRUNCATE` is always refused.
  - `INSERT` is refused without `seq`, `prev_hash` and `hash`, with a `seq` not after the chain head, or with a `prev_hash` that is not the head's hash.
  - `audit_checkpoints` is insert-only. Only `audit_prune_upto()` may add pruning checkpoints.
- **At API start** the API only checks `pg_trigger` and `audit_guard_version()`. If the guard is missing or out of date it logs an error and raises the **Audit log protection not installed** alert. The exception: when the API's own login owns `activity_logs` (the default single-login install), the API installs or upgrades the guard itself and logs this, so an upgrade does not lose protection.
- **Older entries.** Entries written before the chain existed are hashed once, at start, and only when no entry has a hash yet. A marker (`job_state` key `audit_backfill`) stops it from running again. An unhashed entry that appears later is never sealed: verification reports it as `missing_hash`. Entries without `seq` are reported as `missing_seq`.
- **Chain-head anchors.** Every hour the API writes the chain head (`seq`, `hash` and its MAC) to the application log (`audit log: chain head`; ship journald/syslog off the VM to keep it) and to `audit_checkpoints` (`anchor`). `scripts/ops/nexus-backup.sh` saves the newest head and anchor next to each backup (`audit-anchor-<stamp>.txt`). Verification fails with `head_rollback` or `anchor_mismatch` if the newest signed anchor's entry is gone or has changed, unless retention removed it.
- **Verify integrity.** The button runs `/activity-log/verify` (security administrators). It walks the chain in batches of 2,000 and reports either "N entries are unchanged" or the first entry whose link or contents do not match.
  - With a key, a check starts where the last signed check ended (incremental: the page says from which entry). A full walk runs at least every 7 days, or with `?full=true`.
  - Pruning that runs during a check is followed through its new checkpoint instead of being reported as a break. Concurrent checks share one walk.
  - The pruning checkpoint's MAC is checked (`checkpoint_invalid`).
  - Each check is itself recorded (`audit.verified` or `audit.verify_failed`); a failure raises an alert.
- **What it protects against, and what it does not.**
  - **Full protection** needs two database logins: the owner runs `push` and `audit-guard`, and the application uses a separate login, limited with `audit-guard -- --runtime-role <login>` (it revokes `UPDATE`, `DELETE` and `TRUNCATE` on `activity_logs` and `audit_checkpoints`). With that, someone holding the application's credentials (a shell on the VM, or SQL injection) cannot change, remove or truncate entries. The only entries they can add are ones that link to the chain, and with a key they cannot give them a valid hash.
  - **Single login (default):** the application's login owns the table, so it can switch the triggers off or drop them. The key still stops it from recomputing a valid keyed chain, and the external anchors still show removed or rewritten entries. Treat the log as tamper-evident, not tamper-proof.
  - **Without `SECRETS_ENC_KEY`:** hashes are plain SHA-256. Anyone with database access can recompute them after editing. Only the anchors in the application log and the backup folder can then show the change.
  - `job_state` stays writable: the application keeps its settings there. Nothing verification trusts is kept there any more, except the earlier unsigned checkpoint until the first new one is written.

## Retention

- **Default.** Audit entries are kept for `RETENTION_ACTIVITY_LOG_DAYS` (default 365), or the value set in **Audit Log → Settings**.
- **Minimum.** The minimum is **365 days**: smaller values are raised to 365, and 0 keeps entries for ever. The minimum is enforced on the server.
- **How pruning works.** The hourly job deletes the oldest entries as one unbroken run of the chain, 2,000 at a time. It finds the boundary on the `seq` index, outside the chain lock, then calls `audit_prune_upto()`.
  - That function runs as the table owner. It checks that every entry up to the boundary is older than the retention (never under 365 days, whatever the setting says), deletes them, and inserts the signed checkpoint into `audit_checkpoints`. Verification starts from that checkpoint.
  - The lock is held only for one batch.
  - Installations whose guard is older (no `audit_prune_upto()`) delete directly and keep the checkpoint in `job_state` (`audit_checkpoint`), as before.

## Sensitive-action alerts

These rules raise an alert (`audit_alerts` table) in the notification bell for users with the **Security Settings** module:

| Rule | Raised by |
|---|---|
| Alarm rule deleted or disabled | `alarm_rule.deleted`, or `enabled` changed true → false |
| Administrator role granted | A role raised to admin, company_admin or super_admin (edit or invitation) |
| User deleted | `user.deleted` |
| Data deleted | `data_change.range_deleted`, `archive.deleted`, a retention run that deleted readings |
| API client secret rotated | `api_client.secret_rotated` |
| Audit log integrity check failed | A failed verify |
| Repeated failed sign-ins | 5 or more `login.failure` events for one user name within 10 minutes (one alert per user per hour) |
| Audit log protection not installed | At API start, the append-only guard is missing or out of date and could not be installed (run `audit-guard` as the owner) |

- **Switching rules off.** Each rule can be switched off in Audit Log → Settings (`job_state` key `audit_settings`).
- **Acknowledging.** Alerts are acknowledged from the bell (Manage security).
- **Not built yet.** Alerts are not sent to notification groups (email or other channels).

## The page

- **Summary cards (last 7 days):**
  - changes per day
  - most active users (click one to filter)
  - sensitive actions
  - failed or denied actions (audit entries plus security events)
- **Search and filters,** all on the server, with the total count. Counting stops at 10,000 matches, which is shown as "10,000+" (`totalCapped`):
  - free text
  - date range
  - user
  - action (prefix)
  - category (including AI, Export and Security)
  - result
  - project or asset (anything under it)
- **Include security events** merges sign-ins, refusals and rate limits from `security_events` into the list. Restricted users never see security events.
- **Entry detail.** Click a row for every field and the before/after table.
- **Export:**
  - **CSV:** server-side, up to 50,000 rows, with the same filters, including the hash. Pages are read by time and id (keyset), so entries written during the export do not repeat rows. A failure partway aborts the download.
  - **PDF:** up to 2,000 rows, landscape, Latin-1 only.
  - Each export is itself recorded.
- **Verify integrity and Settings** are shown to users with Manage security and the Security Settings module. A failed export or check shows an error; starting a new check clears the previous result.
- **History button.** A History button shows one item's change history on:
  - asset details (including changes to its attributes and to things under it)
  - alarm rules
  - users
  - brokers
  - destinations
  - API clients
  - the selected Visualization dashboard

Project-restricted users see only entries about assets in their projects: an entry whose target, asset or project is one of their assets. The live feed applies the same rule (`AUDIT_SCOPE_FIELDS` in `lib/audit-core.ts`).

## Personal data

Entries hold the actor's name, user name, IP address and device, and sometimes names typed into fields. Deleting a user does not remove their entries: the log is append-only, and removing or editing entries would break the chain. They leave only through retention, after the retention period, and stay in backups until those expire. Say so in the privacy notice. For an erasure request, record that the entries are kept under the audit obligation until retention removes them.

## API

| Method | Path | Access |
|---|---|---|
| GET | `/activity-log` | `activity_log`. Filters: `q`, `from`, `to`, `actor` (or `actorName`), `action`, `category`, `outcome`, `targetId`, `assetId`, `includeSecurity`, `limit` (≤500), `offset` |
| GET | `/activity-log/export` | `activity_log`. Same filters; CSV |
| GET | `/activity-log/summary?timeZone=` | `activity_log` |
| GET | `/activity-log/verify` (`?full=true` for a full walk) | `security` + Manage security |
| GET | `/activity-log/alerts` | `security` |
| POST | `/activity-log/alerts/:id/acknowledge` | `security` + Manage security |
| GET, PUT | `/activity-log/settings` | `security` + Manage security |

## Installation

1. Run `pnpm --filter @workspace/db run push`. It is non-destructive: it adds the `hash_alg` column, the `audit_checkpoints` table and the `activity_logs_asset_idx` index.
2. Restart the API.
   - **Single login (the API's login owns the tables):** the API installs or upgrades the guard itself and logs `audit log: installing the append-only guard`.
   - **Separate owner login:** run `pnpm --filter @workspace/db run audit-guard` with `AUDIT_GUARD_DATABASE_URL` (or `DATABASE_URL`) set to the owner login. Until you do, the API logs an error and raises the **Audit log protection not installed** alert. `-- --print` prints the SQL without running it.
3. Optional, recommended: give the application its own login and limit it with `pnpm --filter @workspace/db run audit-guard -- --runtime-role <login>`. Do this after the API has started once on the new version: the one-time backfill of entries from before the chain needs `UPDATE`.
4. Set `SECRETS_ENC_KEY` (it is required in production anyway) so new entries are keyed.

`seq` stays nullable in the schema, because `push` cannot make it NOT NULL safely on every existing table. The insert trigger refuses new entries without `seq`. To make the column NOT NULL, the owner can run `ALTER TABLE activity_logs ALTER COLUMN seq SET NOT NULL` once no row has a NULL `seq`. The next `push` would undo it, so the trigger is what enforces it.

## Files

| File | Purpose |
|---|---|
| `artifacts/api-server/src/lib/audit-core.ts` | Diffs and redaction, hashing and verification, the safety-net decision, sensitive rules, filter parsing (tested in `tests/audit.test.ts`) |
| `artifacts/api-server/src/lib/audit-store.ts` | Writing entries, guard check, backfill, anchors, verify, prune, settings, alerts, search, summary |
| `lib/db/src/audit-guard-sql.ts`, `lib/db/src/audit-guard.ts` | The guard's SQL (triggers, `audit_prune_upto()`, grants) and the owner-run script |
| `artifacts/api-server/src/lib/audit-context.ts` | Per-request context (AsyncLocalStorage) and `markAudited()` |
| `artifacts/api-server/src/middleware/audit.ts` | The safety net |
| `artifacts/api-server/src/routes/activity_log.ts` | `logActivity()` and the endpoints |
| `artifacts/iot-platform/src/pages/ActivityLog.tsx` | The page (`ActivityLogClassic.tsx` is the earlier one) |
| `artifacts/iot-platform/src/features/auditLog/` | Shared pieces (`HistoryButton`, detail sheet, timeline) and the PDF export |
