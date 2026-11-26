# Remediation Verification Report — 26 November 2026

Covers the fixes for every finding of the [23 November 2026 audit](audit-2026-11-23.md) (P0 to P3), approved by the owner on 26 November 2026. Base commit: `ffe8e47`.

**Status labels**
- **Fixed:** the root cause is changed and covered by a test or the live check below.
- **Partly:** the main risk is removed; the remainder is stated.
- **Docs:** the finding is about documentation or deployment, and the documentation is corrected.
- **Not a bug:** checked in the code; the evidence is given.

## Verification

**Automated gates** (merged code):
- `tsc --build` (libraries): passes.
- Typecheck of api-server, iot-platform and mockup-sandbox: passes.
- API regression tests: **219 of 219 pass**, up from 128. 91 new tests are in `access-identity`, `data-safeguards`, `audit-log-integrity`, `live-feed-ingest`, `ai-limits`, `twin-fixes`, `audit-g` and `zod4-upgrade`.
- `pnpm audit --prod`: no known vulnerabilities.
- API (esbuild) and SPA (vite) production builds: succeed.

**Live check on a throwaway database.** This was a separate database, `nexus_audit_scratch`, created and dropped for the test. The working database was not touched. Steps: schema `push` and `seed`, then the merged API was started and exercised over HTTP. Results:

| Check | Result |
|---|---|
| Account activation, sign-in and session | Pass |
| Asset update and asset delete (audited writes) | Pass. After the delete, the asset's readings were removed in the background |
| API key creation; ingest with the key | Pass. The ingest response no longer contains alarm webhook URLs |
| Retried identical ingest | Accepted with 0 rows written (no duplicate) |
| `/api/v1/assets` with a key | Pass |
| `POST /assets/live-summary` | Pass. One call returns status for many assets |
| Malformed id on `/telemetry/:id/metrics` | 400 (it was 500) |
| `/dashboard/attention` and `/system/storage` | Pass |
| `GET /activity-log/verify` | Refused (403) |
| `POST /activity-log/verify` | `ok: true`, keyed. A second check was incremental |
| Audit-log guard on an upgraded database | Installed automatically at start-up, because the login owns the table |
| Audit entries | All hashed and all keyed (`hmac-sha256`) |
| Direct SQL `DELETE`, `UPDATE` or `TRUNCATE` on `activity_logs` | Refused. This includes `SET app.audit_retention='on'`, which allowed deletes before the fix |
| Forged `INSERT` without a chain link | Refused |
| `audit_prune_upto()` on entries younger than the retention period | Refused |
| Alarm webhook URLs at rest | None left in plain text |

**Not tested.** These need a real VM or a browser:
- the browser walkthrough: Live Twin save guards, GPU memory, WebGL context loss, and the CSP with GLB textures;
- the nginx limits on a VM;
- the hardened two-login database setup (`audit-guard -- --runtime-role`);
- partitioned telemetry under the restricted role;
- MQTT broker connections through the new address check.

## Findings

### HIGH

| ID | Status | What changed |
|---|---|---|
| H-1 | Fixed | Key edit, rotate, regenerate-ingest-url, restore, delete and the Integration Hub access, rotate and end-grace routes answer 404 when the key holds a scope the caller could not grant (`lib/api-client-ceiling.ts`). Empty scopes count as `*`. Revoke stays open, since switching a key off is the safe direction |
| H-2 | Fixed | New permission `approve_data_changes`, held by admin roles only. It is required for approve, rejecting others' requests, hold release, data settings and policy delete. While approval is on, hold release and weakening settings changes become approval requests (202). Approval fails closed when summaries are off. A start-up check refuses a `level` rule on a simple module; 49 such rules were cleaned |
| H-3 | Fixed | Asset and project delete answers 409 `hold_conflict` when the subtree is held. Metadata is deleted in the transaction; telemetry and both summary tables are deleted afterwards in batches that skip held readings |
| H-4 | Fixed | 410 `archive_file_missing`, 422 `archive_checksum_mismatch` and 422 `archive_unreadable`. Restore and download use `pipeline`. The hold is placed before rows are inserted |
| H-5 | Fixed | The audit guard DDL moved to the owner script `pnpm --filter @workspace/db run audit-guard`. Start-up only checks it, and raises the `audit_guard_missing` alert. A single-login install still installs it automatically. Partition DROP failures no longer stop pruning; partition DDL errors raise `partitions_failed`. The `telemetry_parts` grants are documented |
| H-6 | Fixed | 3D, 2D, tag and process twins save only when the loaded twin is the selected twin; Save is disabled while loading or after a failure. The server takes `expectedUpdatedAt` with `FOR UPDATE` and answers 409 `plant_twin_conflict`. Older tabs without the field are accepted and logged |
| H-7 | Fixed | Audit-log triggers now check the database role inside `audit_prune_upto()` instead of a session setting. An insert guard checks `seq`, `prev_hash` and `hash`. TRUNCATE is always refused. New entries are HMAC-keyed from `SECRETS_ENC_KEY` (`hash_alg`); old entries verify unchanged. Checkpoints are signed in the insert-only `audit_checkpoints`, and the chain head is anchored hourly to the log, the database and the backups. The compliance docs now claim tamper-evident, not tamper-proof. `job_state` keeps its write access, because the app stores settings there; nothing verification trusts lives there any more |
| H-8 | Fixed | `POST /assets/live-summary` answers up to 500 ids per call with set queries. Live Feed polls in chunks of 200, backs off on 429, and shows "Status unknown" instead of ageing assets to offline. `assetScope` is cached for 5 s and cleared on asset writes |

### MEDIUM

| ID | Status | What changed |
|---|---|---|
| M-1 | Fixed | A lockout no longer ends live sessions. It now applies per account and network (/24 or /64), using `AUTH_LOCKOUT_THRESHOLD`. The account-wide lock fires only after `AUTH_LOCKOUT_ACCOUNT_THRESHOLD` (default 25) failures |
| M-2 | Fixed | New `uploads.project_id`. Project-restricted users list and download only their own projects' files plus shared files (no project). Delete is limited to the uploader or an administrator |
| M-3 | Fixed | `includeSecurity=true` needs Manage security (403 `manage_security_required`), on export too |
| M-4 | Fixed | `/dashboard/attention` leaves out alarms without the Alarms module and keys without API Clients |
| M-5 | Fixed | A restricted admin can manage only users inside their own projects, checked before and after each change (403 `project_scope`) |
| M-6 | Fixed (new entries) | Webhook URL secrets are masked in audit details, names and change records, and so in the WebSocket feed and CSV too. Existing entries cannot be changed |
| M-7 | Fixed | Broker address policy (`lib/broker-target.ts`), checked on save and on every connection with the resolved address. Link-local, metadata, multicast and reserved addresses are always refused. Loopback and the plant LAN are allowed by default (`ALLOW_LOOPBACK_BROKER_TARGETS`, `ALLOW_PRIVATE_BROKER_TARGETS`). Raw connection errors are shown only to Super and Company Admins |
| M-8 | Fixed | The Data Management alert webhook uses `safeFetch` (URL guard, no redirects) and is checked on save |
| M-9 | Fixed | Lone surrogates are stripped and text is clipped on code-point boundaries before hashing and storing. Rows already affected stay as they are |
| M-10 | Fixed | The backfill runs once at start-up, behind a marker. Unhashed rows that appear later are reported, never sealed. Entries without `seq` are reported as `missing_seq` |
| M-11 | Fixed | Capped report queries are ordered and detect the cap. Truncation is flagged on the page, in the PDF, in the CSV and to the model. Raw reads share a time budget (`AI_REPORT_RAW_BUDGET_MS`). Last-seen falls back to summaries |
| M-12 | Fixed | New index `activity_logs_asset_idx`. The count is capped at 10,000 (`totalCapped`). The export uses keyset pages, so no duplicate rows. Text search still scans; a trigram index would need an extension |
| M-13 | Fixed | Verify runs in batches of 2,000, incrementally from a signed mark, with a full walk at least weekly or with `?full=true`. Concurrent checks share one walk. Pruning during a check no longer raises a false CRITICAL |
| M-14 | Fixed | The twin list, moves and delete read only metadata. Moves use `jsonb_set`. Folder delete runs in one transaction |
| M-15 | Fixed | The global guard allows 40,000 keys on the twin save routes. Size-only refusals are no longer logged as attacks |
| M-16 | Fixed (bounded) | Readings older than the 6-hour recount window are added to the summaries at the next run. Up to 100,000 waiting buckets are kept in memory, and they are lost on restart (documented) |
| M-17 | Fixed | Indexes on `assets(identifier)`, `assets(parent_id)` and `alarm_history(asset_id, triggered_at)`. The telemetry limit is clamped to 10,000. Exact repeats of the newest reading are dropped at ingest. An optional owner-run unique index is documented |
| M-18 | Fixed | Same save guard as H-6, in the tag and process twins |
| M-19 | Fixed | Materials and textures are freed on scene switch and removal. The GLB cache is an LRU of 6 that frees evicted models. Everything is freed on dispose |
| M-20 | Fixed | Each table is pruned separately; failures are listed and alerted, and the counts are kept |
| M-21 | Fixed | User delete closes the user's sockets. Open sockets are re-checked every `WS_SESSION_CHECK_MS` (60 s) and closed when the session or user is no longer valid |
| M-22 | Fixed | nginx `client_max_body_size 12m`, and the AI timeout note. The chat page shows a plain message for non-JSON gateway errors |
| M-23 | Fixed | The prune boundary is read outside the lock. The locked part is one batch of 2,000 |

### LOW

| ID | Status | What changed |
|---|---|---|
| L-1 | Fixed | Only users who see all projects may create a twin without a project or clear its project |
| L-2 | Fixed | Moving a Visualization node needs ownership of the node or one of its parents |
| L-3 | Fixed | Operators and Viewers no longer get Data Management by default. Per-user overrides still apply |
| L-4 | Fixed / labelled | The `alarm` and `telemetry` WebSocket channels are gated by module. `restrictDashboards` and `restrictAnalytics` are not enforced anywhere; the Users screen says so plainly |
| L-5 | Fixed | The 92-day cap (already present) is now also checked in the UI. Long lookups have a raw-read budget, and there is no second raw scan |
| L-6 | Fixed | The remaining gap was the scope name typed by the user; it is now passed as quoted untrusted data |
| L-7 | Fixed | The pruning report and the 2D-twin mapping CSV use the shared formula-safe `csvCell` |
| L-8 | Fixed | Alarm webhook URLs are encrypted at rest, and existing rows are encrypted once at start-up. Logs show only the origin. Also fixed: ingest responses no longer return webhook URLs to the device gateway |
| L-9 | Fixed | Verify is POST only |
| L-10 | Fixed | The SVG sanitiser decodes CSS escapes and comments, and refuses non-fragment `url(`, `image-set(`, `@import` and similar. 14 bypass tests |
| L-11 | Docs | `blob:` added to `connect-src` in the nginx CSP; GLTFLoader reads embedded textures through blob URLs |
| L-12 | Fixed | The thumbnail renderer releases its WebGL context after 5 s idle, handles context loss and never caches blank images |
| L-13 | Fixed | Export and verify failures show a toast, and a stale result is cleared |
| L-14 | Fixed | The AI Advisor cancels requests in flight, shows clear error messages and translates its strings |
| L-15 | Fixed | The alarm clear is conditional (`UPDATE … RETURNING`); only the winning request fires notifications |
| L-16 | Fixed | One scope rule for the live feed and the Audit Log |
| L-17 | Fixed | Read-only POSTs are not recorded as changes |
| L-18 | Fixed | 400 instead of 500 for malformed ids and dates |
| L-19 | Fixed | Site placement re-reads the attributes and updates existing Latitude and Longitude, one save at a time per project |
| L-20 | Fixed | Pruning collisions answer 409 or wait instead of failing. Changes to a deleted policy fail with a message. The Audit Log retention shown comes from its setting. 18 Nov FN-5, FN-6 and FN-9 are fixed |
| L-21 | Fixed | Suspension revokes reset and activation links. The last Super or Company Admin is protected (409 `last_top_admin`). Unknown project ids answer 400 |
| L-22 | Partly / Not a bug | `?action=` is used once. "12,345" is read as one number. In-route refusals are logged. The PDF already printed the unverified-numbers warning |
| L-23 | Fixed / Partly | Byte-based 2D size check. Bindings beyond 500 are batched. Site status reads up to 5,000 alarms. Twin folder cycles are refused under a lock. Visualization node cycles are refused, but without a lock (two simultaneous moves could still loop; reads already tolerate it) |
| L-24 | Fixed | The hold check is atomic with each delete batch (advisory locks). The range count is capped at 2,000,000. Removals run in the background with status, and interrupted ones are marked failed at start-up |
| L-25 | Fixed | Data Management queries run one after another, and the storage figures are cached for 5 s |
| L-26 | Partly | `mfa_secret` is no longer read. CHECK constraints and the `security_events` chain are documented, not added (existing data cannot be guaranteed valid) |
| L-27 | Fixed | Switching an audit alert off needs a second admin (`AUDIT_ALERTS_SECOND_ADMIN`, default on). An admin cannot acknowledge alerts raised by their own action |

### INFORMATIONAL

| ID | Status | What changed |
|---|---|---|
| I-1 | Fixed | "Ask AI Advisor" stays visible but disabled for project-restricted users, with the reason. The server refusal is unchanged |
| I-2 | Docs | Groq data transfer documented. Correction: `get_recent_changes` sends the display name and role of whoever made each change |
| I-3 | Fixed | `DEBUG_ERRORS` is ignored in production, with a log entry |
| I-4 | Docs | Keep `.env` out of synced folders. The `lib/db` scripts now honour `DOTENV_CONFIG_PATH` |
| I-5 | Fixed | 198.18/15, 224/4, 240/4 and every IPv6 form that embeds an IPv4 address are blocked. `safeFetch` pins the checked address (no DNS rebinding) |
| I-6 | Fixed | The GLB scan covers the whole file |
| I-7 | Docs | The privacy notes say user deletion cannot remove entries from the append-only log |
| I-8 | Fixed | `pages/AnalyticsKpi.tsx` deleted |
| zod advisory | Fixed | zod 4.6.7 (GHSA-mrhx-c7xc-m3w5 cleared, before the 2026-12-10 deadline). Orval now emits zod 4. `format: uuid` maps to the `z.guid()` pattern, so the seed's fixed ids still validate. Partial updates no longer fill defaults (`partialUpdate()`). Optional query parameters stay absent as before. `@hookform/resolvers` 5.9.2 |

### Found during the work, still open

- **Array length limits inside request bodies are not enforced.** The validator's strictness pass rebuilds arrays without their `.min()`/`.max()`. This was already true under zod 3. It affects, for example, `boundedArray(…, 32)`, dashboard widgets (500) and the live-summary ids (500); the SPA itself sends at most 200. It is left unchanged because enforcing it could start refusing requests that work today. Fix: keep the array checks in the strictness pass, after checking the largest real payloads.
- **Validation messages changed wording with zod 4.** The response shape (`error`, `code: "invalid_request"`, `errors[].field`) is unchanged, but zod's own texts differ: "Required" now reads "Invalid input: expected string, received undefined". Custom messages are unchanged. Integrations that match on message text, which they should not, would notice.
- **Creating an asset needs a registered device id.** This is existing behaviour, not a regression; it is noted because the live check met it.

## Upgrade steps

1. **Run `pnpm --filter @workspace/db run push` before restarting the API.** It adds, all safe for existing data:
   - columns `uploads.project_id` and `activity_logs.hash_alg`;
   - table `audit_checkpoints`;
   - indexes on `assets`, `alarm_history`, `activity_logs` and `uploads`.

   On a very large `alarm_history`, create its index first with `CREATE INDEX CONCURRENTLY` (see `docs/operations/database-migrations.md`).
2. **Start the API.** On a single-login install it installs the audit-log guard itself. For the hardened two-login setup, run `pnpm --filter @workspace/db run audit-guard -- --runtime-role <login>` as the owner, after the first start.
3. **nginx:** add `client_max_body_size 12m;` and `blob:` to `connect-src` (see the deployment checklist).
4. Keep `SECRETS_ENC_KEY` with the backups. Keyed audit entries and alarm webhook URLs now depend on it.

## Behaviour changes to tell users

- Engineers and Developers can no longer approve data changes, release legal holds, change Data Management settings or delete retention policies.
- Operators and Viewers lose Data Management unless it is granted per user.
- Range delete and approved removals or pruning runs answer 202 and run in the background.
- `AUTH_LOCKOUT_THRESHOLD` now counts per network. The account-wide lock comes after 25 failures.
- Switching an audit alert off needs two admins. A single-admin install sets `AUDIT_ALERTS_SECOND_ADMIN=false`.
- Verify is POST only.
- Twin saves from a tab opened before the upgrade still work, but are logged.

## New settings (all optional)

| Setting | Default | Purpose |
|---|---|---|
| `AUTH_LOCKOUT_ACCOUNT_THRESHOLD` | 25 | Failures from any network before the account-wide lock |
| `WS_SESSION_CHECK_MS` | 60000 | How often open WebSockets are re-checked |
| `AUDIT_ALERTS_SECOND_ADMIN` | true | Two admins to switch an alert off |
| `AI_REPORT_RAW_BUDGET_MS` | 25000 | Raw-read time budget per AI report |
| `ALLOW_PRIVATE_BROKER_TARGETS` | true | MQTT brokers on private addresses |
| `ALLOW_LOOPBACK_BROKER_TARGETS` | true | An MQTT broker on the same machine |
| `AUDIT_GUARD_DATABASE_URL` | `DATABASE_URL` | Owner login for the `audit-guard` script |
