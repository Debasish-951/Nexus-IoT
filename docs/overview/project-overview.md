# Project Overview

**Confidence: High** — derived directly from implemented source code and running system.

---

## Purpose

WS-Integrated Suite is an industrial IoT data acquisition and analytics platform that provides real-time visibility into physical assets, automated alarm management, and operational reporting for industrial environments such as manufacturing plants, energy facilities, and process industries.

---

## Business Goals

1. **Reduce unplanned downtime** by detecting anomalies (threshold breaches, rate-of-change spikes) before they become failures.
2. **Centralise asset intelligence** across heterogeneous device ecosystems via a normalised telemetry ingest pipeline.
3. **Accelerate operator response** through real-time alarm escalation and WebSocket-pushed live feeds.
4. **Enable data-driven maintenance** with historical telemetry, trend analysis, and exportable reports.
5. **Enforce operational governance** via role-based access control and a complete audit trail.

---

## Scope

### In Scope
- Asset hierarchy management (unlimited depth)
- Multi-protocol telemetry ingest (REST HTTP, MQTT, Azure IoT, batch)
- Real-time WebSocket event delivery
- Alarm rule engine (threshold + rate-of-change)
- Webhook alarm notifications to external systems
- Visualization dashboards with 11 widget types and SPC control lines
- Role-based access control (admin / engineer / operator / viewer)
- Data retention policy management
- On-demand CSV/JSON report generation
- Audit activity logging
- API client credential management with scopes and rate limiting
- Integration guide / Node-RED documentation

### Out of Scope (planned)
- Device firmware OTA management
- Scheduled PDF report delivery
- Alarm escalation chains
- Visual broker mapping rule editor

---

## Personas

| Persona | Role | Primary Tasks |
|---------|------|--------------|
| **Plant Administrator** | admin | Full system configuration, user management, security |
| **Controls Engineer** | engineer | Asset/template setup, broker config, alarm rule authoring |
| **Shift Operator** | operator | Monitor live feeds, acknowledge alarms |
| **Plant Manager / Auditor** | viewer | Review dashboards, reports, audit trails (read-only) |

---

## Functional Overview

| Domain | Capability |
|--------|-----------|
| **Assets** | Hierarchical tree, attribute types (static/dynamic/metric/runtime), templates with expressions |
| **Telemetry** | Multi-format ingest, 4 payload normalisation strategies, time-series storage, CSV export |
| **Alarms** | Threshold + rate-of-change rules, deadband hysteresis, webhook delivery, acknowledge workflow |
| **Visualization** | 11 chart types, SPC lines, multi-series overlay, per-role dashboard access, real-time WebSocket updates |
| **Brokers** | MQTT / REST API / Azure IoT, payload mapping rules, connection event history |
| **Security** | API client OAuth credentials, scopes, IP allowlist, 120 RPM rate limiting |
| **Operations** | Data retention policies, hourly background pruning, storage analytics |
| **Audit** | Immutable activity log with actor name/role/username for all write operations |

---

## Assumptions

- Platform runs on a single-node Replit environment; horizontal scaling is not yet implemented.
- Authentication is UI-layer RBAC only — the API itself does not enforce role checks; enforcement relies on API client scopes for machine access and frontend guards for human access.
- MQTT broker connectivity requires network reachability from the API server container to the broker host.
- Payload deviceId must match an asset's `identifier` field exactly (case-sensitive) for telemetry to be attributed.

---

## Constraints

- PostgreSQL is the only supported database backend (Drizzle ORM with pg driver).
- The WebSocket endpoint is at `/api/ws` — clients must connect through the same proxy that serves the REST API.
- API rate limiting is in-memory per process; it resets on server restart and does not persist across restarts.
- `expr-eval` expression engine is sandboxed but does not enforce resource limits on complex expressions.

---

## Success Criteria

| Criterion | Measure |
|-----------|---------|
| Telemetry freshness | Asset health score shows "ok" within 60 s of ingest |
| Alarm latency | Alarm triggered and WebSocket event delivered within 2 s of ingest |
| Dashboard load | Visualization page renders all widgets within 3 s on LAN |
| Audit completeness | 100% of write operations appear in activity log |
| Role enforcement | Viewer role cannot modify any resource via UI |
