# Technical Debt Register

**Last Updated:** May 2026  
**Confidence:** High — items derived from implemented source code and known gaps.

---

## Severity Levels
- **Critical** — Blocks production use; must fix before go-live
- **High** — Significant operational, security, or quality impact; fix within 30 days
- **Medium** — Noticeable impact; fix within 90 days
- **Low** — Minor; fix within 180 days or as opportunity permits

---

## Register

### TD-001: No Automated Test Suite
**Severity:** High  
**Impact:** Every code change risks undetected regressions; developer confidence is low; CI is impossible without tests  
**Description:** The codebase has zero unit, integration, or end-to-end tests. All validation is manual via the browser UI.  
**Recommended Fix:**
1. Add Vitest for unit tests (ingest pipeline normaliser, alarm rule evaluator, expression engine)
2. Add Playwright for E2E browser tests covering critical user flows
3. Add API integration tests with a test database

**Priority:** High — implement in first 30 days

---

### TD-002: No CI/CD Pipeline
**Severity:** High  
**Impact:** No automated quality gate; broken code can be deployed to production without detection  
**Description:** Deployments are manual. No linting, typechecking, or testing runs automatically on commit.  
**Recommended Fix:**
- Configure GitHub Actions with `typecheck`, `codegen-sync`, and `test` jobs
- Block PRs that fail any job

**Priority:** High — implement alongside TD-001

---

### TD-003: API Client Secrets Stored Plaintext
**Severity:** High  
**Impact:** Database compromise exposes all active machine credentials  
**Description:** `api_clients.client_secret` is stored as plaintext. A SQL dump or injection attack would expose all secrets.  
**Recommended Fix:**
- Hash secrets with `bcrypt` on creation
- Store only the hash; display plaintext only at creation time
- Add a `rotateSecret` endpoint that generates a new secret and returns it once

**Priority:** High — implement before production deployment

---

### TD-004: MQTT Passwords Stored Plaintext
**Severity:** High  
**Impact:** Database compromise exposes MQTT broker credentials  
**Description:** `brokers.mqtt_password` stored as plaintext in PostgreSQL.  
**Recommended Fix:**
- Encrypt at rest using application-level encryption (e.g., `crypto.createCipheriv` with a key from secrets)
- Or use a secrets manager (AWS Secrets Manager, HashiCorp Vault)

**Priority:** High — implement before production deployment

---

### TD-005: No User Authentication System
**Severity:** Critical  
**Impact:** Any user with browser access can assume the admin role; no user-level access control  
**Description:** The platform uses a localStorage-based profile switcher. There is no login form, session management, or JWT validation.  
**Recommended Fix:**
- Implement Replit Auth (OpenID Connect) for human authentication
- Tie the `User` record's role to the authenticated identity
- Remove the profile switcher; replace with identity-bound role display

**Priority:** Critical — implement before any production deployment with multiple users

---

### TD-006: Open CORS Policy
**Severity:** Medium  
**Impact:** Any website visited by a user with a valid browser session can make API calls  
**Description:** `app.use(cors())` with default settings allows all origins.  
**Recommended Fix:**
```typescript
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN ?? '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
```

**Priority:** Medium — implement before production deployment

---

### TD-007: Visualization.tsx File Size (~2,400 Lines)
**Severity:** Medium  
**Impact:** Hard to navigate and maintain; long load times for developers; merge conflicts likely  
**Description:** The entire visualization feature (chart widgets, widget dialog, SPC rows, overlay rows, dashboard management) lives in a single 2,400-line file.  
**Recommended Fix:**
- Extract `WidgetDialog` to `components/WidgetDialog.tsx`
- Extract `OverlayRow` and `SpcRow` to sub-components
- Extract `ChartWidget` and its variants to `components/charts/`
- Extract dashboard management hooks to `hooks/useDashboards.ts`

**Priority:** Medium — refactor in 90-day window

---

### TD-008: Dashboard Widget Layout Not Persisted to DB
**Severity:** Medium  
**Impact:** Widget positions and sizes are lost if the user clears `localStorage` or switches browsers  
**Description:** Widget layout (grid column/row position, size) is persisted in `localStorage` under `ws-dashboards-v1`. Only widget configuration (type, asset, metric) is persisted to the `viz_dashboards.widgets` JSON column.  
**Recommended Fix:**
- Move grid position (`col`, `row`, `width`, `height`) into the `widgets` JSONB array
- Remove `localStorage` dependency for layout
- Keep `localStorage` only as a fallback/cache layer

**Priority:** Medium

---

### TD-009: No Webhook Retry / Dead-Letter Queue
**Severity:** Low  
**Impact:** Alarm notifications to external systems are silently dropped if the webhook receiver is temporarily down  
**Description:** Webhook delivery uses `void fetch(...)` with a 5-second timeout. Failures are discarded.  
**Recommended Fix:**
- Add a `webhook_delivery_log` table
- Implement exponential backoff retry (3 attempts)
- After 3 failures, mark as dead-letter and alert the operator

**Priority:** Low — implement in 180-day window

---

### TD-010: Expression Engine Has No Timeout
**Severity:** Low  
**Impact:** A malicious or inadvertent infinite-loop expression could block the Node.js event loop during ingest  
**Description:** `expr-eval` evaluates expressions synchronously. There is no timeout or resource limit.  
**Recommended Fix:**
- Evaluate expressions in a `Worker` thread with a message timeout
- Or validate expressions at save-time to reject non-terminating patterns

**Priority:** Low

---

### TD-011: Activity Logs Have No Retention Policy
**Severity:** Low  
**Impact:** `activity_logs` table grows unbounded; no built-in cleanup  
**Description:** The data retention system only targets `telemetry`. Other high-growth tables (`activity_logs`, `alarm_history`, `broker_events`) have no retention mechanism.  
**Recommended Fix:**
- Extend the retention policy system to support these tables
- Add a default 1-year retention for `activity_logs` (configurable)

**Priority:** Low

---

### TD-012: In-Memory Rate Limiter
**Severity:** Medium  
**Impact:** Rate limit state resets on every server restart; also not shared across nodes  
**Description:** `Map<string, RateBucket>` in `middleware/apiKeyAuth.ts` is process-local and ephemeral.  
**Recommended Fix:**
- Replace with Redis-backed atomic counter using `SET NX` + `EXPIRE`
- Or accept this limitation for single-node deployments and document it clearly

**Priority:** Medium for multi-node; Low for single-node

---

### TD-013: Platform Binary Overrides Blocking Cross-Platform Install ✅ RESOLVED

**Severity:** High (was blocking Windows/macOS development)  
**Resolved:** 2026-06-22  
**Description:** `pnpm-workspace.yaml` contained ~80 lines of `"-"` overrides explicitly excluding all non-Linux-x64 native binaries (esbuild, rollup, lightningcss, @tailwindcss/oxide). This prevented `pnpm install` from completing on Windows or macOS. Additionally, `vite.config.ts` threw hard errors when `PORT`/`BASE_PATH` were absent, and no `.env.example` was provided.  
**Fix Applied:** Removed all platform-binary overrides; pnpm now resolves correct optionals natively. Added `dotenv` support to api-server and db; added safe defaults for `PORT`/`BASE_PATH`; added Vite dev proxy; created `.env.example`. See ADR-007.

---

## Summary by Priority

| Priority | Count | Items |
|----------|-------|-------|
| Critical | 1 | TD-005 |
| High | 4 | TD-001, TD-002, TD-003, TD-004 |
| Medium | 4 | TD-006, TD-007, TD-008, TD-012 |
| Low | 3 | TD-009, TD-010, TD-011 |
| Resolved | 1 | TD-013 |
