# Integrated Suite — Industrial IoT Platform

An enterprise-grade industrial IoT data acquisition, monitoring, and analytics platform. It collects sensor telemetry from physical devices and MQTT brokers, evaluates alarm rules in real time, and presents operational data through a configurable industrial-grade web UI.

---

## Features

| Area | Highlights |
|------|-----------|
| **Asset management** | Unlimited-depth hierarchy, attribute CRUD, template library, maintenance mode |
| **Telemetry ingest** | HTTP single / batch / validate and MQTT; multi-format payload normalisation |
| **Alarm engine** | Threshold and rate-of-change rules; webhook delivery; acknowledge workflow; full history |
| **Visualisation** | Analytics workspace, tab-per-graph, 20 chart types (11 Recharts + 9 ECharts: heatmap, boxplot, correlation, treemap, sankey, pareto, control, calendar, FFT), real + demo overlays |
| **Live feed** | Live Operations Center — live sensor feed, asset status, health ranking, event timeline; freshness-based live badge |
| **Authentication** | Split-screen login page + logout; client-side session gate (`localStorage`) redirects unauthenticated users to `/login` |
| **Data management** | Storage analytics, configurable retention policies, on-demand pruning |
| **Reports** | Telemetry summary, alarm report, asset snapshot; CSV and JSON export |
| **Brokers** | MQTT / REST / Azure IoT with payload mapping rules and connection history |
| **API clients** | OAuth-style client credentials with scopes, IP allowlist, and usage tracking |
| **Activity log** | Full audit trail with actor identity, category filtering, and pagination |
| **RBAC** | Four roles: admin, engineer, operator, viewer |

---

## Quick start (Replit)

No local setup needed — Replit provisions the database and starts all services automatically.

1. Open the project in Replit.
2. The API server and frontend start via configured workflows.
3. Open the **web** preview pane — the UI is served at `/`.
4. You land on the **login page** (`/login`). Enter any email + password — authentication is mocked (no auth backend), so any input signs you in.
5. Switch roles with the profile switcher in the top bar; **Sign Out** returns you to the login page.

---

## Local development setup

### Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 22 LTS |
| pnpm | 10 |
| PostgreSQL | 15 |

### Steps

```bash
# 1. Clone the repository
git clone <repo-url>
cd integrated-suite

# 2. Install dependencies  (pnpm resolves the correct native binaries for your OS)
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env — fill in DATABASE_URL and SESSION_SECRET
# Special characters in passwords must be percent-encoded  (@→%40, #→%23)

# 4. Create database tables
pnpm --filter @workspace/db run push

# 5. Seed initial data  ← required for the UI to work
pnpm --filter @workspace/db run seed

# 6. Start services in separate terminals
pnpm --filter @workspace/api-server run dev   # API  →  http://localhost:8080/api
pnpm --filter @workspace/iot-platform run dev  # UI   →  http://localhost:5173
```

The Vite dev server proxies all `/api` requests to `localhost:8080` automatically in local mode — no CORS configuration required.

> **Why the seed step is required:** The platform's role switcher loads users from the database on startup.
> With an empty database, `currentUser` stays `null` and all permission-gated UI elements (create,
> edit, delete buttons, forms, action menus) are hidden by the role guard — making it look like
> half the app is broken. The seed script creates three users (admin, engineer, operator) and a
> sample asset hierarchy so the platform is immediately usable.

### Regenerating API client code

Run this after any change to the OpenAPI spec (`lib/api-spec/`):

```bash
pnpm --filter @workspace/api-spec run codegen
```

This regenerates React Query hooks (`lib/api-client-react`) and Zod schemas (`lib/api-zod`).

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `SESSION_SECRET` | No | — | Signs HTTP sessions |
| `PORT` | No | `8080` (API) / `5173` (UI) | Listening port; set automatically by Replit |
| `BASE_PATH` | No | `/` | URL prefix for the frontend; set automatically by Replit |

See `.env.example` for an annotated template.

---

## Deployment (Replit)

1. Set `DATABASE_URL` and `SESSION_SECRET` as **Replit secrets** (Settings → Secrets).
2. Click **Publish** in the Replit workspace.
3. Replit builds both artifacts and routes them through its global reverse proxy:
   - API → `https://<domain>/api`
   - UI  → `https://<domain>/`

See [`docs/operations/runbook.md`](docs/operations/runbook.md) for detailed deployment, monitoring, and rollback procedures.

---

## Monorepo structure

```
artifacts/
  api-server/        Express 5 REST + WebSocket API  (path /api, port 8080)
  iot-platform/      React + Vite SPA                (path /, auto port)
lib/
  api-spec/          OpenAPI 3.1 spec + Orval codegen config
  api-client-react/  Generated React Query hooks + fetch client
  api-zod/           Generated Zod schemas
  db/                Drizzle ORM schema + migrations (PostgreSQL)
scripts/             Utility and pre-install scripts
docs/                Architecture, operations, API, security documentation
.env.example         Environment variable template
pnpm-workspace.yaml  Workspace config, catalog pins, dependency overrides
```

---

## Authentication

The UI has a **split-screen login page** at `/login` (Web Synergies branding, industrial hero, feature checklist).

- **No auth backend** — login is mocked. Any email + password signs you in.
- On successful login the client sets `localStorage.ws_authed = "1"`; a route gate in `App.tsx` redirects any unauthenticated request to `/login`.
- **Sign Out** (top-right profile menu) clears the flag and returns to `/login`.
- RBAC (admin / engineer / operator / viewer) is still enforced separately by the frontend role guard — see below.
- Real logo: drop `web-synergies-logo.png` into `artifacts/iot-platform/public/`. Real hero photo: drop `hero.jpg` there and enable the photo block in `pages/Login.tsx`.

---

## Configuration reference

| Area | Where to change |
|------|----------------|
| DB schema | `lib/db/src/schema/` + run `pnpm --filter @workspace/db run push` |
| API routes | `artifacts/api-server/src/routes/` + update `lib/api-spec/` |
| RBAC permissions | `artifacts/iot-platform/src/contexts/UserContext.tsx` |
| Alarm rules | UI → `/alarm-rules` or `POST /api/alarm-rules` |
| Broker config | UI → `/brokers` |
| Retention policies | UI → `/data-management` |
| API client scopes | UI → `/api-clients` |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `pnpm install` fails with native package errors | Stale lockfile from old platform-binary overrides | Delete `pnpm-lock.yaml` and re-run `pnpm install` |
| API fails to start (`DATABASE_URL not set`) | Missing `.env` file | Copy `.env.example` → `.env` and set `DATABASE_URL` |
| Vite 404 on `/api` requests | API server not running | Start api-server first; confirm port 8080 is free |
| MQTT broker not connecting | Wrong host / port / credentials | Check and update broker settings at `/brokers` |
| Drizzle migrations fail | `.env` not loaded by drizzle-kit | Confirm `.env` exists at the repo root |
| Alarms not firing | Asset is in maintenance mode | Toggle off maintenance in the asset detail panel |
| Dashboard shows stale data | WebSocket disconnected | Reload the page; verify `/api/ws` is reachable |
| API returns 401 | Missing or expired API key | Check API client status at `/api-clients` |
| Login page never shows (app opens straight to dashboard) | `ws_authed` flag still set from a prior session | DevTools → Console → `localStorage.removeItem("ws_authed")`, then hard reload (Ctrl+Shift+R) |

---

## Documentation

Full architecture, data, API, security, and operations documentation lives in [`docs/`](docs/).

| Document | Purpose |
|----------|---------|
| [`docs/overview/project-overview.md`](docs/overview/project-overview.md) | Purpose, scope, personas, goals |
| [`docs/architecture/01-solution-architecture.md`](docs/architecture/01-solution-architecture.md) | High-level design, technology choices |
| [`docs/api/api-reference.md`](docs/api/api-reference.md) | Full endpoint reference |
| [`docs/security/security-architecture.md`](docs/security/security-architecture.md) | Auth, RBAC, secrets, known gaps |
| [`docs/review/architecture-review-report.md`](docs/review/architecture-review-report.md) | Strengths, risks, roadmap |
| [`DOCUMENTATION_STATUS.md`](DOCUMENTATION_STATUS.md) | Coverage, confidence, gaps |

---

## Contribution guide

1. Branch from `main`.
2. Follow existing TypeScript conventions (strict mode, avoid `any`).
3. All new API routes require a matching entry in the OpenAPI spec — run codegen after.
4. Run `pnpm run typecheck` before opening a pull request.
5. Update the relevant `docs/` files for any API, schema, or behaviour changes.
6. Documentation is treated as code — see [`docs/governance.md`](docs/governance.md).
