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
| **Authentication** | Server-side sessions (HttpOnly cookie + CSRF token), invitation and activation links, password reset, lockout, rate limits; API keys for gateways |
| **Data management** | Storage analytics, configurable retention policies, on-demand pruning |
| **Reports** | Telemetry summary, alarm report, asset snapshot; CSV and JSON export |
| **Brokers** | MQTT / REST / Azure IoT with payload mapping rules and connection history |
| **API clients** | OAuth-style client credentials with scopes, IP allowlist, and usage tracking |
| **Activity log** | Full audit trail with actor identity, category filtering, and pagination |
| **RBAC** | Nine roles (Super Admin, Company Admin, Admin, Project Manager, Team Lead, Developer, Engineer, Operator, Viewer), enforced by the API server |

---

## Quick start

You need PostgreSQL 16, Node 20+ and pnpm. Full steps are in
[Local development setup](#local-development-setup) below; the short version:

```bash
pnpm install
cp .env.example .env          # set DATABASE_URL
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run seed    # required — the UI is unusable without it
pnpm dev:api                  # terminal 1 → http://localhost:8080/api
pnpm dev:web                  # terminal 2 → http://localhost:5173
```

Open one of the activation links that `seed` printed, choose a password, and sign in
at `http://localhost:5173`. There are no default passwords.

> The API server's `dev` script is a one-shot build-and-start with **no watch**.
> Re-run `pnpm dev:api` after any server-side edit.

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
# Edit .env — fill in DATABASE_URL
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

> **Why the seed step is required:** there are no default credentials, so an empty database has
> nobody who can sign in. The seed creates three invited users (admin, jsmith as engineer, mwilson
> as operator) without passwords and prints a single-use activation link for each; open one to set
> a password. It also creates a Demo Plant → Demo Pump hierarchy with two alarm rules, and an API
> client `local-dev-client` whose random secret is printed once with a sample `curl` ingest
> command. Re-running it is safe and prints fresh activation links. Do not run it on a production
> server; see [docs/operations/vm-deployment-checklist.md](docs/operations/vm-deployment-checklist.md).

### Regenerating API client code

Run this after any change to the OpenAPI spec (`lib/api-spec/openapi.yaml`):

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
| `PORT` | No | `8080` (API) / `5173` (UI) | Listening port |
| `BASE_PATH` | No | `/` | URL prefix for the frontend; set only if a reverse proxy serves it from a sub-path |

See `.env.example` for an annotated template.

---

## Deployment

Self-hosted on a single Linux VM. Two pieces have to be in place, because the API
server intentionally serves no static files:

1. **The API server** — build with `pnpm build`, then run `pnpm start`
   (`node --enable-source-maps artifacts/api-server/dist/index.mjs`) under systemd.
2. **A reverse proxy** — nginx serves the built SPA from
   `artifacts/iot-platform/dist/public` with an `index.html` history fallback, and
   forwards `/api` (including the `/api/ws` WebSocket upgrade) to port 8080. This is
   also what terminates TLS and what makes the IP allowlist trustworthy — it must
   **overwrite** `X-Forwarded-For`, not append to it.

**[`docs/operations/vm-deployment-checklist.md`](docs/operations/vm-deployment-checklist.md)
is the step-by-step guide** — env table, systemd unit, nginx site, ordered
verification, and the things that commonly bite.

> Run a **single** API server instance. Rate-limit counters, the WebSocket client
> registry, the MQTT subscriber and the retention pruner are all in-process, so a
> second instance would double-ingest every MQTT message.

Note also that pulling changes no longer triggers anything automatically: run
`pnpm install` yourself, and apply schema changes deliberately.

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

The UI has a login page at `/login`, plus `/activate` and `/reset-password` for the links sent by email.

- **Sessions are server-side.** Signing in creates a session in PostgreSQL, identified by an HttpOnly `is_session` cookie. Cookie-authenticated writes must send the `x-csrf-token` header (the generated API client and `apiFetch` do this).
- **Accounts start as invitations.** An administrator creates the user without a password; the user sets one through a single-use activation link. Failed sign-ins lock the account after `AUTH_LOCKOUT_THRESHOLD` attempts.
- **Machine clients** (gateways, integrations) use API keys: `X-API-Key: <secret>` or `Authorization: Bearer <secret>`.
- **RBAC is enforced by the API server** (`artifacts/api-server/src/middleware/authorize.ts`, deny by default). The frontend role guard mirrors the same rules for usability.
- All settings are environment variables; see `.env.example` and [docs/security/auth-upgrade.md](docs/security/auth-upgrade.md).
- Real logo: drop `web-synergies-logo.png` into `artifacts/iot-platform/public/`. Real hero photo: drop `hero.jpg` there and enable the photo block in `pages/Login.tsx`.

---

## Configuration reference

| Area | Where to change |
|------|----------------|
| DB schema | `lib/db/src/schema/` + run `pnpm --filter @workspace/db run push` |
| API routes | `artifacts/api-server/src/routes/` + update `lib/api-spec/` |
| RBAC permissions | `artifacts/api-server/src/lib/rbac.ts` (roles, permissions) and `middleware/authorize.ts` (route rules); the frontend reads the catalogue from the server |
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
| Nobody can sign in on a new database | Seed not run, or activation links expired | Run `pnpm --filter @workspace/db run seed` again; it prints fresh activation links |

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
| [`docs/DOCUMENTATION_STATUS.md`](docs/DOCUMENTATION_STATUS.md) | Coverage, confidence, gaps |

---

## Contribution guide

1. Branch from `main`.
2. Follow existing TypeScript conventions (strict mode, avoid `any`).
3. All new API routes require a matching entry in the OpenAPI spec — run codegen after.
4. Run `pnpm run typecheck` before opening a pull request.
5. Update the relevant `docs/` files for any API, schema, or behaviour changes.
6. Documentation is treated as code — see [`docs/governance.md`](docs/governance.md).
