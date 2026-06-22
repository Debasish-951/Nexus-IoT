# C4 Container Diagram

**Confidence: High** — reflects implemented artifact structure and communication patterns.

---

## Level 2: Container Diagram

```mermaid
C4Container
    title Container Diagram — Integrated Suite

    Person(user, "Platform User", "Operator / Engineer / Admin")

    Container(spa, "IoT Platform SPA", "React 19 + Vite", "Single-page application providing all UI. Served as static assets via Vite dev server.")
    Container(api, "API Server", "Express 5 / Node.js 20", "REST API + WebSocket server. Handles telemetry ingest, alarm evaluation, and all CRUD operations.")
    Container(mqtt_svc, "MQTT Subscriber", "Node.js / mqtt package", "Reads broker configs, maintains MQTT connections, applies mapping rules, calls ingest pipeline.")
    Container(pruning_job, "Retention Pruner", "Node.js setInterval", "Runs every 60 minutes inside the API server process. Deletes telemetry rows per retention policies.")

    ContainerDb(pg, "PostgreSQL 15", "Relational Database", "Stores all platform data: assets, telemetry, alarms, rules, users, brokers, dashboards, audit logs.")

    System_Ext(mqtt_broker, "MQTT Broker", "External")
    System_Ext(webhook, "Webhook Receiver", "External")
    System_Ext(devices, "REST Field Devices", "External")

    Rel(user, spa, "Uses", "HTTPS")
    Rel(spa, api, "REST API calls", "HTTP /api — JSON")
    Rel(spa, api, "Real-time events", "WebSocket /api/ws")
    Rel(api, pg, "Reads / writes", "TCP / pg driver")
    Rel(mqtt_svc, mqtt_broker, "Subscribes to topics", "MQTT 5 / TCP")
    Rel(mqtt_svc, api, "Calls processNormalised()", "In-process function call")
    Rel(pruning_job, pg, "Deletes expired rows", "SQL DELETE")
    Rel(api, webhook, "Alarm notifications", "HTTP POST")
    Rel(devices, api, "Telemetry push", "HTTP POST /api/ingest/payload")
```

---

## Container Responsibilities

### IoT Platform SPA (`artifacts/iot-platform`)
- Renders all pages: dashboard, assets, alarms, visualization, live feed, reports, settings
- Manages user session in `localStorage` (selected role profile)
- Connects to WebSocket and dispatches telemetry/alarm events to subscribed components
- Generates React Query mutations for all write operations with actor header injection

### API Server (`artifacts/api-server`)
- Mounts all REST routes under `/api`
- Co-hosts WebSocket server on same HTTP server at `/api/ws`
- Runs ingest pipeline: normalise → write → evaluate expressions → evaluate alarms → broadcast
- Starts MQTT subscriber on boot (non-blocking)
- Runs hourly retention pruning in background `setInterval`

### PostgreSQL
- Single-node managed database
- 14 tables covering all platform domains
- Three composite indexes on `telemetry` for time-range and per-asset queries

---

## Network Communication

| From | To | Protocol | Path |
|------|----|---------|------|
| Browser | API | HTTP/1.1 | `/api/*` via reverse proxy |
| Browser | API | WebSocket | `/api/ws` via reverse proxy |
| API | PostgreSQL | TCP | `DATABASE_URL` connection string |
| MQTT Subscriber | MQTT Broker | TCP/MQTT | Configured host:port per broker |
| API | Webhook Receivers | HTTP POST | Configured URL per alarm rule |
| Vite Dev Server | — | — | Serves SPA at path `/` |
