# WS-Integrated Suite

An enterprise-grade Industrial IoT data acquisition and analytics platform built for real-time monitoring, alarm management, and operational intelligence across industrial asset hierarchies.

---

## Features

- **Asset Management** — unlimited-depth hierarchical asset tree with attribute CRUD, templates, and media library
- **Real-Time Telemetry Ingest** — multi-format payload normalisation (flat, nested-data, nested-metrics, nested-root)
- **Live WebSocket Feed** — sub-second push of telemetry and alarm events to all connected clients
- **MQTT & REST Broker Integration** — managed broker configs with payload mapping rules
- **Alarm Engine** — threshold and rate-of-change rules with webhook delivery and deadband hysteresis
- **Visualization Dashboard** — configurable multi-widget dashboards with SPC control lines, multi-series overlays, and 11 chart types
- **Role-Based Access Control** — four roles (admin / engineer / operator / viewer) with per-page permission enforcement
- **Data Management** — storage analytics, retention policies, and on-demand pruning
- **Reports** — on-demand Telemetry Summary, Alarm, and Asset Status reports (CSV / JSON)
- **Audit Trail** — complete activity log with actor attribution

---

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Set required environment variables
#    DATABASE_URL  — PostgreSQL connection string (provisioned automatically on Replit)
#    SESSION_SECRET — session signing secret
#    PORT          — assigned automatically by Replit per artifact

# 3. Run database migrations
pnpm --filter @workspace/db run migrate

# 4. (Optional) Seed sample data
pnpm --filter @workspace/db run seed

# 5. Start API server
pnpm --filter @workspace/api-server run dev

# 6. Start frontend (separate terminal)
pnpm --filter @workspace/iot-platform run dev
```

---

## Local Setup

### Prerequisites
| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| pnpm | ≥ 9 |
| PostgreSQL | ≥ 15 |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Secret for session signing |
| `PORT` | Yes (auto) | HTTP port — set per artifact by Replit |

### Codegen (after API spec changes)

```bash
pnpm --filter @workspace/api-spec run codegen
```

This regenerates React Query hooks (`lib/api-client-react`) and Zod schemas (`lib/api-zod`) from the OpenAPI 3.1 spec.

---

## Monorepo Structure

```
artifacts/api-server/     — Express 5 REST + WebSocket API  (path: /api)
artifacts/iot-platform/   — React + Vite SPA               (path: /)
lib/api-spec/             — OpenAPI 3.1 spec + Orval config
lib/api-client-react/     — Generated React Query hooks
lib/api-zod/              — Generated Zod schemas
lib/db/                   — Drizzle ORM schema + migrations
scripts/                  — Utility scripts
```

---

## Deployment

The platform is designed for deployment on Replit using the built-in PostgreSQL database and path-based reverse proxy. Each artifact binds to `$PORT` and is routed through the shared proxy at `/api` and `/`.

See [docs/operations/runbook.md](docs/operations/runbook.md) for full deployment, rollback, and recovery procedures.

---

## Configuration

| Area | Location |
|------|----------|
| DB schema | `lib/db/src/schema/` |
| API routes | `artifacts/api-server/src/routes/` |
| RBAC permissions | `artifacts/iot-platform/src/contexts/UserContext.tsx` |
| API client scopes | `Security → API Clients` (UI) |
| Retention policies | `System → Data Management` (UI) |
| Broker mapping rules | `Broker Management` (UI) |

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| API returns 401 | Missing or expired API key | Check `Security → API Clients` |
| No telemetry data | deviceId not matched to asset | Run validate endpoint first |
| MQTT not connecting | Bad credentials or topic | Check broker config in UI |
| Alarms not firing | Asset in maintenance mode | Toggle off maintenance in asset settings |
| Stale dashboard | WebSocket disconnected | Reload page; check `/api/ws` reachability |

---

## Contribution Guide

1. Branch from `main`.
2. Make changes and run `pnpm run typecheck` to verify types.
3. Update relevant docs in `docs/` for any API, schema, or behaviour changes.
4. Submit a pull request with a description referencing any affected ADRs.
5. Update `docs/DOCUMENTATION_STATUS.md` if documentation coverage changes.

Documentation is treated as code — see [docs/governance.md](docs/governance.md).
