# C4 Component Diagram

**Confidence: High** — reflects actual file and module structure.

---

## Level 3: API Server Components

```mermaid
C4Component
    title API Server — Component Diagram

    Container_Boundary(api, "API Server") {
        Component(router, "Route Index", "routes/index.ts", "Mounts all sub-routers under /api")
        Component(ingest, "Ingest Pipeline", "routes/ingest.ts", "Normalises payloads, writes telemetry, evaluates expressions and alarms, broadcasts WS events")
        Component(assets_r, "Assets Router", "routes/assets.ts", "CRUD for asset hierarchy, attribute management, template application, health score")
        Component(alarms_r, "Alarms Router", "routes/alarms.ts + alarm_rules.ts", "Alarm listing, acknowledge, alarm rule CRUD, webhook test")
        Component(system_r, "System Router", "routes/system.ts", "Storage stats, aggregation, retention policy CRUD + pruning")
        Component(dash_r, "Dashboard Router", "routes/dashboard.ts + viz_dashboards.ts", "Stat cards, recent telemetry, alarm stats, viz dashboard CRUD")
        Component(auth_mw, "API Key Auth", "middleware/apiKeyAuth.ts", "Validates Bearer/X-API-Key, checks status/expiry/IP/scope, rate-limits at 120 RPM")
        Component(ws_bcast, "WebSocket Broadcaster", "lib/ws-broadcast.ts", "Maintains WSS, broadcasts typed events to all open connections")
        Component(mqtt_svc, "MQTT Subscriber", "services/mqtt.ts", "Manages broker connections, applies mapping rules, calls processNormalised")
        Component(logger, "Logger", "lib/logger.ts", "Pino structured logger singleton")
    }

    Rel(router, ingest, "Mounts /ingest/*")
    Rel(router, assets_r, "Mounts /assets/*, /attributes/*, /asset-templates/*")
    Rel(router, alarms_r, "Mounts /alarms/*, /alarm-rules/*")
    Rel(router, system_r, "Mounts /system/*")
    Rel(router, dash_r, "Mounts /dashboard/*, /viz-dashboards/*")
    Rel(ingest, ws_bcast, "broadcast(telemetry | alarm)")
    Rel(ingest, auth_mw, "optionalApiKeyAuth('ingest:write')")
    Rel(mqtt_svc, ingest, "processNormalised()")
    Rel(mqtt_svc, ws_bcast, "broadcast(broker_status)")
```

---

## Level 3: Frontend Components

```mermaid
C4Component
    title IoT Platform SPA — Component Diagram

    Container_Boundary(spa, "IoT Platform SPA") {
        Component(app, "App Router", "App.tsx", "React Router DOM v6 route definitions")
        Component(layout, "Layout", "components/Layout.tsx", "Navigation sidebar, notification bell, broker status bar")
        Component(user_ctx, "UserContext", "contexts/UserContext.tsx", "Active role profile, permission checker, actor header setter")
        Component(ws_hook, "useWsEvents", "hooks/useWsEvents.ts", "WebSocket connection lifecycle, event dispatch to subscribers")
        Component(pages, "Page Components", "pages/*.tsx", "Dashboard, Assets, Alarms, Visualization, Live Feed, Reports, etc.")
        Component(query_hooks, "API Hooks", "@workspace/api-client-react", "Generated TanStack Query hooks for all endpoints")
        Component(ui_lib, "UI Library", "components/ui/*.tsx", "shadcn/ui component wrappers (Button, Dialog, Table, etc.)")
        Component(role_guard, "RoleGuard", "components/RoleGuard.tsx", "Hides or disables elements based on active user permissions")
        Component(alarm_toast, "AlarmToastListener", "components/AlarmToastListener.tsx", "Subscribes to WS alarm events, renders sonner toast notifications")
    }

    Rel(app, layout, "Wraps all routes")
    Rel(layout, user_ctx, "Reads active user + can()")
    Rel(layout, ws_hook, "Provides WS event subscription")
    Rel(pages, query_hooks, "Data fetching and mutations")
    Rel(pages, role_guard, "Wraps write actions")
    Rel(pages, ui_lib, "Renders UI primitives")
    Rel(alarm_toast, ws_hook, "Subscribes to alarm events")
```

---

## Ingest Pipeline — Internal Flow

```mermaid
flowchart TD
    A[HTTP POST /api/ingest/payload] --> B{Has deviceId?}
    B -- No --> ERR[400 Bad Request]
    B -- Yes --> C[normalise payload]
    C --> D{Format detected?}
    D -- nested-data --> E[Extract data object]
    D -- nested-metrics --> F[Extract metrics object]
    D -- flat/nested-root --> G[Extract + dot-flatten root fields]
    D -- unknown --> H[Empty metrics]
    E & F & G --> I[Lookup asset by identifier]
    I --> J{Asset found?}
    J -- No --> K[Auto-create asset]
    J -- Yes --> L{In maintenance?}
    K --> M[Write telemetry rows]
    L -- No --> M
    L -- Yes --> M
    M --> N[Update dynamic attributes]
    N --> O[Evaluate runtime expressions]
    O --> P{In maintenance?}
    P -- No --> Q[Evaluate alarm rules]
    P -- Yes --> R[Skip alarm evaluation]
    Q --> S[Dispatch webhooks non-blocking]
    R & S --> T[broadcast telemetry WS event]
    T --> U[200 OK response]
```
