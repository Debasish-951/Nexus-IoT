# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Integrated Suite — industrial IoT data acquisition + analytics platform. Ingests sensor telemetry (HTTP/MQTT/Azure IoT), evaluates alarm rules in real time, serves a configurable React dashboard. pnpm monorepo, self-hosted on a single Linux VM (nginx serves the built SPA and proxies `/api`; see `docs/operations/vm-deployment-checklist.md`).

## Commands

Run from repo root (`Nexus-IoT/`). All packages are named `@workspace/*`.

```bash
pnpm install                                    # native binaries resolved per-OS
pnpm run typecheck                              # libs (tsc --build) + artifacts; run before any PR
pnpm run build                                  # typecheck + recursive build

# Database (PostgreSQL via Drizzle) — needs .env at repo root with DATABASE_URL
pnpm --filter @workspace/db run push            # apply schema (push, NOT migrations)
pnpm --filter @workspace/db run push-force      # push with --force (destructive)
pnpm --filter @workspace/db run seed            # REQUIRED before UI is usable — see below

# Run services (separate terminals)
pnpm --filter @workspace/api-server run dev     # API  → http://localhost:8080/api
pnpm --filter @workspace/iot-platform run dev   # UI   → http://localhost:5173 (proxies /api → 8080)

# Regenerate API client/schemas after ANY OpenAPI spec change
pnpm --filter @workspace/api-spec run codegen
```

No test runner is configured — `typecheck` is the gate. To typecheck one package: `pnpm --filter @workspace/<name> run typecheck`.

Note: `api-server`'s `dev` does a full esbuild rebuild + start (no watch) — re-run it after server-side edits.

**Root `typecheck` can silently no-op.** When the repo path contains parentheses (e.g. an OneDrive path like `...WebSynergies(S) Pte Ltd...`), pnpm's `--filter "./artifacts/**"` fails to resolve, so `pnpm run typecheck` prints `No projects matched the filters` and exits 0 having only run `tsc --build` over `lib/` — a green result is not evidence `artifacts/*` compiles. If you see that message, typecheck each artifact directly instead:

```bash
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/iot-platform run typecheck
pnpm --filter @workspace/mockup-sandbox run typecheck
```

## Why seed is mandatory

The role switcher loads users from the DB on startup. With an empty DB `currentUser` stays `null`, so the RBAC `RoleGuard` hides every create/edit/delete control — the app looks half-broken. `seed` creates 3 users (admin/jsmith-engineer/mwilson-operator) + a sample asset hierarchy with fixed UUIDs (Fan = `bbbb0002-...0001`, Plant 1 = `bbbb0001-...0001`).

## Architecture

```
artifacts/api-server/    Express 5 REST + WebSocket API (port 8080, path /api)
artifacts/iot-platform/  React 19 + Vite SPA (path /)
artifacts/mockup-sandbox/ UI prototyping sandbox
lib/api-spec/            OpenAPI 3.1 spec (src/openapi.yaml) + Orval codegen config
lib/api-client-react/    GENERATED TanStack Query hooks + fetch client
lib/api-zod/             GENERATED Zod schemas
lib/db/                  Drizzle ORM schema (src/schema/, one file per table) + seed
scripts/                 utility/preinstall scripts
docs/                    extensive architecture/api/security/ops docs (treated as code)
```

**Dependency rule:** `artifacts/*` are leaf nodes — they never import each other. The codegen chain is `lib/db` → `lib/api-spec` → `lib/api-zod` + `lib/api-client-react`. The API server imports `lib/db` and `lib/api-zod`; the frontend imports `lib/api-client-react`.

**Codegen is the source of truth for the API contract.** Editing a route means editing `lib/api-spec/src/openapi.yaml` then running codegen. Never hand-edit `src/generated/` files. `lib/api-zod/src/index.ts` must contain ONLY `export * from "./generated/api";`.

## Conventions that bite

- **Express 5**: async handlers typed `Promise<void>`; use `res.status(x).json(data); return;` (don't `return res.json(...)`). Wildcard routes use `/{*splat}`.
- **RBAC is enforced on both sides.** The server is authoritative: `middleware/authorize.ts` holds a deny-by-default route table (an unmapped route is refused), applied once in `app.ts` alongside session auth, CSRF and API-key auth, with every denial written to `security_events`. The frontend's `RoleGuard`/`UserContext.tsx` (`can(permission)` against `ROLE_PERMISSIONS`) mirrors those rules so the UI is coherent — it is not the control. Adding a route therefore means adding a rule to `ROUTE_RULES`, or it 403s. `AUTH_ENFORCE=false` disables enforcement and is a documented rollback-only escape hatch that logs loudly.
- **Writes need CSRF.** Cookie-authenticated POST/PUT/PATCH/DELETE are rejected without an `x-csrf-token` header. In the frontend use `apiFetch` from `@/lib/auth-api`, never bare `fetch` — the generated API client already handles it.
- **WebSocket** lives at `/api/ws` (same proxy as REST). `broadcast(type, data)` in `lib/ws-broadcast.ts` fans out to all clients — no pub/sub.
- **Adding dependencies**: workspace pins `minimumReleaseAge: 1440` (24h) — brand-new package versions are rejected. Shared versions are pinned in the `catalog:` block of `pnpm-workspace.yaml`; prefer `catalog:` references over raw versions.
- **Activity logging**: write operations should call `logActivity(action, category, targetId, targetName, detail, req)` from `routes/activity_log.ts`.

## Ingest pipeline (api-server `routes/ingest.ts`)

`normalise(body)` → `processNormalised(n)`: writes telemetry, updates dynamic attributes, evaluates runtime expressions (`expr-eval`, variables auto-populated from numeric attrs on the asset), evaluates alarm rules (threshold + rate-of-change), fires webhooks (fire-and-forget `fetch` with `AbortSignal.timeout(5000)`). Telemetry is attributed by matching payload `deviceId` to an asset's `identifier` (exact, case-sensitive). Assets in maintenance mode suppress alarm evaluation.

The MQTT subscriber (`services/mqtt.ts`) and the hourly retention pruner both start non-blocking in `src/index.ts`.

## Visualization owns its own hierarchy

`Visualization.tsx` does **not** mirror the asset tree. It has its own user-created hierarchy stored in `localStorage` (`wsviz:hierarchy`, via `features/dashboards/vizHierarchy.ts` / `useVizHierarchy()`) — assets created in Asset Management don't appear there, and users freely create/rename/delete viz nodes. Each viz node keeps one dashboard at `wsviz:widgets:<nodeId>`. The link to real assets survives only per-widget: `WidgetConfigPanel` has an asset dropdown plus a metric dropdown (`useMetricChoices(assetId)`) unioning live telemetry tags with asset attributes. Don't reintroduce asset→viz tree mirroring — the shared `AssetTree`/`TreeNode` components are also used by `Assets.tsx` for the real hierarchy, so changes to those components affect both screens.

## Docs

`docs/` is comprehensive and kept current — consult it before large changes. `docs/technical-reference.md` has the most detailed per-table / per-route reference. `docs/operations/vm-deployment-checklist.md` is the deployment guide. ADRs in `docs/adr/` explain key choices (Express 5, Drizzle, OpenAPI codegen, frontend RBAC, cohosted WebSocket, pnpm monorepo) — note that ADR-004 and ADR-007 are historical records written when the platform ran on a hosted preview environment, and describe behaviour that has since changed.
