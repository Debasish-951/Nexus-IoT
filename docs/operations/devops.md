# DevOps

**Confidence: Medium** — Replit CI/CD is not yet configured; this documents the current manual process and recommended improvements.

---

## CI/CD

### Current State
No automated CI/CD pipeline exists. All testing and deployment is manual via the Replit workspace.

### Recommended Pipeline (GitHub Actions)

```yaml
name: CI
on: [push, pull_request]
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 10 }
      - run: pnpm install
      - run: pnpm run typecheck

  codegen-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 10 }
      - run: pnpm install
      - run: pnpm --filter @workspace/api-spec run codegen
      - run: git diff --exit-code  # Fail if generated files are out of sync
```

---

## Build Pipeline

### API Server Build
```bash
pnpm --filter @workspace/api-server run build
```
- Tool: esbuild (`build.mjs`)
- Input: `src/index.ts`
- Output: `dist/index.mjs` (bundled ESM)
- Plugin: `esbuild-plugin-pino` ensures pino transport files are co-located

### IoT Platform Build
```bash
pnpm --filter @workspace/iot-platform run build
```
- Tool: Vite
- Output: `dist/` (static HTML + JS + CSS)
- Environment: `PORT` defaults to `5173`; `BASE_PATH` defaults to `/` — no env file needed for local dev

### Codegen
```bash
pnpm --filter @workspace/api-spec run codegen
```
- Regenerates `lib/api-client-react/src/generated/`
- Regenerates `lib/api-zod/src/generated/api.ts`
- Must be run after any change to `lib/api-spec/openapi.yaml`

### Type Checking
```bash
pnpm run typecheck           # Full check: libs + all artifacts
pnpm run typecheck:libs      # Composite libs only (tsc --build)
pnpm --filter @workspace/api-server run typecheck   # Single artifact
```

---

## Release Process

1. Make changes in Replit workspace
2. Run `pnpm run typecheck` — ensure zero errors
3. If OpenAPI spec changed: run codegen and verify generated files
4. Test manually in preview pane
5. Commit (Replit creates automatic checkpoints)
6. Click **Publish** in Replit to deploy to production

### Rollback
Replit creates checkpoints on every session end and significant code change. To rollback:
- Open Replit checkpoint history
- Select target checkpoint
- Restore — workspace reverts to that state

---

## Environment Management

| Environment | Config Location | Database |
|-------------|----------------|---------|
| Local dev (non-Replit) | `.env` file at repo root (copy from `.env.example`) | Developer-provisioned PostgreSQL |
| Development (Replit) | Replit workspace secrets | Replit PostgreSQL (shared) |
| Production (Replit) | Replit deployment secrets | Replit PostgreSQL (separate production DB) |

### Adding a Secret
Use the Replit Secrets panel (or `environment-secrets` skill):
```bash
# Never hardcode secrets in source code
# Set via Replit UI: Tools → Secrets
```

---

## Dependency Management

```bash
# Add a runtime dependency to api-server
pnpm --filter @workspace/api-server add <package>

# Add a dev dependency to iot-platform
pnpm --filter @workspace/iot-platform add -D <package>

# Add to workspace catalog (shared across packages)
# Edit pnpm-workspace.yaml catalog section, then reference with "catalog:"
```

**Supply-chain protection:** `minimumReleaseAge: 1440` (24 hours) is set in `pnpm-workspace.yaml`. New package versions must be 24 hours old before pnpm will install them.
