# Requirements Traceability Matrix

**Confidence: High** — requirements derived from implemented features; test references are aspirational (no tests exist yet).

---

## Format
Each row maps: **Requirement → Component → API Endpoint → Test → Deployment Artifact**

---

## Functional Requirements

| ID | Requirement | Component | API Endpoint(s) | Test ID | Artifact |
|----|------------|-----------|----------------|---------|---------|
| FR-01 | Hierarchical asset management | `Assets.tsx`, `routes/assets.ts` | GET/POST/PUT/DELETE `/api/assets` | IT-01 | api-server, iot-platform |
| FR-02 | Asset attribute CRUD | `Assets.tsx`, `routes/assets.ts`, `routes/attributes.ts` | GET/POST `/api/assets/:id/attributes` | IT-02 | api-server, iot-platform |
| FR-03 | Asset templates with expressions | `AssetTemplates.tsx`, `routes/asset_templates.ts` | GET/POST `/api/asset-templates`, POST `/api/assets/:id/apply-template` | IT-03 | api-server, iot-platform |
| FR-04 | Telemetry ingest via HTTP | `routes/ingest.ts` — `normalise()`, `processNormalised()` | POST `/api/ingest/payload`, `/api/ingest/batch` | UT-01, IT-04 | api-server |
| FR-05 | Telemetry ingest via MQTT | `services/mqtt.ts` | — (event-driven) | UT-05 | api-server |
| FR-06 | Multi-format payload normalisation | `routes/ingest.ts` — `normalise()` | POST `/api/ingest/validate` | UT-01 | api-server |
| FR-07 | Threshold alarm rules | `routes/ingest.ts` — `evaluateAlarmRules()` | GET/POST `/api/alarm-rules` | UT-02, IT-05 | api-server |
| FR-08 | Rate-of-change alarm rules | `routes/ingest.ts` — `evaluateAlarmRules()` | GET/POST `/api/alarm-rules` | UT-03 | api-server |
| FR-09 | Alarm webhook delivery | `routes/ingest.ts` — `fireWebhook()` | POST `/api/alarm-rules/:id/test-webhook` | UT-04 | api-server |
| FR-10 | Alarm acknowledgement | `Alarms.tsx`, `routes/alarms.ts` | POST `/api/alarms/:id/acknowledge` | E2E-04, IT-06 | api-server, iot-platform |
| FR-11 | Real-time WebSocket events | `lib/ws-broadcast.ts`, `hooks/useWsEvents.ts` | WS `/api/ws` | E2E-03 | api-server, iot-platform |
| FR-12 | Visualization dashboards | `Visualization.tsx`, `routes/viz_dashboards.ts` | GET/POST/PUT/DELETE `/api/viz-dashboards` | E2E-05 | api-server, iot-platform |
| FR-13 | Role-based access control | `UserContext.tsx`, `RoleGuard.tsx` | — (UI-layer) | E2E-06 | iot-platform |
| FR-14 | API client credentials | `ApiClients.tsx`, `routes/api_clients.ts`, `middleware/apiKeyAuth.ts` | GET/POST `/api/api-clients` | IT-07 | api-server, iot-platform |
| FR-15 | Data retention policies | `DataManagement.tsx`, `routes/system.ts` | GET/POST/PUT/DELETE `/api/system/retention`, POST `/api/system/retention/run` | IT-08 | api-server, iot-platform |
| FR-16 | Activity audit log | `ActivityLog.tsx`, `routes/activity_log.ts` | GET `/api/activity-log` | IT-09 | api-server, iot-platform |
| FR-17 | Asset health score | `routes/ingest.ts` | GET `/api/assets/:id/health` | UT-06, IT-10 | api-server |
| FR-18 | Runtime attribute expressions | `routes/ingest.ts` — `evaluateRuntimeAttributes()` | — (triggered by ingest) | UT-07 | api-server |
| FR-19 | Maintenance mode | `routes/assets.ts`, `routes/ingest.ts` | POST `/api/assets/:id/maintenance` | IT-11 | api-server, iot-platform |
| FR-20 | Report generation (CSV/JSON) | `Reports.tsx`, `routes/export.ts` | GET `/api/reports/*` | E2E-07 | api-server, iot-platform |
| FR-21 | Broker connection history | `BrokerHistoryTimeline.tsx`, `routes/broker_history.ts` | GET `/api/brokers/:id/history` | IT-12 | api-server, iot-platform |
| FR-22 | Payload mapping rules | `services/mqtt.ts` | — (broker config) | UT-08 | api-server |
| FR-23 | Live telemetry feed page | `LiveFeed.tsx`, `hooks/useWsEvents.ts` | WS `/api/ws` | E2E-03 | iot-platform |
| FR-24 | SPC control lines on charts | `Visualization.tsx` | GET/PUT `/api/viz-dashboards/:id` | E2E-05 | iot-platform |
| FR-25 | CSV telemetry export | `Assets.tsx` (Trends tab), `routes/ingest.ts` | GET `/api/telemetry/:assetId/export` | IT-13 | api-server, iot-platform |

---

## Non-Functional Requirements

| ID | Requirement | Implementation | Measured? |
|----|------------|---------------|-----------|
| NFR-01 | Alarm latency < 2s from ingest | Synchronous alarm evaluation + in-process WS broadcast | No |
| NFR-02 | Telemetry query < 100ms (1k rows) | Composite index `idx_telemetry_asset_metric_ts` | No |
| NFR-03 | API rate limit 120 RPM per client | `apiKeyAuth.ts` — `isRateLimited()` | Unit tested (aspirational) |
| NFR-04 | Structured JSON logs | pino + pino-http | Observable in workflow console |
| NFR-05 | Audit trail for all writes | `logActivity()` in affected route handlers | Manual verification |
| NFR-06 | WebSocket reconnect on disconnect | `useWsEvents.ts` reconnect logic | Manual verification |

---

## Deployment Traceability

| Component | Artifact | Workflow |
|-----------|---------|---------|
| Express API Server | `artifacts/api-server` | `artifacts/api-server: API Server` |
| IoT Platform SPA | `artifacts/iot-platform` | `artifacts/iot-platform: web` |
| PostgreSQL schema | `lib/db` | `pnpm --filter @workspace/db run migrate` |
| Generated API hooks | `lib/api-client-react` | `pnpm --filter @workspace/api-spec run codegen` |
| Generated Zod schemas | `lib/api-zod` | `pnpm --filter @workspace/api-spec run codegen` |
