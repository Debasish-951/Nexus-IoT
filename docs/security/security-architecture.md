# Security Architecture

**Confidence: High** — based on implemented auth middleware, RBAC, and API client code.

---

## Authentication

### Human Users (Browser)
There is no traditional login form. Human authentication is implemented as a **UI-layer role profile switcher**:

1. On first load, the frontend calls `GET /api/users` and defaults to the first admin user found
2. The active profile is stored in `localStorage` key `iot_current_user`
3. Users can switch profiles (impersonate roles) from the top-right dropdown

**Implication:** Any browser user can switch to any user profile. This is intentional for a single-operator demo environment but is a **critical security gap** for multi-user production deployments. See [Threat Model](threat-model.md).

### Machine Clients (API)
External API consumers authenticate using **API client credentials**:

```
Authorization: Bearer <clientSecret>
# or
X-API-Key: <clientSecret>
```

Credentials are created in `Security → API Clients`. The `clientSecret` is displayed once on creation (not hashed in the database — see security gaps).

### Middleware: `apiKeyAuth(scope?)`
Full validation pipeline:
1. Extract secret from `Authorization: Bearer` header or `X-API-Key` header
2. Query `api_clients` table — `SELECT WHERE client_secret = secret`
3. Check `status = "active"`
4. Check `expiresAt` not in the past
5. Check `allowedIps` allowlist (if non-empty, remote IP must match)
6. Check `scopes` (if `requiredScope` provided and client has non-wildcard scopes)
7. Check in-memory rate limit (120 RPM per client, 1-minute sliding window)
8. Fire-and-forget: update `lastUsedAt` and increment `totalRequests`

---

## Authorization (RBAC)

### Role Hierarchy
| Role | Permissions |
|------|------------|
| `admin` | All permissions |
| `engineer` | view, manage_assets, manage_templates, manage_alarms, acknowledge_alarms, manage_brokers, manage_destinations |
| `operator` | view, acknowledge_alarms |
| `viewer` | view |

### Permission Enforcement
- **Frontend**: `RoleGuard` component wraps UI elements; `can(permission)` check in `UserContext`
- **Backend**: No per-role server-side enforcement — relies on API client scopes for machine access; human RBAC is UI-only

### Actor Header Attribution
Every mutating request from the frontend carries:
```
X-Actor-Name: <user.fullName>
X-Actor-Role: <user.role>
X-Actor-Username: <derived from email>
```
These are injected by `setActorHeaders()` in the generated fetch client and written to `activity_logs`.

---

## Secrets Management

| Secret | Storage | Access |
|--------|---------|--------|
| `DATABASE_URL` | Replit Secrets | API Server process only |
| `SESSION_SECRET` | Replit Secrets | API Server process only |
| `API client secrets` | PostgreSQL `api_clients.client_secret` | Plaintext — not hashed (gap) |
| `MQTT credentials` | PostgreSQL `brokers.mqtt_password` | Plaintext in DB (gap) |

**Gaps:**
- API client secrets are stored as plaintext in the database
- MQTT passwords are stored as plaintext in the database
- No secrets rotation automation (manual only)

---

## Encryption

| Data | At Rest | In Transit |
|------|---------|-----------|
| PostgreSQL data | Replit managed encryption at rest | TLS enforced by Replit managed DB |
| MQTT credentials | Plaintext in DB | Not encrypted at rest |
| HTTP traffic | — | HTTPS (TLS 1.2+) via Replit proxy (mTLS) |
| WebSocket | — | WSS (TLS) via Replit proxy |
| Webhook outbound | — | HTTPS target URL (depends on receiver) |

---

## Security Controls

| Control | Implementation | Coverage |
|---------|---------------|---------|
| Rate limiting | In-memory 120 RPM per API client | API clients only |
| IP allowlist | Per API client `allowedIps` array | API clients only |
| Scope enforcement | Per API client `scopes` array | Ingest endpoints (optional) |
| Token expiry | `expiresAt` field per API client | API clients only |
| Token revocation | Set `status = "revoked"` | API clients only |
| CORS | `cors()` middleware (open, all origins) | All API routes |
| Input validation | Zod schemas on ingest and typed endpoints | Selected routes |
| Audit trail | `activity_logs` table | Write operations |
| Maintenance mode | Suppresses alarm evaluation | Asset-level |

---

## CORS Policy

Currently: **open CORS** — `cors()` middleware with default settings allows all origins.

**Gap:** In production, CORS should be restricted to the known frontend domain:
```typescript
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
```

---

## Security Gaps Summary

| Gap | Severity | Recommendation |
|-----|----------|---------------|
| No user login / session auth | Critical | Implement Replit Auth or Clerk for human authentication |
| API secrets stored plaintext | High | Hash secrets with bcrypt; store only the hash |
| MQTT passwords stored plaintext | High | Encrypt at rest using a KMS or application-level encryption |
| Open CORS | Medium | Restrict to known frontend origin in production |
| No server-side role enforcement | High | Add role middleware or scope requirements to write endpoints |
| In-memory rate limiter | Medium | Redis-backed for multi-node; also resets on restart |
| No token rotation automation | Low | Add secret rotation workflow |

See [Threat Model](threat-model.md) for full risk analysis.
