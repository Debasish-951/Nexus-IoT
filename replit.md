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
- `attributes` — asset attributes (static/dynamic/metric) with tagName, UoM, quality, timestamp
- `asset_templates` — reusable attribute blueprints
- `telemetry` — time-series sensor readings (assetId, deviceId, metric, value, quality, timestamp)
- `alarms` — active alarm instances with severity/status/class
- `alarm_history` — historical alarm records
- `alarm_rules` — threshold/deviation/heartbeat rule definitions
- `users` — platform users with roles (admin/engineer/operator/viewer)
- `brokers` — MQTT/REST/Azure IoT broker configurations
- `api_clients` — OAuth client credentials with scopes

### API Routes (all under /api)
- `GET/POST /api/assets` — list/create assets
- `GET/PUT/DELETE /api/assets/:id` — get/update/delete asset
- `GET/POST /api/assets/:id/attributes` — list/add asset attributes
- `GET/PUT/DELETE /api/attributes/:id` — manage individual attributes
- `GET/POST /api/asset-templates` — list/create templates
- `POST /api/ingest` — Node-RED payload ingestion (updates attributes + writes telemetry)
- `GET /api/alarms` — list alarms (filter by severity/status)
- `POST /api/alarms/:id/acknowledge` — acknowledge alarm
- `GET /api/alarm-history` — paginated alarm history
- `GET/POST /api/alarm-rules` — list/create alarm rules
- `PUT/DELETE /api/alarm-rules/:id` — update/delete rule (toggle enabled)
- `GET/POST /api/users` — list/create users
- `GET/POST /api/brokers` — list/create brokers
- `GET/POST /api/api-clients` — list/create API clients
- `GET /api/dashboard/summary` — stat cards
- `GET /api/dashboard/recent-telemetry` — latest records
- `GET /api/dashboard/alarm-stats` — alarm counts by severity

### Frontend Pages
- `/` — Dashboard (stat cards, recent telemetry table, alarm severity bar chart)
- `/assets` — Asset hierarchy tree + attribute CRUD table
- `/asset-templates` — Template list with create/delete
- `/alarms` — Alarm list with severity/status filters + acknowledge action
- `/alarm-history` — Historical alarm log
- `/alarm-rules` — Rule configuration with enable toggle
- `/users` — User management with roles
- `/brokers` — Broker management (MQTT, REST API, Azure IoT)
- `/api-clients` — API client credentials with scope management

## Key Technical Notes

### Codegen
```bash
cd lib/api-spec && pnpm exec orval --config ./orval.config.ts
```
- `lib/api-zod/src/index.ts` must ONLY contain `export * from "./generated/api";`
  Adding `./generated/types` causes TS2308 duplicate export errors.

### Express 5 Patterns
- Use `res.status(200).json(data); return;` pattern in async handlers
- Wildcard routes: `/{*splat}`
- All async route handlers typed as `Promise<void>`

### React Query Hooks
- All `useList*`, `useGet*` hooks return `UseQueryResult<TData>` — always destructure `.data`
- Pattern: `const { data: assets } = useListAssets();`

### DB Arrays
- Use `.array()` method: `text("tags").array()`

### Seeded Sample Data (fixed UUIDs)
- 8 assets: Textile Industry > Unit-1 > energy_analytics, Unit-2 > rf_dryer + extrudr; also sensorgrow, Sewage Plant
- 7 attributes on rf_dryer (energy metrics with kWh values)
- 4 alarms: 2 active (critical/high), 1 acknowledged, 1 cleared
- 3 alarm rules
- 3 users: admin, jsmith (engineer), mwilson (operator)
- 3 brokers: MQTT_N (connected), Test_API (connected), Azure_IoT_Hub (disconnected)
- 2 API clients: Daimler_Truck, NodeRED_Client

## Workflows
- `artifacts/api-server: API Server` — runs `pnpm --filter @workspace/api-server run dev`
- `artifacts/iot-platform: web` — runs `pnpm --filter @workspace/iot-platform run dev`

## Phase 2 Planned Features
- Device management (device registry, firmware OTA)
- Reporting module (scheduled reports, trend charts)
- Real-time WebSocket telemetry push
- Node-RED payload simulator
