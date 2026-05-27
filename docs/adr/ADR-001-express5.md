# ADR-001: Use Express 5 as the API Framework

**Status:** Accepted  
**Date:** 2025-04-27  
**Confidence:** High

---

## Context

The platform requires an HTTP API server that handles REST endpoints, serves as a WebSocket host, and processes high-frequency telemetry ingest. The Node.js ecosystem offers several mature frameworks.

---

## Decision

Use **Express 5** (currently in release candidate / stable) as the API framework.

---

## Alternatives Considered

| Framework | Reason Not Chosen |
|-----------|------------------|
| Express 4 | Express 5 ships native async error propagation — no need for `express-async-handler` wrappers |
| Fastify | Heavier abstraction; plugin-based model adds complexity for this use case |
| Hono | Less ecosystem maturity; fewer Replit examples |
| Next.js API routes | Overkill; not suitable for WebSocket co-hosting |
| tRPC | Requires client-side adoption; breaks the OpenAPI-first codegen approach |

---

## Tradeoffs

| Pro | Con |
|-----|-----|
| Minimal overhead | No built-in validation |
| Native async/await in Express 5 | Async error handling pattern requires explicit `return` |
| Wide ecosystem | Lacks built-in request schema validation |
| WebSocket co-hosting via `http.createServer(app)` | Single-process; needs external broker for multi-node |

---

## Consequences

- All async route handlers typed as `Promise<void>`
- Pattern: `res.status(200).json(data); return;` used consistently
- Wildcard routes use Express 5 syntax: `/{*splat}`
- Error boundaries must be explicit — uncaught async errors will propagate to Express 5's default error handler
