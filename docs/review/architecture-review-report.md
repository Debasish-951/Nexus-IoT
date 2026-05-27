# Architecture Review Report

**Version:** 1.0  
**Date:** May 2026  
**Confidence:** High for structural observations; Medium for performance projections.

---

## Current Architecture Assessment

WS-Integrated Suite is a well-structured, contract-first industrial IoT platform with a clean monorepo layout, strong TypeScript coverage, and a coherent ingest-to-alarm pipeline. The architecture is appropriate for a single-tenant, single-node deployment serving one operational site with up to ~50 concurrent users and moderate telemetry frequency (< 10 ingest calls/second).

---

## Strengths

| Strength | Detail |
|----------|--------|
| **Contract-first API** | OpenAPI → generated hooks + Zod schemas eliminates client/server drift |
| **Schema-first database** | Drizzle ORM TypeScript schema is the single authoritative DB definition |
| **Real-time by design** | WebSocket co-hosted with REST; no additional infrastructure for live updates |
| **Comprehensive audit trail** | `activity_logs` captures all write operations with actor attribution |
| **Maintenance mode** | Suppresses alarm evaluation during planned downtime without removing rules |
| **Payload format flexibility** | 4 normalisation strategies handle diverse device ecosystems |
| **Alarm deadband** | Prevents alarm flapping on noisy sensors |
| **Structured logging** | pino JSON logs with request correlation IDs |
| **Supply-chain protection** | `minimumReleaseAge: 1440` in workspace config |
| **Expression engine** | Runtime attribute computation via `expr-eval` enables derived metrics |

---

## Risks

| Risk | Severity | Detail |
|------|----------|--------|
| No user authentication | Critical | Profile switcher allows anyone to assume admin role |
| API secrets stored plaintext | High | DB compromise exposes all client secrets |
| No server-side role enforcement | High | UI RBAC bypass possible via direct API calls |
| Single-process WebSocket | Medium | No horizontal scaling without refactor |
| In-memory rate limiter | Medium | Resets on restart; not effective across restarts |
| No automated test suite | High | Regressions caught manually only |
| Open CORS | Medium | Any website can make API calls from a user's browser |
| Synchronous alarm evaluation | Medium | O(N rules) per ingest call; latency grows with rule count |

---

## Technical Debt

| Item | Severity | Description |
|------|----------|-------------|
| No unit or integration tests | High | Zero test coverage; all validation is manual |
| No CI/CD pipeline | High | Deployments are manual; no automated quality gate |
| Plaintext secrets in DB | High | `api_clients.client_secret`, `brokers.mqtt_password` |
| No health check automation | Medium | `GET /api/healthz` exists but no auto-restart on failure |
| `viz_dashboards.widgets` layout in localStorage | Medium | Widget positions not persisted in DB — lost on browser clear |
| No OpenTelemetry | Medium | No distributed traces; debugging production issues is difficult |
| No retry for webhook delivery | Low | Failed webhooks silently discarded |
| Expression engine timeout | Low | Complex expressions can block the event loop |
| `activity_logs` has no retention policy | Low | Table grows unbounded |

See [technical-debt-register.md](technical-debt-register.md) for full register.

---

## Security Concerns

1. **Authentication** — No login system. Full access control bypass possible via profile switching.
2. **Plaintext credentials** — API secrets and MQTT passwords stored unhashed in PostgreSQL.
3. **CORS** — Open; all origins accepted.
4. **SSRF via webhook URLs** — Admin-configured URLs could target internal services.
5. **Server-side role bypass** — Human role headers (`X-Actor-Role`) are not validated by the API.

Full analysis in [docs/security/threat-model.md](../security/threat-model.md).

---

## Scalability Concerns

| Concern | Threshold | Solution Path |
|---------|-----------|--------------|
| WebSocket connections | ~100 concurrent | Redis Pub/Sub + horizontal API |
| Telemetry write throughput | ~500 rows/s | Connection pooling + TimescaleDB |
| Alarm rule evaluation | ~50 rules | Index + caching |
| MQTT broker connections | ~10 | Dedicated worker process |
| Report generation | 50k rows | Streaming CSV response |

---

## Operational Concerns

1. **No metrics endpoint** — Cannot integrate with Prometheus, Grafana, or Datadog without adding one.
2. **No distributed tracing** — Hard to diagnose production latency without OpenTelemetry.
3. **Retention only for telemetry** — `activity_logs`, `alarm_history`, and `broker_events` grow unbounded.
4. **Single-process retention pruner** — If the API server crashes, pruning stops until restart.
5. **No alerting on infrastructure events** — Server-down events are not pushed to any channel.

---

## Maintainability Assessment

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Type safety | Excellent | End-to-end TypeScript, generated schemas |
| Code organisation | Good | Clear monorepo structure, domain-aligned routes |
| Documentation | Good (after this package) | Was previously underdocumented |
| Test coverage | Poor | Zero automated tests |
| Observability | Fair | Structured logs and audit trail; no metrics/traces |
| Complexity | Low-Medium | Ingest pipeline is the most complex path (~200 LoC) |
| Onboarding | Good | Codegen, schema-first approach reduces tribal knowledge |

---

## Cost Optimization Opportunities

1. **Telemetry retention** — Default no-expiry policy allows unlimited growth. Set organisation-wide retention policies early.
2. **Aggregation before storage** — For high-frequency sensors (> 1 Hz), aggregate at the edge or in a pre-storage layer rather than writing every reading.
3. **Database sizing** — Right-size the PostgreSQL plan based on retention policy projections.

---

## Developer Productivity Concerns

1. **Codegen coupling** — Developers must remember to run `pnpm --filter @workspace/api-spec run codegen` after every API spec change.
2. **No test harness** — No way to verify changes without manually testing through the UI.
3. **Large page files** — `Visualization.tsx` (~2,400 LoC) is a maintainability concern; should be split into smaller components.
4. **No storybook** — UI components cannot be developed or tested in isolation.

---

## Roadmap

### Immediate Actions (30 Days)
1. Add proper authentication (Replit Auth or Clerk)
2. Hash API client secrets with bcrypt
3. Add server-side role enforcement on write endpoints
4. Restrict CORS to production domain
5. Add at minimum smoke-test API tests

### Mid-Term Roadmap (90 Days)
1. Add automated CI/CD pipeline (GitHub Actions)
2. Add OpenTelemetry instrumentation
3. Implement retry + dead-letter queue for webhook delivery
4. Add Prometheus metrics endpoint
5. Split `Visualization.tsx` into smaller component files
6. Add retention policies for `activity_logs` and `alarm_history`

### Long-Term Roadmap (180 Days)
1. Multi-node scaling architecture (Redis Pub/Sub for WebSocket, dedicated MQTT worker)
2. TimescaleDB or time-series extension for telemetry at scale
3. Alarm escalation chains
4. Scheduled PDF report generation
5. Device registry and firmware OTA management
6. Formal IEC 62443 gap assessment
