# Data Flow

**Confidence: High** — based on ingest pipeline, MQTT service, and WebSocket broadcast code.

---

## End-to-End Data Movement

```mermaid
flowchart LR
    subgraph Sources
        MQTT_D[MQTT Device]
        REST_D[REST Device]
        BATCH_D[Batch Client]
    end

    subgraph "API Server — Ingest"
        NORM[Payload Normaliser]
        ASSET_R[Asset Resolver]
        TEL_W[Telemetry Writer]
        ATTR_U[Attribute Updater]
        EXPR_E[Expression Engine]
        ALARM_E[Alarm Evaluator]
    end

    subgraph "PostgreSQL"
        TEL_T[(telemetry)]
        ATTR_T[(attributes)]
        ALARM_T[(alarms)]
        HIST_T[(alarm_history)]
    end

    subgraph "Outputs"
        WS_B[WebSocket Broadcast]
        WH[Webhook Delivery]
        CSV[CSV Export]
        RPT[Report Generation]
    end

    MQTT_D -->|MQTT PUBLISH| NORM
    REST_D -->|HTTP POST| NORM
    BATCH_D -->|HTTP POST array| NORM

    NORM --> ASSET_R
    ASSET_R --> TEL_W
    TEL_W --> TEL_T
    TEL_W --> ATTR_U
    ATTR_U --> ATTR_T
    ATTR_U --> EXPR_E
    EXPR_E --> ATTR_T
    TEL_W --> ALARM_E
    ALARM_E --> ALARM_T
    ALARM_E --> HIST_T
    ALARM_E --> WH

    TEL_W --> WS_B
    ALARM_E --> WS_B

    TEL_T --> CSV
    TEL_T --> RPT
    ALARM_T --> RPT
    ATTR_T --> RPT
```

---

## Ingest Payload Formats

### Format 1: Nested-Data (`payloadFormat: "nested-data"`)
```json
{
  "deviceId": "energy-meter-01",
  "timestamp": "2025-01-14T10:00:00Z",
  "sensor": { "serial": "SN-123" },
  "data": {
    "grid.consumed_kWh": 15.4,
    "solar.generated_kWh": 9.2
  }
}
```

### Format 2: Nested-Metrics (`payloadFormat: "nested-metrics"`)
```json
{
  "deviceId": "fan-controller-01",
  "timestampUnix": 1736845200,
  "metrics": {
    "vibration": 3.2,
    "temperature": 72.1
  }
}
```

### Format 3: Flat (`payloadFormat: "flat"`)
```json
{
  "deviceId": "sensor-001",
  "temperature": 25.3,
  "humidity": 62.1,
  "timestamp": "2025-01-14T10:00:00Z"
}
```

### Format 4: Nested-Root (`payloadFormat: "nested-root"`)
```json
{
  "deviceId": "gateway-01",
  "chiller": { "energy_kWh": 15.2, "load_percent": 82 },
  "lighting": { "power_factor": 0.95 }
}
```
Results in metrics: `chiller.energy_kWh`, `chiller.load_percent`, `lighting.power_factor`.

---

## Attribute Update Flow

When a telemetry record is written, the ingest pipeline updates attributes in two ways:

1. **tagName match** — `UPDATE attributes SET value=? WHERE assetId=? AND tagName = 'deviceId.metric'`
2. **sourceMetric match** — `UPDATE attributes SET value=? WHERE assetId=? AND sourceMetric = 'metric'`

This allows attributes to be bound to specific device metrics regardless of device identifier.

---

## WebSocket Event Types

| Type | Payload | Trigger |
|------|---------|---------|
| `connected` | `{}` | On WebSocket connection established |
| `telemetry` | `{assetId, assetName, metrics, timestamp}` | After every successful ingest |
| `alarm` | `{event, alarmId, ruleName, metric, value, severity, assetId, assetName, timestamp}` | On alarm trigger or clear |
| `broker_status` | `{brokerId, brokerName, status, message}` | On MQTT connect / disconnect / error |

---

## Report Data Flow

```mermaid
flowchart TD
    USER[User requests report] --> API[GET /api/reports/...]
    API --> Q1{Report type?}
    Q1 -- Telemetry Summary --> TS[Query telemetry\nGROUP BY bucket\nAVG/MIN/MAX]
    Q1 -- Alarm Report --> AR[Query alarm_history\nfiltered by date range]
    Q1 -- Asset Status Snapshot --> AS[Query assets + attributes\ncurrent values]
    TS & AR & AS --> FORMAT{Format?}
    FORMAT -- CSV --> CSV[text/csv response]
    FORMAT -- JSON --> JSON[application/json response]
    CSV & JSON --> USER
```
