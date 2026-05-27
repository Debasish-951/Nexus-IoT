# Application Architecture

**Confidence: High** — based on implemented source code.

---

## Layered Architecture

```
┌─────────────────────────────────────────────┐
│              Browser / Client               │
├─────────────────────────────────────────────┤
│         Presentation Layer (React SPA)      │
│  Pages → Components → shadcn/ui Primitives  │
├─────────────────────────────────────────────┤
│         State Management Layer              │
│  TanStack Query (server state)              │
│  UserContext (RBAC / session)               │
│  useWsEvents (real-time subscriptions)      │
├─────────────────────────────────────────────┤
│         API Client Layer                    │
│  Generated fetch client + React Query hooks │
│  custom-fetch.ts (actor header injection)   │
├─────────────────────────────────────────────┤
│  ─────────── HTTP / WebSocket ──────────── │
├─────────────────────────────────────────────┤
│         API Layer (Express 5)               │
│  Middleware → Router → Route Handlers       │
├─────────────────────────────────────────────┤
│         Domain Services Layer               │
│  Ingest Pipeline  │  MQTT Subscriber        │
│  Alarm Engine     │  Expression Engine      │
│  Retention Pruner │  WebSocket Broadcaster  │
├─────────────────────────────────────────────┤
│         Data Access Layer                   │
│  Drizzle ORM (typed queries + migrations)   │
├─────────────────────────────────────────────┤
│         PostgreSQL 15                       │
└─────────────────────────────────────────────┘
```

---

## Domain Boundaries

| Domain | Tables | Routes | Pages |
|--------|--------|--------|-------|
| **Assets** | `assets`, `attributes`, `asset_templates` | `/assets`, `/attributes`, `/asset-templates` | Assets, AssetTemplates |
| **Telemetry** | `telemetry` | `/ingest/*`, `/telemetry/*` | Dashboard, LiveFeed, Reports |
| **Alarms** | `alarms`, `alarm_history`, `alarm_rules` | `/alarms/*`, `/alarm-rules/*` | Alarms, AlarmHistory, AlarmRules |
| **Visualization** | `viz_dashboards` | `/viz-dashboards/*` | Visualization |
| **Connectivity** | `brokers`, `broker_events` | `/brokers/*` | Brokers |
| **Security** | `api_clients`, `destinations` | `/api-clients/*`, `/destinations/*` | ApiClients, Destinations |
| **Users** | `users` | `/users/*` | Users |
| **Operations** | `data_retention_policies` | `/system/*` | DataManagement |
| **Audit** | `activity_logs` | `/activity-log` | ActivityLog |

---

## State Management

### Server State — TanStack Query
All server-origin data is managed by TanStack Query. Each generated hook:
- Caches responses by query key
- Refetches on window focus (configurable)
- Invalidates on successful mutations

### Real-Time State — WebSocket
`useWsEvents` maintains a single WebSocket connection per page load. Components subscribe via a custom event emitter pattern. The Visualization page maintains a per-asset `wsSignals` map that triggers widget refetch on receiving a `telemetry` event for the relevant asset.

### UI / Session State — React state + localStorage
- Active user profile persisted in `localStorage` key `iot_current_user`
- RBAC enforcement via `UserContext.can(permission)`
- No global client-side state manager (no Redux, Zustand, etc.)

### Dashboard Layout State — localStorage
Visualization dashboard widget layout and config persisted in `localStorage` key `ws-dashboards-v1`.

---

## Design Patterns

### Role Guard
```tsx
<RoleGuard permission="manage_assets" mode="hide">
  <Button>Add Asset</Button>
</RoleGuard>
```
`mode="hide"` removes the element from DOM. `mode="disable"` renders it grayed out.

### Actor Header Injection
Every mutating API call automatically includes:
```
X-Actor-Name: Plant Administrator
X-Actor-Role: admin
X-Actor-Username: admin
```
These headers are set by `setActorHeaders()` in the generated `custom-fetch.ts` client whenever the active user profile changes.

### Read-Only Banner
Pages where the active role has no write permissions display an amber `ReadOnlyBanner` component at the top.

### Maintenance Mode Guard
When `asset.maintenanceMode = true`, the ingest pipeline writes telemetry but skips alarm rule evaluation. This prevents alarm storms during planned maintenance windows.
