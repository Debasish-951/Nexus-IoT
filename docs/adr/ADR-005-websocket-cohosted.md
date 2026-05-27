# ADR-005: Co-Host WebSocket Server with REST API

**Status:** Accepted  
**Date:** 2025-04-27  
**Confidence:** High

---

## Context

The platform requires real-time push delivery of telemetry events and alarm notifications to connected browser clients. Options include a dedicated message broker, server-sent events, or WebSocket.

---

## Decision

Co-host a **WebSocket server** (`ws` package) on the same `http.Server` instance as the Express REST API at path `/api/ws`.

---

## Alternatives Considered

| Approach | Reason Not Chosen |
|----------|------------------|
| Redis Pub/Sub | Adds Redis dependency; overkill for single-node |
| Socket.IO | Heavier abstraction; polling fallback not needed on modern browsers |
| Server-Sent Events (SSE) | Unidirectional only; WebSocket is more flexible for future bidirectional use |
| Separate WebSocket server port | Complicates reverse proxy config; requires separate path routing |
| Kafka / NATS | Over-engineered for single-node deployment target |

---

## Tradeoffs

| Pro | Con |
|-----|-----|
| No additional infrastructure | State is in-process only — multi-node requires refactor |
| Single port/proxy config | In-memory broadcast resets on restart |
| Minimal latency (in-process broadcast) | All clients receive all events (no topic filtering at server) |
| Simple client implementation (`useWsEvents` hook) | No message persistence — missed events on reconnect are lost |

---

## Consequences

- WebSocket server initialised at `initWebSocketServer(server)` in `src/index.ts`
- `broadcast(type, data)` called from ingest pipeline and MQTT service
- Client-side filtering is by `type` field; no server-side topic routing
- All connected clients receive all `telemetry`, `alarm`, and `broker_status` events
- For multi-node scaling: replace with Redis Pub/Sub pattern where each API node publishes to Redis and subscribes to relay to its local WebSocket clients

---

## WebSocket Message Protocol

```typescript
// Server → Client message envelope
interface WsMessage {
  type: "connected" | "telemetry" | "alarm" | "broker_status";
  data?: unknown;
}
```

No client → server messages are currently processed.
