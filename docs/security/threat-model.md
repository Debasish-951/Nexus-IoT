# Threat Model

**Confidence: High** — based on implemented architecture; risk levels are judgement-based.

---

## Attack Surface

| Surface | Description | Exposure |
|---------|-------------|---------|
| REST API (`/api/*`) | All HTTP endpoints | Public (through Replit proxy) |
| WebSocket (`/api/ws`) | Event stream | Public (no auth) |
| Ingest endpoints | `POST /api/ingest/*` | Public (optional API key) |
| Database | PostgreSQL | Internal only (not network-exposed) |
| MQTT connections | Outbound to configured brokers | Depends on broker network config |
| Webhook delivery | Outbound HTTP POST | Depends on receiver |
| Browser localStorage | User profile + dashboard state | Local browser only |

---

## Threat Analysis

### T1: Unauthenticated Telemetry Injection
**Description:** An attacker calls `POST /api/ingest/payload` without a valid API key to inject fake sensor data.  
**Likelihood:** High — endpoint accepts unauthenticated requests (`optionalApiKeyAuth`)  
**Impact:** Medium — fake data pollutes telemetry, may trigger false alarms or clear real alarms  
**Current mitigation:** `optionalApiKeyAuth` validates token if provided; no token = still allowed  
**Recommendation:** Require authentication for ingest (`apiKeyAuth("ingest:write")` instead of `optionalApiKeyAuth`) in production

---

### T2: User Impersonation via Profile Switch
**Description:** Any browser user can switch to any role (including admin) via the profile dropdown. There is no authentication for profile selection.  
**Likelihood:** High — fully exposed in the UI  
**Impact:** Critical — admin profile allows full system control including user deletion, broker config changes  
**Current mitigation:** None  
**Recommendation:** Implement Replit Auth or Clerk SSO; tie roles to authenticated user identity

---

### T3: API Secret Plaintext Exposure
**Description:** API client secrets are stored in plaintext in the `api_clients` table. A DB dump or SQL injection exposes all active secrets.  
**Likelihood:** Low (DB not externally accessible, no SQL injection surface found)  
**Impact:** High — compromised secrets allow full API access  
**Recommendation:** Hash secrets with bcrypt (one-way); store hash only; rotate on display

---

### T4: MQTT Credential Exposure
**Description:** MQTT broker passwords stored in plaintext in the `brokers` table.  
**Likelihood:** Low (same as T3)  
**Impact:** Medium — allows attacker to connect to MQTT brokers and inject/intercept telemetry  
**Recommendation:** Encrypt MQTT credentials at rest using application-level encryption

---

### T5: Unrestricted CORS
**Description:** The API allows requests from any origin (open CORS). A malicious website visited by a logged-in user (browser with localStorage profile) could make API calls.  
**Likelihood:** Low (no cookies / session tokens to steal; UI RBAC is client-side only)  
**Impact:** Low — read access to platform data from any origin  
**Recommendation:** Restrict CORS to the platform domain in production

---

### T6: Rate Limit Bypass on Restart
**Description:** The in-memory rate limiter resets when the API server restarts. An attacker could spam requests, trigger a restart, and bypass the rate limit.  
**Likelihood:** Low  
**Impact:** Low — API does not have resource-intensive operations beyond ingest  
**Recommendation:** Use Redis-backed rate limiting for persistence across restarts

---

### T7: Webhook SSRF (Server-Side Request Forgery)
**Description:** Alarm rules accept a user-configured webhook URL. An admin could set this to `http://169.254.169.254/` (AWS metadata) or `http://localhost:8080/api/...` to probe internal services.  
**Likelihood:** Low — requires admin access  
**Impact:** Medium — could expose cloud metadata or trigger internal API side effects  
**Recommendation:** Validate webhook URLs against an allowlist of schemes and disallow private IP ranges

---

### T8: Expression Engine Abuse
**Description:** Runtime attribute expressions evaluated by `expr-eval`. A malicious expression could cause CPU exhaustion via deeply nested calls or infinite recursion.  
**Likelihood:** Low — requires engineer+ role to create attributes  
**Impact:** Low — API server process may become unresponsive  
**Recommendation:** Add timeout to expression evaluation (e.g., `AbortSignal.timeout` equivalent for sync operations)

---

### T9: Webhook Delivery Information Disclosure
**Description:** Alarm webhooks include asset IDs, metric names, values, and threshold details. If the webhook URL is compromised, this operational data is exposed to a third party.  
**Likelihood:** Low  
**Impact:** Low (operational data, not credentials)  
**Current mitigation:** None  
**Recommendation:** Add HMAC signature header to webhook deliveries for receiver verification

---

## Risk Matrix

| Threat | Likelihood | Impact | Risk Level | Priority |
|--------|-----------|--------|------------|---------|
| T2: User Impersonation | High | Critical | **Critical** | Immediate |
| T1: Unauthenticated Ingest | High | Medium | **High** | 30 days |
| T3: Secret Plaintext | Low | High | **High** | 30 days |
| T4: MQTT Credential Exposure | Low | Medium | **Medium** | 90 days |
| T5: Open CORS | Low | Low | **Low** | 90 days |
| T7: Webhook SSRF | Low | Medium | **Medium** | 90 days |
| T6: Rate Limit Bypass | Low | Low | **Low** | 180 days |
| T8: Expression Abuse | Low | Low | **Low** | 180 days |
| T9: Webhook Disclosure | Low | Low | **Low** | 180 days |
