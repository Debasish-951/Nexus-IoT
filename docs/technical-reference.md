# WS-Integrated Suite

A full-stack industrial IoT data acquisition and analytics platform.

## Architecture

### Monorepo Structure
```
artifacts/api-server/     — Express 5 REST API (port 8080, path /api)
artifacts/iot-platform/   — React + Vite frontend (port auto-assigned, path /)
lib/api-spec/             — OpenAPI 3.1 spec + Orval codegen config
lib/api-client-react/     — Generated React Query hooks + fetch client
lib/api-zod/              — Generated Zod schemas (ONLY exports ./generated/api)
lib/db/                   — Drizzle ORM schema + migrations (PostgreSQL)
scripts/                  — Utility scripts
```

### Database Tables
- `assets` — hierarchical asset tree (self-referencing parentId); maintenanceMode, maintenanceSince, maintenanceNote suppress alarm evaluation while set
- `attributes` — asset attributes (static/dynamic/metric/runtime) with tagName, sourceMetric, UoM, decimalPlaces, thousandSeparator, quality, timestamp, expression
- `asset_templates` — reusable attribute blueprints with expression support
- `telemetry` — time-series sensor readings (assetId, deviceId, metric, value, quality, timestamp)
- `viz_dashboards` — visualization dashboards (id, name, roleFilter, assetFilter, widgets JSON, createdAt, updatedAt)
- `alarms` — active alarm instances with severity/status/class
- `alarm_history` — historical alarm records
- `alarm_rules` — threshold/deviation/rate_of_change/heartbeat rule definitions + webhookUrl, webhookEnabled, rocWindow
- `users` — platform users with roles (admin/engineer/operator/viewer)
- `brokers` — MQTT/REST/Azure IoT broker configurations + mqttUsername, mqttPassword, mqttTopic, mqttClientId, mappingRules (JSONB)
- `broker_events` — immutable connection history log: brokerId, brokerName, status (connected/disconnected/error), message, timestamp
- `api_clients` — OAuth client credentials with scopes, expiresAt, allowedIps, description, secretRotatedAt, totalRequests, lastUsedAt
- `destinations` — webhook/HTTP forward destinations with auth, enabled toggle, eventTypes filter
- `activity_logs` — audit trail, append-only and hash-chained: seq, action, category, actorName, actorRole, actorUsername, actorUserId, targetId, targetName, detail, changes (jsonb before/after), outcome (success | failure | denied), ip, userAgent, correlationId, assetId, projectId, prevHash, hash, timestamp. A trigger (`audit_logs_guard`, created at API start) refuses UPDATE/DELETE/TRUNCATE except the hash backfill and the retention job. See `docs/features/audit-log.md`
- `audit_alerts` — sensitive-action alerts for the notification bell: rule, severity, title, message, entryId, dedupeKey, status (active | acknowledged), raisedAt, acknowledgedBy, acknowledgedAt
- `plant_twins` — 3D plant twins (Live Twin → 3D plant twins): id (text, `pt-…`), name, projectId (root asset, `ON DELETE SET NULL`, null = every project), ownerId, scene (JSONB: areas, sub-processes, machines with settings, position, linked assetId and reading→metric map, connections, demo switch). See docs/features/plant-twin.md

### API Routes (all under /api)
- `GET/POST /api/assets` — list/create assets
- `GET/PUT/DELETE /api/assets/:id` — get/update/delete asset
- `GET/POST /api/assets/:id/attributes` — list/add asset attributes
- `POST /api/assets/:id/attributes/bulk` — bulk import attributes (CSV/JSON)
- `POST /api/assets/:id/apply-template` — apply template (stamps attributes with expression support)
- `GET/PUT/DELETE /api/attributes/:id` — manage individual attributes
- `GET/POST /api/asset-templates` — list/create templates
- `POST /api/ingest/payload` — single payload ingest (normalise + write telemetry + evaluate runtime attrs + fire alarm rules + deliver webhooks)
- `POST /api/ingest/validate` — dry-run: resolves deviceId, extracts metrics, checks asset match — does NOT write to DB
- `POST /api/ingest/batch` — batch ingest array
- Ingest repeats: a reading with the same metric, device timestamp and value as the newest stored one (a gateway retrying a post whose reply it lost) is not stored again; the result then carries `duplicatesSkipped`. Readings without a device timestamp are always stored. An optional owner-run unique index catches every repeat: `docs/operations/database-migrations.md`
- `GET /api/telemetry/:assetId` — query telemetry (metric, from, to, limit filters); from/to coerced from ISO strings; `limit` default 100, values above 10000 are treated as 10000
- `GET /api/telemetry/:assetId/metrics` — distinct metric keys for an asset (used by widget dialog when no attributes exist)
- `GET /api/telemetry/:assetId/export` — CSV export of telemetry (cells pass through `csvCell`, so a value starting with = + - @ is written as text; numbers stay numeric)
- `GET /api/assets/:assetId/health` — asset health score (freshness%, activeAlarms, lastSeen, keyMetrics)
- The four routes above answer 400 for an asset id that is not a UUID or a date that cannot be read (they used to answer 500)
- `POST /api/assets/live-summary` (Assets read) — Live Feed poll. Body `{ids: uuid[]}` (at most 500). Returns per existing asset `{assetId, lastSeen, activeAlarms, expectedInterval, attributes: [{name, type, tagName, sourceMetric, value, uom, decimalPlaces, timestamp}]}` (dynamic, metric and runtime attributes) from three set queries. A project-restricted caller naming an id outside their projects gets 403 `project_forbidden`. Not written to the audit log (a read sent as POST)
- `GET /api/alarms` — list alarms (filter by severity/status), newest first; `?limit` default 500, max 5000; still returns a plain array
- `POST /api/alarms/:id/acknowledge` — acknowledge an ACTIVE alarm (409 `alarm_not_active` otherwise); also marks its open history row acknowledged and sets `alarm_history.acknowledged_at`
- `GET /api/alarm-history` — paginated alarm history
- `GET/POST /api/alarm-rules` — list/create alarm rules (threshold + rate_of_change + webhook fields)
- `PUT/DELETE /api/alarm-rules/:id` — update/delete rule
- `POST /api/alarm-rules/:id/test-webhook` — fire a test webhook POST
- `GET/POST /api/users` — list/create users. A project-restricted administrator may create and manage only users restricted to projects of theirs, before and after the change (403 `project_scope`). `allowedProjects` must be project ids (400 `unknown_project`). Suspending or deactivating a user also revokes their activation and reset links. The last active administrator, and the last active Super Admin / Company Admin, cannot be demoted, deactivated or deleted (409 `last_admin` / `last_top_admin`). Deleting a user closes their WebSockets
- `GET/POST /api/brokers` — list/create brokers. Create/update persist `mqttTopic`, `mqttClientId`, `mqttUsername`, `mqttPassword` (encrypted with `lib/secret-box`, context `brokers.mqttPassword`; never returned, `hasMqttPassword` instead) and `mappingRules`, then restart that broker's MQTT subscriber without an API restart. Azure IoT Hub / Event Hub brokers are stored but not connected; responses carry a `connectionNote` saying so
- `GET /api/brokers/:id/history` — broker connection event history (newest-first, limit up to 500)
- `GET/POST /api/api-clients` — list/create API clients. PUT, rotate-secret, regenerate-ingest-url, restore and DELETE on a key (and the Integration Hub access, rotate and end-grace routes) answer 404 when the key has a scope the caller could not grant (`lib/api-client-ceiling.ts`; empty scopes count as `*`). Revoke is not limited
- `GET /api/dashboard/summary` — stat cards
- `GET /api/dashboard/recent-telemetry` — latest records
- `GET /api/dashboard/alarm-stats` — alarm counts by severity
- `GET /api/dashboard/attention` — attention queue; alarm items and counts only with the Alarms module, expiring API keys only with the API Clients module
- `GET /api/viz-dashboards` — list visualization dashboards (persisted in PostgreSQL)
- `POST /api/viz-dashboards` — create dashboard
- `PUT /api/viz-dashboards/:id` — update dashboard (name, roleAccess, widgets)
- `DELETE /api/viz-dashboards/:id` — delete dashboard
- `GET /api/plant-twins` — 3D plant twins the caller may see (no scenes); `POST` creates one (Live Twin write; caller becomes owner)
- `GET/PUT/DELETE /api/plant-twins/:id` — one twin with its scene; change needs Live Twin write, delete Live Twin delete, AND owner or Super Admin / Company Admin (checked in the route). `PUT` takes optional `expectedUpdatedAt` (row locked `FOR UPDATE`; stale → 409 `plant_twin_conflict`; absent → accepted and logged); renames and moves keep `updatedAt`. `projectId: null` (every project) only for users not limited to some projects (`plant_twin_all_projects_denied`)
- Access Control modules `live_twin` (granular: Live Twin page and `/plant-twins*`) and `ai_advisor` (simple: AI Advisor page, `/ai/chat` and its data tools; alarm tools also need Alarms). Split from Visualization and Data Explorer in November 2026: role defaults copy those modules, and an existing override of the old module applies until the new one is set (`LEGACY_SOURCE` in `lib/rbac.ts`)
- Access Control module `data_management` (simple): Data Management page and every `/system/*` route except `/system/aggregate` (storage, retention, data health, settings, alerts, backups, database health, legal holds, archives, change approvals) and the `system_alerts` WebSocket channel. Split from Reports in November 2026 the same way (`LEGACY_SOURCE`: `data_management` ← `reports`). `/system/aggregate` stays on Reports because reports, dashboard widgets and Data Explorer read it
- `POST /api/ai/chat` — AI Advisor question (AI Advisor module). Body `{question, range: {from, to}, timeZone?, history?, scopeAssetId?}`. `scopeAssetId` is the project or asset picked next to the time range (null or omitted = all assets): the server resolves it to that asset and everything beneath it (`lib/ai-scope.ts`), and every tool keeps to it. Tools taking an asset id (`list_metrics`, `get_latest_telemetry`, `query_telemetry`, `aggregate_telemetry`, `asset_health`) refuse other assets (`runScopedTool`); `resolve_asset`, `list_assets`, `compare_metrics`, `get_alarms`, `get_alarm_history` and `fleet_summary` filter their results (the summary then leaves out the installation-wide user and broker counts). Errors: 400 `invalid_scope`, 404 `scope_not_found`, 403 `project_forbidden`. The scope name is added to the question and to the `ai.question` audit entry
- `POST /api/ai/report` — AI Reports (AI Advisor module). Body `{assetId?, range: {from, to}, timeZone?}`, at most 92 days (`focus` from older links is ignored). The report level comes from the caller's role (`REPORT_LEVEL_BY_ROLE`: executive for super_admin, company_admin, project_manager; engineer for engineer, developer, operator; manager otherwise). The server computes every figure from the database within the caller's projects (alarm figures only with the Alarms module): KPIs and previous-period KPIs, plant health score, KPI cards, asset status, metric statistics and trends, correlations, signals before alarms, repeat alarms, alarm timing, maintenance time and data quality. The report is built from the database only (never from Visualization data). The figures the level needs go to the AI provider (`lib/llm.ts`, Groq today), which then investigates the database with the read-only chat tools, limited to the report's assets, period and the caller's modules (at most 8 tool calls, 6 turns, about 38 s; `lib/ai-report-agent.ts`), and writes the level's narrative. If the investigation fails, one call writes the narrative from the figures alone. Returns `{level, facts, narrative, narrativeStatus, narrativeError, unverifiedNumbers, investigation: {mode: investigated|single|none, steps: [{tool, summary}], toolCalls, durationMs}, alarmsIncluded, generatedAt, range, scope, model}`; without a provider (`narrativeStatus: unavailable`) or when the model fails (`failed`, `rate_limited`, `unreadable`), `narrative` is null and the figures are still returned. `unverifiedNumbers` lists numbers found neither in the figures nor in a tool result. AI tools (chat and reports): `resolve_asset`, `list_assets`, `list_metrics`, `get_latest_telemetry`, `query_telemetry`, `aggregate_telemetry`, `compare_metrics` (over more than two days these three read the hourly summaries), `asset_health`, `get_alarms`, `get_alarm_history`, `fleet_summary`, `get_alarm_rules` (Alarms module), `get_asset_attributes` (Assets module), `get_recent_changes` (Audit Log module; URL, key and secret fields hidden). The chat's range is limited to 92 days (400 `invalid_time_range`). Rate limited like `/ai/chat`; logged as `ai.report`. See `docs/features/ai-report.md`
- `POST /api/plant-twins/values` — latest reading for up to 500 asset+metric pairs (read-only; one indexed lookup per pair; pairs outside the caller's projects are dropped); the SPA sends larger twins in batches of 500
- `PUT /api/viz-nodes/:id` refuses a move under the node's own subtree (400 `viz_node_cycle`); plant-twin folder moves do the same under an advisory lock
- The global request guard (`middleware/requestGuard.ts`) allows 40,000 keys on `POST /api/plant-twins` and `PUT /api/plant-twins/:id` (20,000 elsewhere); a body refused only for its size is a 400 logged at info, not a security event
- `scene.kind` values: `plant` (default), `machine` (detailed pump skid), `asset`, `process` (P&ID builder, `version: 2`; older scenes are converted on open; annotations in `notes`, uploaded symbols in `custom` with their image in chunks of at most 90 000 characters), `image` (2D twin; the SVG or picture is stored inside the scene in chunks of at most 90 000 characters), `folder`
- `GET /api/sites` — the projects the caller may open, each with location (`Latitude`/`Longitude`/`Address` static attributes on the project asset), asset and maintenance counts and newest data time (Live Twin or Visualization read). Used by the Map view and the Sites Map widget; alarms come from `/api/alarms`
- Uploads carry an optional `project_id` (multipart field `projectId`, the open project). Project-restricted users list only their own files and their projects' files, and download those plus files with no project (shared; every file uploaded before November 2026). Delete: the uploader or an administrator (`manage_users`), else 403 `not_uploader`
- `POST /api/uploads` also accepts binary glTF (`.glb`, `model/gltf-binary`, recognised from its `glTF` v2 header); the polyglot check covers its header and JSON chunk. Used for customer 3D models in Live Twin
- `GET /api/activity-log` — audit search with total: q, from, to, actor (or actorName), action, category, outcome, targetId, assetId, includeSecurity (merges security_events; needs Manage security, else 403 `manage_security_required`, also on export), limit (≤500), offset
- `GET /api/activity-log/export` — the same filters as CSV (≤50,000 rows); `GET /api/activity-log/summary` — 7-day summary
- `POST /api/activity-log/verify` — walk the hash chain (security + Manage security; GET is refused); `GET /api/activity-log/alerts` (each with `raisedBySelf`), `POST /api/activity-log/alerts/:id/acknowledge` (403 `own_action` for an alert raised by the caller's own action); `GET|PUT /api/activity-log/settings` — audit retention (minimum 365 days) and alert switches. Switching an alert off needs two administrators: the first request is pending (`pendingDisable`, response `waitingForSecondAdmin`) until another administrator makes the same change within 7 days. `AUDIT_ALERTS_SECOND_ADMIN=false` restores single-administrator behaviour
- `POST /api/assets/:id/maintenance` — toggle maintenance mode (body: { enabled, note? })
- `GET /api/system/storage` — storage, growth and disk figures for Data Management. Row total is the planner estimate (`pg_class.reltuples`); oldest/newest use the timestamp index; per-asset and per-day counts come from `telemetry_rollups` (cached 60 s). Also returns disk free space (`STORAGE_DISK_PATH`), summary-job status, the age-based retention periods and the last run
- `GET /api/system/aggregate` — time-bucketed aggregation (bucket: 5m/15m/30m/1h/6h/12h/1d/1w; avg/min/max per interval). Over `limit`, the NEWEST buckets are kept and `truncated: true` is returned; 1d/1w buckets start at midnight / Monday in `PLANT_TIME_ZONE`
- `GET /api/system/retention` — list data retention policies
- `POST /api/system/retention` — create retention policy (name, retentionDays, assetId?, metric?, enabled)
- `PUT /api/system/retention/:id` — update retention policy
- `DELETE /api/system/retention/:id` — delete retention policy
- `POST /api/system/retention/run` — manually trigger pruning across all enabled policies (409 `pruning_in_progress` while a run is going); recorded in `retention_runs` and the activity log
- `POST /api/system/retention/preview` — read-only estimate of what the next run would delete with a draft change (`policy` with optional `id`, or `removeId`; empty body = current policies). Computed from `telemetry_rollups`; needs only Reports read
- `GET /api/system/retention/runs` — pruning history, newest first (last 50); `GET /api/system/retention/runs/:id/report` — one run as CSV
- `POST /api/system/retention`, `PUT /api/system/retention/:id`, `POST /api/system/retention/run` return **202** `{pendingApproval, request}` when approval is on and the change would delete more than the limit
- `GET /api/system/storage/all` — every table, uploads folder, archives, last backup, disk, partitioning status
- `GET /api/system/data-health` — per-asset last reading / 7-day coverage / gaps, busiest metrics, refused ingest requests (24 h)
- `GET /api/system/db-health` (Manage assets) — connections, long queries, cache hit ratio, dead rows per table; `POST /api/system/db-health/vacuum` `{schema, table}` — background VACUUM (ANALYZE), 202
- `GET|PUT /api/system/data-settings` — alert thresholds and webhook (masked), quiet time, pruning window, approval, archiving, summary levels
- `GET /api/system/alerts`, `POST /api/system/alerts/check`, `POST /api/system/alerts/:id/acknowledge`
- `GET /api/system/backups` — backup runs reported by `scripts/ops/nexus-backup.sh`
- `GET|POST /api/system/holds`, `POST /api/system/holds/:id/release` — legal holds
- `GET /api/system/archives`, `GET /api/system/archives/:id/download` (Manage assets), `POST /api/system/archives/:id/restore` (re-inserts the day and places a hold)
- `GET /api/system/changes`, `POST /api/system/changes/range-preview`, `POST /api/system/changes/range-delete` (202 when it needs approval; 409 `hold_conflict`), `POST /api/system/changes/:id/approve` (403 `self_approval` for the requester), `POST /api/system/changes/:id/reject`

### Activity Logging
- `logActivity(action, category, targetId, targetName, detail, req, opts?)` — `opts` adds `changes` (use `diffFields(before, after)` from `lib/audit-core.ts`, which redacts secrets), `outcome` and `assetId` (the project is looked up)
- Every write route records itself; `middleware/audit.ts` adds a generic `api.<method>` entry for any write that did not (ingest, sign-in flows and read-only POSTs excluded). `markAudited()` (lib/audit-context.ts) marks a write deliberately not recorded
- The actor comes from `req.principal` (session) or the API client; the `X-Actor-*` headers are only a fallback for system jobs

### Frontend Pages
- `/` — Dashboard (stat cards + **asset health grid** auto-refreshing every 30s, recent telemetry table, alarm severity bar chart)
- `/assets` — Asset hierarchy tree + attribute CRUD table + **Trends tab** (recharts LineChart, time range 1h/6h/24h/7d, multi-metric overlay, Export CSV)
- `/asset-templates` — Template list with create/delete
- `/alarms` — Alarm list with severity/status filters + acknowledge action
- `/alarm-history` — Historical alarm log
- `/alarm-rules` — Rule config with webhook URL, rate-of-change window, test-webhook button, enable toggle
- `/users` — User management with roles
- `/brokers` — Broker management (MQTT, REST API, Azure IoT, with payload mapping rules) + expandable per-broker connection history timeline
- `/api-clients` — API client credentials with scope management
- `/activity-log` — Audit Log: 7-day summary cards, server-side search and filters, security events toggle, entry detail with before/after, CSV/PDF export, Verify integrity and Settings (security administrators). `VITE_CLASSIC_AUDIT_LOG=true` restores the earlier table. History buttons (`features/auditLog/shared.tsx` `HistoryButton`) on assets, alarm rules, users, brokers, destinations, API clients and dashboards
- `/data-management` — Storage overview (total rows, table size, oldest/newest), per-asset breakdown, retention policy CRUD, manual pruning trigger, storage architecture notes
- `/ai-reports` — AI Reports (AI Advisor menu): one report per request, written for the reader's level from their role (executive, manager, engineer); figures computed by the server, AI narrative editable, PDF and CSV export. See `docs/features/ai-report.md`
- `/reports` — Classic report builder, not in the menu unless the web application is built with `VITE_CLASSIC_REPORTS=true` (still opens at its address with the Reports module). On-demand report generation: Telemetry Summary (aggregated min/avg/max per bucket), Alarm Report (date-range filtered), Asset Status Snapshot; quick range buttons, download as CSV or JSON
- `/visualization` — Industrial dark-theme dashboard with **named dashboards** (CRUD: New/Edit/Clone/Delete + access control per role), **multi-metric overlay** (up to 4 extra series on Line/Area/Bar/StackBar charts), dashboard selector dropdown, role badge, **global time range dropdown** (11 presets), widget type as dropdown (11 types), asset hierarchy tree panel, per-widget fullscreen/refresh, auto-refresh 30s, all data persisted in `ws-dashboards-v1` localStorage key. Role-based dashboard visibility. **Real-time WS updates**: `useWsEvents` hook wires telemetry events → per-asset `wsSignals` map → each WidgetCard auto-refetches on signal change + shows animated `● LIVE` badge.
- `/live` — **Live Telemetry Feed**: real-time WebSocket monitoring page. Left pane: per-asset metric tiles (auto-expand on first data, flash animation on update, stale detection after 30s, trend indicators). Right pane: scrollable event log (200 event buffer, expandable rows showing all metric values). Top bar: WS connection status, events/min, live asset count, total received, metrics tracked, asset filter, clear log button. Status bar with buffer/stale config info.
- Asset Management: "Projects & Assets" panel header with prominent "+ Add New" button (creates root project), "New Root Project" button at bottom, tree supports unlimited nesting. Add dialog explains root vs child context.

### Services
- `artifacts/api-server/src/services/mqtt.ts` — MQTT subscriber service: reads broker configs, subscribes to topics, applies mapping rules, calls processNormalised; broadcasts `broker_status` WS events and inserts `broker_events` rows on connect/error/close

## Key Technical Notes

### Ingest Pipeline (ingest.ts)
1. `normalise(body)` — normalises raw HTTP payload to `NormalisedPayload`
2. `processNormalised(n)` — writes telemetry, updates dynamic attributes, evaluates runtime expressions, evaluates alarm rules (threshold + rate_of_change), fires webhooks
3. Rate-of-change evaluation: fetches previous value from telemetry, computes |Δvalue/Δtime| in units/second
4. Webhook delivery: non-blocking `fetch()` POST with AbortSignal.timeout(5000) on alarm trigger/clear
5. Integration events: alarm raised/cleared also go to the outbox (`integration_events`) for queued destinations and `GET /api/v1/events`. Tables, routes and the delivery worker are described in docs/features/integration-hub.md

### Expression Engine (runtime attributes)
- `expr-eval` Parser used for safe math expressions
- Variables auto-populated from all numeric attributes on the same asset
- Evaluated on every `processNormalised` call
- Applied on `apply-template`: `expression` field passes through

### MQTT Subscriber
- Started non-blocking at server startup in `src/index.ts`
- Reads all brokers with `type = "mqtt"` from DB
- Applies `mappingRules` (field renames on `data` object) before normalising
- Graceful error handling — broker failures don't crash the server

### Asset Health Score
- `GET /api/assets/:id/health` returns: `health` ("ok"|"alarm"|"stale"), `freshnessPct`, `activeAlarms`, `lastSeen`, `keyMetrics`
- "alarm" if activeAlarms > 0; "stale" if freshnessPct < 50; "ok" otherwise
- "fresh" = attribute has telemetry within the last hour

### Codegen
```bash
cd lib/api-spec && pnpm exec orval --config ./orval.config.ts
```
- `lib/api-zod/src/index.ts` must ONLY contain `export * from "./generated/api";`

### Express 5 Patterns
- Use `res.status(200).json(data); return;` pattern in async handlers
- Wildcard routes: `/{*splat}`
- All async route handlers typed as `Promise<void>`

### RBAC (Role-Based Access Control)
- The server is authoritative. `artifacts/api-server/src/lib/rbac.ts` defines nine roles (super_admin, company_admin, admin, project_manager, team_lead, developer, engineer, operator, viewer), the permission verbs, module defaults and role rank. `middleware/authorize.ts` holds the deny-by-default `ROUTE_RULES` table; every denial is written to `security_events`
- Permissions: super_admin, company_admin, admin = all (including `manage_users`, `manage_security`); engineer and developer = view + assets + templates + alarms + ack + brokers + destinations + api_clients (developer only on assigned projects); project_manager, team_lead, operator = view + ack; viewer = view
- Identity comes from the session cookie or API key; `middleware/principal.ts` overwrites `X-Actor-*` headers so clients cannot forge Activity Log identity
- Frontend: `UserContext.tsx` (`can(permission)` against the catalogue the server sends), `RoleGuard` (mode="hide" removes, mode="disable" grays out) and `ReadOnlyBanner` mirror the server rules for usability only

### Authorization and company isolation (no row-level security)
- All authorization happens in the API process: `authorize` (route rules), `lib/project-access.ts` (project scoping) and `lib/viz-access.ts` (visualization ownership and shares). PostgreSQL does not enforce any of it: there are no row-level security (RLS) policies, and the runtime role can read and write every row of every application table
- There is no company or tenant column. Isolation between companies comes from giving each company its own installation and its own database (see [operations/new-company-installation.md](operations/new-company-installation.md)). Never point two companies at one database: nothing in the schema would keep their data apart
- Consequences: anyone with the `DATABASE_URL` credentials, or a SQL injection in the API, reaches all data in that installation. Limit the damage with a least-privilege runtime role (DML only, no schema ownership; see the "Least privilege" block in `.env.example`) and keep direct database access to operators
- If installations are ever shared between companies, add a tenant column and RLS policies before doing so; the application checks alone are not designed as a tenant boundary

### Process-local state (single-process requirement)
The API is designed to run as exactly one Node.js process per installation (one systemd service, no PM2 cluster, no replicas). This state lives only in that process's memory:

| State | Where | Effect of a restart | Effect of running two processes |
|---|---|---|---|
| Rate-limit counters: sign-in, forgot-password, token, OTP, per-account, spray guard, general API, flood guard, AI | `lib/rate-limit-store.ts`, `middleware/rateLimit.ts`, `middleware/apiRateLimit.ts` | All counters start from zero (keys are HMACs under a per-process salt, so nothing carries over) | Each process allows the full limit, so the effective limit doubles |
| API-key request buckets (`INGEST_RATE_LIMIT_RPM`) | `middleware/apiKeyAuth.ts` | Buckets reset | Each key gets double the limit |
| MQTT broker connections | `services/mqtt.ts` (`activeClients`) | Connections reopen at startup; with QoS 1 and a persistent session (`clean: false`) the broker redelivers messages it queued meanwhile | Both connect with the same client id and knock each other off the broker in a reconnect loop |
| Alarm On/Off delay timers (`onDelay` / `offDelay`) | `routes/ingest.ts` (`pendingOn`, `pendingOff`) | A running delay restarts, so an alarm can fire (or clear) up to one delay period late | Each process times delays from the messages it sees |
| Enabled alarm-rule cache (5 s) | `routes/ingest.ts` | Rebuilt on first message | A rule change invalidates only one process's cache; the other is stale for up to 5 s |
| Seen-devices cache (backed by the `seen_devices` table) | `lib/seen-devices.ts` | Reloaded from the table at startup | Each process's cache holds only the devices it received since start, so the device list differs between processes |
| WebSocket clients for live updates | `lib/ws-broadcast.ts` | Browsers reconnect automatically | `broadcast()` reaches only the browsers connected to the same process |
| Security-event coalescing (`SECURITY_EVENT_COALESCE_MS`) | `lib/security-log.ts` | Pending counts are flushed every 15 s; at most the last few seconds of counts are lost | Bursts are counted per process |
| Hourly retention and pruning job | `src/index.ts` | Next run one hour after start | The job runs in both processes |

Everything else (sessions, account-wide lockouts, users, alarms, telemetry, audit and security logs) is in PostgreSQL and survives a restart. The per-network sign-in locks (`lib/login-lockout.ts`) are in memory and per process; a restart clears them. To scale out beyond one process, move the counters, delay timers and MQTT ownership to PostgreSQL (or a shared store) first and give the retention job a single owner.

### DB Schema Notes
- `alarm_rules`: added `webhook_url TEXT`, `webhook_enabled BOOLEAN DEFAULT false`, `roc_window INTEGER DEFAULT 60`
- `brokers`: added `mapping_rules JSONB DEFAULT '[]'`, `mqtt_username`, `mqtt_password`, `mqtt_topic`, `mqtt_client_id`
- `alarms`: indexes on `status`, `(asset_id, status)`, `triggered_at`; `alarm_history`: `acknowledged_at` column, indexes on `alarm_id`, `triggered_at`; `attributes`: index on `asset_id`; `broker_events`: `(broker_id, timestamp)`, `timestamp`; `activity_logs`: `timestamp`. No foreign keys were added to telemetry/attributes/alarms/alarm_history (existing orphan rows would fail `db push`); asset deletion removes dependants in one transaction instead
- `telemetry`: three composite indexes: `idx_telemetry_asset_metric_ts (asset_id, metric, timestamp)`, `idx_telemetry_ts (timestamp)`, `idx_telemetry_asset_ts (asset_id, timestamp)`
- `data_retention_policies`: id, name, assetId (null=all), metric (null=all), retentionDays, enabled, lastPrunedAt, rowsPruned
- `telemetry_rollups`: (asset_id, metric, bucket) primary key, bucket = start of the UTC hour; `rows` (all readings), `n`/`sum`/`min`/`max` (numeric readings only). Index on bucket. Deleted with the asset
- `job_state`: key/value for background jobs; `telemetry_rollups` holds the summary watermark
- `retention_runs`: one row per hourly or manual run: trigger, user, started/finished, telemetryDeleted, per-policy details, deletions per other table, error
- `telemetry_rollups_15m`: as `telemetry_rollups` with 15-minute buckets (watermark in `job_state` key `telemetry_rollups_15m`)
- `backup_runs` (written by the backup script), `system_alerts` (one open row per condition key), `data_holds` (legal holds), `data_archives` (one row per archived UTC day, path + SHA-256), `data_change_requests` (bad-data removals and approvals), `ingest_rejections` (refused ingest per hour/source/route/status/code)
- `job_state` keys: `telemetry_rollups`, `telemetry_rollups_15m`, `telemetry_archive` (`archivedUntil`), `data_settings`, `telemetry_partitioning` (conversion state)
- Optional: `telemetry` partitioned by month (`lib/db/src/partition-telemetry.ts`), partitions in schema `telemetry_parts`; `drizzle.config.ts` then leaves `telemetry.ts` out of push

### Data Retention / Pruning
- Hourly background job (`setInterval` in `src/index.ts`) calls `runScheduledRetention()` from `routes/system.ts`: `runPruning()`, `runOperationalPruning()`, old summaries and old history, recorded as one `retention_runs` row. Each step has a single-run guard
- Summary job (`services/rollups.ts`, every 10 minutes, first run 15 s after start): walks raw telemetry forward from the oldest reading in 6-hour slices into `telemetry_rollups`, re-summarising the last 6 hours each run for late readings (a recount never lowers a stored count). `TELEMETRY_ROLLUPS=false` turns it off
- Pruning never deletes raw readings newer than `watermark - 6 h` of any active summary level, readings under a legal hold, or (with archiving on) days not yet archived; it skips telemetry outside the pruning window; when telemetry is partitioned and an all-assets policy exists, whole expired months are dropped first
- `/system/aggregate` with buckets of 15 min or longer fills quarter hours without raw readings from `telemetry_rollups_15m`, and hours with neither from `telemetry_rollups` (buckets of 1 h or longer), so long-term charts survive raw retention and gaps
- Telemetry: the MOST SPECIFIC enabled policy covering a row decides its retention — asset+metric over asset, asset over metric, metric over global. Two enabled policies with the same scope merge and the longer retention wins. (Previously every policy deleted independently, so a short global policy deleted data a longer asset policy should keep.)
- Deletes run in batches of 5,000 rows by primary key, at most 200 batches per policy/table per run; the next hourly run continues
- Operational tables are pruned by age, configurable by env (0 disables): cleared alarms `RETENTION_CLEARED_ALARMS_DAYS` (365), alarm history `RETENTION_ALARM_HISTORY_DAYS` (730), activity logs `RETENTION_ACTIVITY_LOG_DAYS` (365), broker events `RETENTION_BROKER_EVENTS_DAYS` (90), expired/redeemed/revoked auth tokens `RETENTION_AUTH_TOKENS_DAYS` (30), hourly summaries `RETENTION_ROLLUP_DAYS` (1825), pruning history `RETENTION_RUNS_DAYS` (90). Open alarms and the history of open alarms are never deleted
- `rowsPruned` counter accumulates across all runs

### Ingest, alarms and destinations
- Blank readings (`""`, whitespace, `null`) are stored with quality `bad` and are never evaluated as 0 by threshold or rate-of-change rules or runtime expressions; a rate of change also needs a numeric previous reading
- Enabled alarm rules are cached for 5 s; `invalidateAlarmRuleCache()` (exported from `routes/ingest.ts`, also called by `forgetRuleDelays`) drops the cache after a rule change
- Per message: one query for previous readings, one for the asset's attributes, one UPDATE for all matched attributes, one for runtime attributes, one open-alarm lookup when a rule applies
- Alarm triggered/cleared events are sent to enabled destinations subscribed to `alarm` (`forwardToDestinations`, fire-and-forget; body `{ event: "alarm", alarmEvent: "triggered"|"cleared", alarmId, ruleName, metric, value, threshold, operator, severity, assetId, assetName, timestamp }`). Destinations have no project column, so they receive alarms from every project. `telemetry` events are not forwarded
- Destination `authType`: `bearer` | `api_key` | `basic` | `none`; legacy `apikey` is accepted and stored as `api_key`
- MQTT subscribers: QoS 1, persistent session (`clean: false`) with a stable client id, at most `MQTT_MAX_INFLIGHT` (4) messages processed per broker at once; `totalRequests` counts messages
- Asset delete runs in one transaction: telemetry, attributes and alarms of the subtree are deleted, alarm rules bound to those assets are deleted, open history rows are closed (history is kept). `viz_nodes.project_id` is `ON DELETE SET NULL`, so a deleted project's dashboards become unassigned and show in every project
- Dashboard day/hour grouping uses `PLANT_TIME_ZONE` (default UTC); `criticalAlarms` counts open alarms only; `currentPerMinute` is 0 when the newest minute is stale

### Seeded Sample Data (fixed UUIDs)
`pnpm --filter @workspace/db run seed` (`lib/db/src/seed.ts`) is idempotent and for local development only; do not run it on a production server.
- Demo Plant = `00000010-0000-0000-0000-000000000001` (identifier `demo-plant-001`, a root asset, so a project) → Demo Pump = `00000011-0000-0000-0000-000000000001` (identifier `demo-pump-001`)
- 2 alarm rules on Demo Pump: High Temperature (`temperature > 80`, high) and High Vibration (`vibration > 5`, medium)
- 3 users in `invited` status with no password: admin (admin), jsmith (engineer), mwilson (operator). The seed prints a single-use activation link for each (`<AUTH_PUBLIC_URL>/activate?token=…`, valid `AUTH_ACTIVATION_TTL_HOURS`); re-running it revokes the old links and prints new ones
- 1 API client `local-dev-client` (`00000030-0000-0000-0000-000000000001`) with a random secret printed once, plus a sample `curl` ingest command. Only the SHA-256 is stored; if the client already exists the secret is not shown again (rotate it in the UI)
- No brokers are seeded

## Processes
Two long-running processes, started separately (there is no watch on the API — re-run
it after server-side edits):

| Process | Command | Port |
|---|---|---|
| API server | `pnpm dev:api` (`pnpm --filter @workspace/api-server run dev`) | 8080 |
| Web frontend | `pnpm dev:web` (`pnpm --filter @workspace/iot-platform run dev`) | 5173 |

The Vite dev server proxies `/api` (including the `/api/ws` WebSocket) to port 8080,
so both appear on one origin. In production a reverse proxy does that job and serves
the built SPA from `artifacts/iot-platform/dist/public` — see
[operations/vm-deployment-checklist.md](operations/vm-deployment-checklist.md).

### Payload Simulator (IngestSimulator.tsx)
- **Mode switcher**: "Device Presets" tab (existing hardcoded Sensorgrow/RF-Dryer payloads) and **"Custom Asset" tab** (new).
- **Custom Asset Sender**: pick any asset from dropdown → auto-discovers dynamic/measurement attributes via `GET /api/assets/:id/attributes` → populates metric rows with min/max ranges → sliders to adjust values → send once or auto-send with randomized jitter → live trend chart + request log. Payloads sent as `{ deviceId: asset.identifier, timestamp, metrics }`.

## Planned Features
- Device management (device registry, firmware OTA)
- Reporting module (scheduled PDF reports)
- Broker mapping rule UI editor
- Alarm escalation chains
