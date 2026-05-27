# Quality Attributes

**Confidence: Medium** — targets derived from implementation patterns; measured values require load testing.

---

## Availability

| Attribute | Target | Current State |
|-----------|--------|--------------|
| API uptime | 99.5% (single-node) | No health check endpoint autorecovery; relies on Replit workflow restart |
| MQTT reconnect | Automatic on broker disconnect | Implemented via `mqtt` package reconnect logic |
| WebSocket reconnect | Client-side reconnect on close | `useWsEvents` reconnects on disconnect event |

**Gap:** No health check endpoint with automatic restart integration. `GET /api/healthz` exists but is not wired to any orchestration.

---

## Reliability

| Attribute | Target | Implementation |
|-----------|--------|---------------|
| Telemetry write atomicity | No partial batch writes | `db.insert().values(records)` bulk insert — all or nothing |
| Alarm evaluation consistency | No double-trigger | Checks for existing active alarm before inserting |
| Webhook delivery | Best-effort, non-blocking | `AbortSignal.timeout(5000)`, silent failure on error |
| Data retention | Rows deleted per policy | Hourly pruning, `rowsPruned` counter tracked |

**Gap:** Webhook delivery has no retry mechanism. Failed webhooks are silently discarded.

---

## Performance

| Operation | Target | Notes |
|-----------|--------|-------|
| Single telemetry ingest | < 200 ms p95 | Synchronous alarm evaluation adds ~50–150 ms per rule |
| Dashboard page load | < 3 s | Multiple parallel React Query requests; no server-side rendering |
| Telemetry query (1,000 rows) | < 100 ms | Covered by composite index `idx_telemetry_asset_metric_ts` |
| WebSocket event delivery | < 100 ms from ingest | In-process broadcast after DB write |
| CSV export (50,000 rows) | < 10 s | Memory-buffered, single query |

**Gap:** Alarm rule evaluation is O(N) per ingest where N = number of enabled rules. With many rules across many assets, this can add significant latency per ingest.

---

## Scalability

| Dimension | Current Limit | Scaling Path |
|-----------|--------------|-------------|
| Concurrent WebSocket clients | ~100 (single process) | Redis Pub/Sub + horizontal API instances |
| Telemetry write throughput | ~500 rows/s (single PG node) | Connection pooling, time-series extension (TimescaleDB) |
| Alarm rules | ~50 rules (linear scan) | Index on `asset_id + enabled` + rule caching |
| Assets | Unlimited (tree structure) | No known hard limit |
| MQTT brokers | Multiple (sequential startup) | Memory-bound; each adds a TCP connection |

---

## Maintainability

| Attribute | Implementation |
|-----------|---------------|
| Type safety | End-to-end TypeScript with Zod validation on API boundaries |
| Contract-first API | OpenAPI spec → generated client hooks + Zod schemas |
| Schema-first DB | Drizzle ORM schema as single source of truth |
| Structured logging | Pino JSON logs with request correlation |
| Code coverage | No automated test suite — manual testing only (gap) |

---

## Operability

| Attribute | Implementation |
|-----------|---------------|
| Logging | pino-http logs every request; `logger.info/warn/error` in services |
| Audit trail | Activity log table captures all write operations with actor |
| Storage observability | `GET /api/system/storage` provides per-table and per-asset row counts |
| Manual pruning | `POST /api/system/retention/run` triggers on-demand cleanup |
| Broker connectivity | `broker_events` table provides immutable connection history |

**Gap:** No metrics endpoint (Prometheus / OpenTelemetry). No distributed tracing.
