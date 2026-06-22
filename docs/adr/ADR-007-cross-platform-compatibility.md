# ADR-007: Cross-Platform Developer Environment Compatibility

**Status:** Accepted  
**Date:** 2026-06-22  
**Confidence:** High

---

## Context

The repository was originally developed exclusively on the Replit Linux (x86-64) platform. Several configuration choices made it impossible to install dependencies or start the development server on Windows or macOS:

1. **`pnpm-workspace.yaml` overrides** — Approximately 80 lines of `"-"` overrides explicitly excluded every non-Linux-x64 native binary (esbuild, rollup, lightningcss, @tailwindcss/oxide). This prevented `pnpm install` from resolving the correct platform binary on Windows and macOS.
2. **Vite `vite.config.ts`** — Threw a hard error if `PORT` or `BASE_PATH` environment variables were absent. On Replit these are injected automatically; locally they are not.
3. **`lib/db/drizzle.config.ts`** — Used CommonJS `__dirname` (invalid in ES Modules) and did not load `.env` before checking `DATABASE_URL`.
4. **`artifacts/api-server/src/index.ts`** — Threw if `PORT` was not set; did not load `.env`.
5. **No `.env.example`** — Developers had no reference for required environment variables.
6. **No API proxy for local dev** — Without the Replit reverse proxy, frontend `/api` requests returned 404.

---

## Decision

Apply the minimum set of changes to make `pnpm install` + `pnpm run dev` work out of the box on any developer's machine without requiring Replit-specific environment injection.

### Changes made

| File | Change |
|------|--------|
| `pnpm-workspace.yaml` | Removed all `"-"` platform binary overrides; pnpm resolves the correct optional binary per platform natively via `os`/`cpu` package fields |
| `artifacts/iot-platform/vite.config.ts` | `PORT` defaults to `5173`; `BASE_PATH` defaults to `/`; added `/api` proxy to `localhost:8080` activated only when `REPL_ID` is absent |
| `artifacts/api-server/src/index.ts` | Added `import "dotenv/config"` as first import; `PORT` defaults to `8080` |
| `lib/db/drizzle.config.ts` | Added `import "dotenv/config"`; replaced `__dirname` with `fileURLToPath(import.meta.url)` |
| `artifacts/api-server/package.json` | Added `dotenv` as a runtime dependency |
| `lib/db/package.json` | Added `dotenv` as a runtime dependency |
| `.env.example` | Created with annotated `DATABASE_URL`, `PORT`, `SESSION_SECRET` entries |

---

## Alternatives Considered

| Alternative | Reason Not Chosen |
|-------------|------------------|
| Keep platform binary overrides, document as Replit-only | Prevents open-source contribution and local development by the team |
| Use a Docker Compose setup for local dev | Adds Docker as a prerequisite; more complex than a simple `.env` + `pnpm install` |
| Use Vite's built-in `loadEnv` to load `.env` | Would work for the UI process but not the API server or drizzle-kit; `dotenv/config` is simpler and consistent |
| Throw on missing `PORT` and document manual export | Error-prone for new developers; defaults are conventional and unambiguous |

---

## Tradeoffs

| Pro | Con |
|-----|-----|
| Zero-config local setup after `cp .env.example .env` | `dotenv` is now a runtime dependency of api-server and db |
| Vite proxy means no CORS configuration locally | Proxy only works when running both services locally; not applicable to production |
| Removing binary overrides keeps the lockfile cross-platform | Slightly larger `pnpm-lock.yaml` (metadata for all platforms stored) |
| Consistent `PORT` default (8080) matches Vite proxy target | API server must not already be occupying port 8080 locally |

---

## Consequences

- Developers on Windows and macOS can now run `pnpm install` and `pnpm run dev` without modifying any configuration.
- The Vite proxy (`/api → localhost:8080`) is enabled automatically for local development and disabled on Replit.
- The `.env.example` file is the canonical reference for required configuration; keep it in sync when new environment variables are added.
- Native binary package selection is now fully delegated to pnpm's built-in optional dependency resolution — do not reintroduce `"-"` overrides for platform binaries.
