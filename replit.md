# IoT Data Acquisition Platform

A full-stack industrial IoT platform inspired by Yokogawa AHI / Siemens MindSphere.

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
- `assets` — hierarchical asset tree (self-referencing parentId)
- `attributes` — asset attributes (static/dynamic/metric/runtime) with tagName, UoM, quality, timestamp, expression
- `asset_templates` — reusable attribute blueprints with expression support
- `telemetry` — time-series sensor readings (assetId, deviceId, metric, value, quality, timestamp)
- `alarms` — active alarm instances with severity/status/class
- `alarm_history` — historical alarm records
- `alarm_rules` — threshold/deviation/rate_of_change/heartbeat rule definitions + webhookUrl, webhookEnabled, rocWindow
- `users` — platform users with roles (admin/engineer/operator/viewer)
- `brokers` — MQTT/REST/Azure IoT broker configurations + mqttUsername, mqttPassword, mqttTopic, mqttClientId, mappingRules (JSONB)
- `api_clients` — OAuth client credentials with scopes

### API Routes (all under /api)
- `GET/POST /api/assets` — list/create assets
- `GET/PUT/DELETE /api/assets/:id` — get/update/delete asset
- `GET/POST /api/assets/:id/attributes` — list/add asset attributes
- `POST /api/assets/:id/attributes/bulk` — bulk import attributes (CSV/JSON)
- `POST /api/assets/:id/apply-template` — apply template (stamps attributes with expression support)
- `GET/PUT/DELETE /api/attributes/:id` — manage individual attributes
- `GET/POST /api/asset-templates` — list/create templates
- `POST /api/ingest/payload` — single payload ingest (normalise + write telemetry + evaluate runtime attrs + fire alarm rules + deliver webhooks)
- `POST /api/ingest/batch` — batch ingest array
- `GET /api/telemetry/:assetId` — query telemetry (metric, from, to, limit filters)
- `GET /api/telemetry/:assetId/export` — CSV export of telemetry
- `GET /api/assets/:assetId/health` — asset health score (freshness%, activeAlarms, lastSeen, keyMetrics)
- `GET /api/alarms` — list alarms (filter by severity/status)
- `POST /api/alarms/:id/acknowledge` — acknowledge alarm
- `GET /api/alarm-history` — paginated alarm history
- `GET/POST /api/alarm-rules` — list/create alarm rules (threshold + rate_of_change + webhook fields)
- `PUT/DELETE /api/alarm-rules/:id` — update/delete rule
- `POST /api/alarm-rules/:id/test-webhook` — fire a test webhook POST
- `GET/POST /api/users` — list/create users
- `GET/POST /api/brokers` — list/create brokers
- `GET/POST /api/api-clients` — list/create API clients
- `GET /api/dashboard/summary` — stat cards
- `GET /api/dashboard/recent-telemetry` — latest records
- `GET /api/dashboard/alarm-stats` — alarm counts by severity

### Frontend Pages
- `/` — Dashboard (stat cards + **asset health grid** auto-refreshing every 30s, recent telemetry table, alarm severity bar chart)
- `/assets` — Asset hierarchy tree + attribute CRUD table + **Trends tab** (recharts LineChart, time range 1h/6h/24h/7d, multi-metric overlay, Export CSV)
- `/asset-templates` — Template list with create/delete
- `/alarms` — Alarm list with severity/status filters + acknowledge action
- `/alarm-history` — Historical alarm log
- `/alarm-rules` — Rule config with webhook URL, rate-of-change window, test-webhook button, enable toggle
- `/users` — User management with roles
- `/brokers` — Broker management (MQTT, REST API, Azure IoT, with payload mapping rules)
- `/api-clients` — API client credentials with scope management

### Services
- `artifacts/api-server/src/services/mqtt.ts` — MQTT subscriber service: reads broker configs, subscribes to topics, applies mapping rules, calls processNormalised

## Key Technical Notes

### Ingest Pipeline (ingest.ts)
1. `normalise(body)` — normalises raw HTTP payload to `NormalisedPayload`
2. `processNormalised(n)` — writes telemetry, updates dynamic attributes, evaluates runtime expressions, evaluates alarm rules (threshold + rate_of_change), fires webhooks
3. Rate-of-change evaluation: fetches previous value from telemetry, computes |Δvalue/Δtime| in units/second
4. Webhook delivery: non-blocking `fetch()` POST with AbortSignal.timeout(5000) on alarm trigger/clear

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

### DB Schema Notes
- `alarm_rules`: added `webhook_url TEXT`, `webhook_enabled BOOLEAN DEFAULT false`, `roc_window INTEGER DEFAULT 60`
- `brokers`: added `mapping_rules JSONB DEFAULT '[]'`, `mqtt_username`, `mqtt_password`, `mqtt_topic`, `mqtt_client_id`

### Seeded Sample Data (fixed UUIDs)
- Fan = `bbbb0002-0000-0000-0000-000000000001`, Plant 1 = `bbbb0001-0000-0000-0000-000000000001`
- 6 alarm rules for Fan (vibration, temperature, battery)
- 3 users: admin, jsmith (engineer), mwilson (operator)
- 1 MQTT broker (connected)
- 2 API clients: Daimler_Truck, NodeRED_Client

## Workflows
- `artifacts/api-server: API Server` — runs `pnpm --filter @workspace/api-server run dev`
- `artifacts/iot-platform: web` — runs `pnpm --filter @workspace/iot-platform run dev`

## Phase 3 Planned Features
- Device management (device registry, firmware OTA)
- Reporting module (scheduled PDF reports)
- Real-time WebSocket telemetry push
- Broker mapping rule UI editor
- Alarm escalation chains
