# Observability

**Confidence: High** — based on implemented logging and audit code.

---

## Logging

### Framework
**pino** (structured JSON logging) + **pino-http** (HTTP request logging)

### Log Levels
| Level | Usage |
|-------|-------|
| `info` | Server start, MQTT connect/disconnect, retention pruning results |
| `warn` | MQTT startup failure, retention pruning errors, broker failures |
| `error` | Server-level errors (uncaught exceptions) |
| `debug` | Not used in current implementation |

### Request Log Fields (pino-http)
```json
{
  "req": { "id": "1", "method": "POST", "url": "/api/ingest/payload" },
  "res": { "statusCode": 200 },
  "responseTime": 45
}
```
Note: Query strings are stripped from logged URLs for privacy.

### Non-Request Logs
```json
{ "level": "info", "port": 8080, "msg": "Server listening" }
{ "level": "info", "msg": "WebSocket server attached at /api/ws" }
{ "level": "info", "totalRowsDeleted": 1250, "msg": "Retention pruning completed" }
{ "level": "warn", "err": {...}, "msg": "MQTT subscriber startup failed" }
```

### Log Access
- Development: the terminal running `pnpm dev:api`
- Production: `journalctl -u <service-name> -f` (systemd)

### Logging Rules
- **Never use `console.log`** in server code — always use `req.log` in route handlers and `logger` singleton elsewhere
- Log enough context to reproduce incidents, but strip PII (query strings already stripped)

---

## Audit Trail

The `activity_logs` table provides business-level audit logging separate from system logs.

### What Is Logged
| Category | Actions |
|----------|---------|
| `alarm` | alarm_acknowledged |
| `asset` | asset_created, asset_deleted |
| `user` | user_created, user_deleted |
| `broker` | broker_created, broker_deleted |
| `api_client` | api_client_created, api_client_deleted |
| `destination` | destination_created, destination_deleted |

### Log Entry Structure
```json
{
  "id": "uuid",
  "action": "alarm_acknowledged",
  "category": "alarm",
  "actorName": "Mike Wilson",
  "actorRole": "operator",
  "actorUsername": "mwilson",
  "targetId": "alarm-uuid",
  "targetName": "High Vibration",
  "detail": "Status changed to acknowledged",
  "timestamp": "2025-01-14T10:00:00Z"
}
```

### Querying the Audit Log
```bash
GET /api/activity-log?category=alarm&limit=25&offset=0
GET /api/activity-log?actorName=Mike Wilson
```

---

## Metrics

### Currently Available (API Endpoints)

| Metric | Endpoint |
|--------|---------|
| Total telemetry rows | `GET /api/system/storage` → `totalRows` |
| Per-asset telemetry count | `GET /api/system/storage` → `perAsset` |
| Active alarm count by severity | `GET /api/dashboard/alarm-stats` |
| API client request count | `GET /api/api-clients` → `totalRequests` |
| Retention rows pruned | `GET /api/system/retention` → `rowsPruned` |

### Gaps (Not Yet Implemented)
- No Prometheus `/metrics` endpoint
- No OpenTelemetry traces
- No system metrics (CPU, memory, heap usage)
- No error rate tracking

### Recommended Future Metrics
```typescript
// Example: add Prometheus metrics endpoint
import promClient from 'prom-client';
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
});
```

---

## Alerting

### Current State
- Alarm events are pushed via WebSocket to connected browsers (toast notifications)
- Webhook delivery to external systems per alarm rule

### Gaps
- No infrastructure-level alerting (server down, high latency, DB connection loss)
- No disk space alerts for growing telemetry table

### Recommended
1. Add a health check endpoint that external monitoring (UptimeRobot, Datadog) can poll
2. Set up service health/restart notifications from the process manager
3. Create an alarm rule on a heartbeat metric to detect device silence

---

## Tracing

Not implemented. For future implementation, consider OpenTelemetry with a Jaeger or Tempo backend. The existing pino request logger provides `req.id` correlation IDs per request.
