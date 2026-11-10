# API Reference

**Confidence: High** — derived from implemented route handlers.  
**Base URL:** `/api`  
**Content-Type:** `application/json` (all requests and responses)

---

## Authentication

The API supports two authentication methods for machine clients:

```
Authorization: Bearer <clientSecret>
# or
X-API-Key: <clientSecret>
```

`clientSecret` is obtained from `Security → API Clients` in the UI.

**Rate limit:** 1200 requests per minute per client by default (`INGEST_RATE_LIMIT_RPM`; in-memory, reset on restart). Over the limit the API returns `429`. A key in the query string (`?key=`) is ignored unless `API_KEY_ALLOW_QUERY_PARAM=true`.

Every endpoint except the public auth routes (login, session check, activation, forgot/reset password, password policy), `/healthz`, `/readyz`, `/export/health` and `/export/schema` requires a signed-in session or an API key. The server enforces a deny-by-default route table (`middleware/authorize.ts`); cookie-authenticated writes also need the `x-csrf-token` header. The OpenAPI spec (`lib/api-spec/openapi.yaml`) describes every route.

---

## Actor Headers (Audit Trail)

For write operations, include these headers to populate the activity log:

```
X-Actor-Name: Plant Administrator
X-Actor-Role: admin
X-Actor-Username: padmin
```

These are set automatically by the frontend `custom-fetch.ts` client based on the active user profile.

---

## Error Responses

All errors return JSON:
```json
{ "error": "Human-readable message" }
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request — missing or invalid parameters |
| 401 | Authentication required or token invalid |
| 403 | Insufficient scope, revoked token, or IP not in allowlist |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

---

## Assets

### `GET /api/assets`
List all assets.

**Response:** `Asset[]`

```json
[
  {
    "id": "uuid",
    "name": "Plant 1",
    "identifier": "plant-001",
    "parentId": null,
    "maintenanceMode": false,
    "maintenanceSince": null,
    "maintenanceNote": null,
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-01T00:00:00Z"
  }
]
```

### `POST /api/assets`
Create a new asset.

**Body:**
```json
{ "name": "Fan Motor A", "identifier": "fan-a", "parentId": "uuid-or-null" }
```

### `GET /api/assets/:id`
Get a single asset by ID.

### `PUT /api/assets/:id`
Update asset fields (name, identifier, parentId, maintenanceMode, maintenanceSince, maintenanceNote).

### `DELETE /api/assets/:id`
Delete an asset. Also deletes all child assets, attributes, and telemetry (cascade).

### `POST /api/assets/:id/maintenance`
Toggle maintenance mode.

**Body:**
```json
{ "enabled": true, "note": "Scheduled bearing replacement" }
```

### `GET /api/assets/:assetId/health`
Get asset health score.

**Response:**
```json
{
  "assetId": "uuid",
  "assetName": "Fan Motor A",
  "health": "ok",
  "freshnessPct": 100,
  "activeAlarms": 0,
  "lastSeen": "2025-01-14T10:00:00Z",
  "totalAttributes": 12,
  "dynamicAttributes": 8,
  "freshAttributes": 8,
  "keyMetrics": [...]
}
```
`health` is `"ok"` | `"alarm"` | `"stale"`.  
`"alarm"` if `activeAlarms > 0`; `"stale"` if `freshnessPct < 50`; `"ok"` otherwise.

---

## Attributes

### `GET /api/assets/:id/attributes`
List all attributes for an asset.

### `POST /api/assets/:id/attributes`
Add an attribute to an asset.

**Body:**
```json
{
  "name": "Grid Energy",
  "type": "dynamic",
  "dataType": "number",
  "tagName": "energy-meter-01.grid.consumed_kWh",
  "uom": "kWh",
  "decimalPlaces": 2,
  "thousandSeparator": true
}
```

### `POST /api/assets/:id/attributes/bulk`
Bulk import attributes from JSON array or CSV.

### `POST /api/assets/:id/apply-template`
Apply a template to an asset, stamping all template attribute definitions as attributes.

**Body:** `{ "templateId": "uuid" }`

### `GET /api/attributes/:id`
Get a single attribute.

### `PUT /api/attributes/:id`
Update an attribute (any field).

### `DELETE /api/attributes/:id`
Delete an attribute.

---

## Asset Templates

### `GET /api/asset-templates`
List all templates.

### `POST /api/asset-templates`
Create a template.

**Body:**
```json
{
  "name": "Motor Template",
  "tags": ["motor", "pump"],
  "attributeDefinitions": [
    { "name": "Vibration", "type": "dynamic", "dataType": "number", "tagName": "vibration", "uom": "mm/s" }
  ]
}
```

---

## Telemetry Ingest

### `POST /api/ingest/payload`
Ingest a single telemetry payload.

**Auth:** `optionalApiKeyAuth("ingest:write")` — validates if token provided.

**Body (example — nested-data format):**
```json
{
  "deviceId": "energy-meter-01",
  "timestamp": "2025-01-14T10:00:00Z",
  "data": {
    "grid.consumed_kWh": 15.4,
    "solar.generated_kWh": 9.2
  }
}
```

**Response:**
```json
{
  "success": true,
  "recordsWritten": 2,
  "assetId": "uuid",
  "assetName": "Energy Meter 01",
  "message": "Ingested 2 metric(s)",
  "alarmsTriggered": 0,
  "alarmsCleared": 0,
  "alarmEvents": []
}
```

### `POST /api/ingest/validate`
Dry-run: resolve deviceId, extract metrics, check asset match. Does **not** write to DB.

**Response:**
```json
{
  "valid": true,
  "deviceId": "energy-meter-01",
  "assetId": "uuid",
  "assetName": "Energy Meter 01",
  "assetMatched": true,
  "payloadFormat": "nested-data",
  "extractedMetrics": { "grid.consumed_kWh": 15.4 },
  "metricCount": 1,
  "warnings": []
}
```

### `POST /api/ingest/batch`
Ingest an array of payloads sequentially.

**Body:** JSON array of payload objects.

**Response:**
```json
{
  "success": true,
  "totalRecords": 10,
  "successCount": 10,
  "failureCount": 0,
  "alarmsTriggered": 1,
  "alarmsCleared": 0
}
```

---

## Telemetry

### `GET /api/telemetry/:assetId`
Query telemetry for an asset.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `metric` | string | Filter by metric key |
| `from` | ISO 8601 | Start timestamp |
| `to` | ISO 8601 | End timestamp |
| `limit` | integer | Max rows (default: 100) |

### `GET /api/telemetry/:assetId/metrics`
List distinct metric keys for an asset.

### `GET /api/telemetry/:assetId/export`
Export telemetry as CSV. Same query params as above. Max 50,000 rows.

**Response:** `text/csv` with `Content-Disposition: attachment`.

---

## Alarms

### `GET /api/alarms`
List active alarms.

**Query params:** `severity`, `status`

### `POST /api/alarms/:id/acknowledge`
Acknowledge an alarm.

### `GET /api/alarm-history`
Paginated alarm history.

**Query params:** `limit`, `offset`

---

## Alarm Rules

### `GET /api/alarm-rules`
List all alarm rules.

### `POST /api/alarm-rules`
Create an alarm rule.

**Body:**
```json
{
  "name": "High Vibration",
  "assetId": "uuid",
  "metric": "vibration",
  "alarmType": "threshold",
  "operator": "gt",
  "threshold": 5.0,
  "deadband": 0.5,
  "severity": "high",
  "enabled": true,
  "webhookUrl": "https://hooks.example.com/alarm",
  "webhookEnabled": true,
  "rocWindow": 60
}
```

### `PUT /api/alarm-rules/:id`
Update an alarm rule.

### `DELETE /api/alarm-rules/:id`
Delete an alarm rule.

### `POST /api/alarm-rules/:id/test-webhook`
Fire a test webhook POST to the rule's configured URL.

---

## Dashboard

### `GET /api/dashboard/summary`
Stat cards: total assets, active alarms, recent telemetry count, active brokers.

### `GET /api/dashboard/recent-telemetry`
Latest telemetry records across all assets.

### `GET /api/dashboard/alarm-stats`
Alarm counts grouped by severity.

---

## Visualization Dashboards

### `GET /api/viz-dashboards`
List all persisted visualization dashboards.

### `POST /api/viz-dashboards`
Create a dashboard.

**Body:** `{ "name": "Energy Overview", "roleFilter": "admin", "assetFilter": "", "widgets": [] }`

### `PUT /api/viz-dashboards/:id`
Update dashboard (name, roleAccess, widgets array).

### `DELETE /api/viz-dashboards/:id`
Delete a dashboard.

---

## Users

### `GET /api/users`
List all users.

### `POST /api/users`
Create a user.

---

## Brokers

### `GET /api/brokers`
List all brokers.

### `POST /api/brokers`
Create a broker.

**Body:**
```json
{
  "name": "Plant MQTT",
  "type": "mqtt",
  "host": "mqtt.plant.local",
  "port": 1883,
  "mqttUsername": "user",
  "mqttPassword": "pass",
  "mqttTopic": "sensors/#",
  "mqttClientId": "ws-suite-001",
  "mappingRules": []
}
```

### `GET /api/brokers/:id/history`
Broker connection event history (newest-first, up to 500 events).

---

## API Clients

### `GET /api/api-clients`
List all API clients.

### `POST /api/api-clients`
Create an API client (auto-generates `clientId` and `clientSecret`).

---

## System

### `GET /api/system/storage`
Storage stats: total rows, table sizes, per-asset telemetry breakdown.

### `GET /api/system/aggregate`
Time-bucketed aggregation.

**Query params:**
| Param | Values | Default |
|-------|--------|---------|
| `bucket` | `5m`, `15m`, `30m`, `1h`, `6h`, `12h`, `1d`, `1w` | `1h` |
| `assetId` | uuid | required |
| `metric` | string | required |

### `GET /api/system/retention`
List data retention policies.

### `POST /api/system/retention`
Create a retention policy.

**Body:**
```json
{
  "name": "Telemetry 90 days",
  "retentionDays": 90,
  "assetId": null,
  "metric": null,
  "enabled": true
}
```

### `PUT /api/system/retention/:id`
Update a retention policy.

### `DELETE /api/system/retention/:id`
Delete a retention policy.

### `POST /api/system/retention/run`
Manually trigger pruning across all enabled policies immediately.

---

## Activity Log

### `GET /api/activity-log`
Paginated audit trail.

**Query params:** `category`, `actorName`, `limit` (default 25), `offset`

---

## WebSocket

### `ws://<host>/api/ws`

Connect to receive real-time events. No authentication required.

**Messages from server:**

```jsonc
// On connect
{ "type": "connected" }

// On telemetry ingest
{ "type": "telemetry", "data": { "assetId": "uuid", "assetName": "Fan", "metrics": { "vibration": 3.2 }, "timestamp": "..." } }

// On alarm trigger or clear
{ "type": "alarm", "data": { "event": "triggered", "alarmId": "uuid", "severity": "high", "assetId": "uuid", ... } }

// On MQTT broker connection change
{ "type": "broker_status", "data": { "brokerId": "uuid", "brokerName": "Plant MQTT", "status": "connected", "message": "..." } }
```
