# Audit Log

The Audit Log (menu **Audit Log**, `/activity-log`, module `activity_log`) records every change made in the application: who did it, what they did, to what, when, from where, whether it worked, and which fields changed. Entries are append-only and hash-chained, so a change or removal made outside the application is detected.

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
   - read-only POSTs (twin values, AI chat)
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
| `prev_hash`, `hash` | The hash chain |
| `timestamp` | When |

**Redaction** (`lib/audit-core.ts` `diffFields`):
- Fields whose names look like secrets show as `[redacted]`: password, secret, token, API key, private key, credential, authorization header, headers, hash, salt, cookie, session id, OTP/MFA seed.
- The fact that such a field changed is still recorded.
- URLs keep only the scheme, host and path. Credentials and query strings are dropped, because they can carry tokens.
- Long values are shortened to 500 characters.

## Tamper evidence

- **Hash chain.** Each entry stores `hash = sha256(prev_hash + "\n" + canonical JSON of its fields)`. Entries are appended inside a transaction holding a Postgres advisory lock, so concurrent writes chain in order.
- **Append-only trigger.** `audit_logs_guard` is created at API start (`ensureAuditStore()`, idempotent). It refuses `UPDATE`, `DELETE` and `TRUNCATE` on `activity_logs`, with two exceptions:
  - The one-time hash backfill (`app.audit_maint`) may fill in `hash` and `prev_hash` on rows that have none, and nothing else.
  - The retention job (`app.audit_retention`) may delete.
- **Older entries.** Entries written before the chain existed are hashed in sequence order at the first start.
- **Verify integrity.** The button runs `GET /activity-log/verify` (security administrators). It walks the chain in batches and reports either "all N entries are unchanged" or the first entry whose link or contents do not match. Each check is itself recorded (`audit.verified` or `audit.verify_failed`); a failure raises an alert.
- **What it protects against.** Someone with direct database access can still switch the trigger off. They cannot change or remove an entry without breaking the chain, unless they also recompute every later hash. For stronger guarantees, export the log regularly (CSV includes the hash), or copy the latest hash somewhere outside the server.

## Retention

- **Default.** Audit entries are kept for `RETENTION_ACTIVITY_LOG_DAYS` (default 365), or the value set in **Audit Log → Settings**.
- **Minimum.** The minimum is **365 days**: smaller values are raised to 365, and 0 keeps entries for ever. The minimum is enforced on the server.
- **How pruning works.** The hourly job deletes the oldest entries as one unbroken run of the chain. It records the last deleted hash as a checkpoint (`job_state` key `audit_checkpoint`), and verification starts from that checkpoint.

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

- **Switching rules off.** Each rule can be switched off in Audit Log → Settings (`job_state` key `audit_settings`).
- **Acknowledging.** Alerts are acknowledged from the bell (Manage security).
- **Not built yet.** Alerts are not sent to notification groups (email or other channels).

## The page

- **Summary cards (last 7 days):**
  - changes per day
  - most active users (click one to filter)
  - sensitive actions
  - failed or denied actions (audit entries plus security events)
- **Search and filters,** all on the server, with the total count:
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
  - **CSV:** server-side, up to 50,000 rows, with the same filters, including the hash.
  - **PDF:** up to 2,000 rows, landscape, Latin-1 only.
  - Each export is itself recorded.
- **Verify integrity and Settings** are shown to users with Manage security and the Security Settings module.
- **History button.** A History button shows one item's change history on:
  - asset details (including changes to its attributes and to things under it)
  - alarm rules
  - users
  - brokers
  - destinations
  - API clients
  - the selected Visualization dashboard

Project-restricted users see only entries about assets in their projects.

## API

| Method | Path | Access |
|---|---|---|
| GET | `/activity-log` | `activity_log`. Filters: `q`, `from`, `to`, `actor` (or `actorName`), `action`, `category`, `outcome`, `targetId`, `assetId`, `includeSecurity`, `limit` (≤500), `offset` |
| GET | `/activity-log/export` | `activity_log`. Same filters; CSV |
| GET | `/activity-log/summary?timeZone=` | `activity_log` |
| GET | `/activity-log/verify` | `security` + Manage security |
| GET | `/activity-log/alerts` | `security` |
| POST | `/activity-log/alerts/:id/acknowledge` | `security` + Manage security |
| GET, PUT | `/activity-log/settings` | `security` + Manage security |

## Installation

These changes add columns, a sequence, indexes and the `audit_alerts` table. After updating:
1. Run `pnpm --filter @workspace/db run push`. It is non-destructive.
2. Restart the API. The trigger is created and existing entries are hashed at start; the log says `audit log: hashed existing entries`.

## Files

| File | Purpose |
|---|---|
| `artifacts/api-server/src/lib/audit-core.ts` | Diffs and redaction, hashing and verification, the safety-net decision, sensitive rules, filter parsing (tested in `tests/audit.test.ts`) |
| `artifacts/api-server/src/lib/audit-store.ts` | Writing entries, trigger, backfill, verify, prune, settings, alerts, search, summary |
| `artifacts/api-server/src/lib/audit-context.ts` | Per-request context (AsyncLocalStorage) and `markAudited()` |
| `artifacts/api-server/src/middleware/audit.ts` | The safety net |
| `artifacts/api-server/src/routes/activity_log.ts` | `logActivity()` and the endpoints |
| `artifacts/iot-platform/src/pages/ActivityLog.tsx` | The page (`ActivityLogClassic.tsx` is the earlier one) |
| `artifacts/iot-platform/src/features/auditLog/` | Shared pieces (`HistoryButton`, detail sheet, timeline) and the PDF export |
