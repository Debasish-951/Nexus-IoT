# Sequence Diagrams

**Confidence: High** — based on implemented route and service code.

---

## 1. Telemetry Ingest (HTTP)

```mermaid
sequenceDiagram
    participant Device as Field Device
    participant API as API Server
    participant DB as PostgreSQL
    participant WS as WebSocket Clients
    participant Webhook as Alarm Webhook

    Device->>API: POST /api/ingest/payload {deviceId, data: {...}}
    API->>API: optionalApiKeyAuth() — validate token if present
    API->>API: normalise(body) — detect format, extract metrics
    API->>DB: SELECT asset WHERE identifier = deviceId
    alt Asset not found
        API->>DB: INSERT asset (auto-create)
    end
    API->>DB: SELECT previous telemetry (for rate-of-change)
    API->>DB: INSERT telemetry rows (one per metric)
    API->>DB: UPDATE dynamic attributes (tagName / sourceMetric match)
    API->>API: evaluateRuntimeAttributes() — run expr-eval expressions
    alt Asset NOT in maintenance mode
        API->>DB: SELECT enabled alarm rules
        loop Each rule
            API->>DB: SELECT existing active alarm for rule
            alt Condition met + no active alarm
                API->>DB: INSERT alarm + alarm_history
                API->>Webhook: POST alarm payload (non-blocking, 5s timeout)
            else Condition cleared + active alarm exists
                API->>DB: UPDATE alarm status=cleared
                API->>Webhook: POST clear payload (non-blocking)
            end
        end
    end
    API->>WS: broadcast("telemetry", {assetId, metrics, timestamp})
    API->>WS: broadcast("alarm", {event, severity, ...}) per alarm event
    API-->>Device: 200 {success, recordsWritten, alarmsTriggered}
```

---

## 2. MQTT Telemetry Ingest

```mermaid
sequenceDiagram
    participant Broker as MQTT Broker
    participant MQTT as MQTT Subscriber Service
    participant Ingest as processNormalised()
    participant DB as PostgreSQL
    participant WS as WebSocket Clients

    Note over MQTT: Starts on server boot, reads brokers table
    MQTT->>DB: SELECT brokers WHERE type='mqtt'
    MQTT->>Broker: CONNECT (clientId, username, password)
    Broker-->>MQTT: CONNACK
    MQTT->>WS: broadcast("broker_status", {status: "connected"})
    MQTT->>DB: INSERT broker_event (status=connected)
    MQTT->>Broker: SUBSCRIBE to configured topic

    Broker->>MQTT: PUBLISH message on topic
    MQTT->>MQTT: Apply mappingRules (field renames on data object)
    MQTT->>Ingest: processNormalised(normalisedPayload)
    Ingest->>DB: Write telemetry, evaluate alarms
    Ingest->>WS: broadcast("telemetry", ...)
```

---

## 3. Real-Time Dashboard Update

```mermaid
sequenceDiagram
    participant SPA as IoT Platform SPA
    participant WS as WebSocket /api/ws
    participant API as API Server

    SPA->>WS: Connect (on component mount)
    WS-->>SPA: {"type": "connected"}

    Note over SPA: useWsEvents registers "telemetry" listener

    API->>WS: broadcast("telemetry", {assetId: "X", metrics: {...}})
    WS-->>SPA: {"type": "telemetry", data: {assetId: "X", ...}}
    SPA->>SPA: wsSignals.set("X", signal+1)
    SPA->>API: GET /api/telemetry/X (React Query refetch triggered by signal)
    API-->>SPA: Latest telemetry rows
    SPA->>SPA: Re-render WidgetCard with new data + "● LIVE" badge
```

---

## 4. Alarm Acknowledge Flow

```mermaid
sequenceDiagram
    participant Operator as Operator (Browser)
    participant SPA as IoT Platform SPA
    participant API as API Server
    participant DB as PostgreSQL

    Operator->>SPA: Click "Acknowledge" on alarm
    SPA->>API: POST /api/alarms/:id/acknowledge\n  Headers: X-Actor-Name, X-Actor-Role, X-Actor-Username
    API->>DB: UPDATE alarms SET status='acknowledged', acknowledgedAt=NOW()
    API->>DB: INSERT activity_logs (action="alarm_acknowledged", category="alarm")
    API-->>SPA: 200 {success: true}
    SPA->>SPA: Invalidate alarms query → refetch
    SPA->>Operator: Alarm moves to acknowledged state
```

---

## 5. API Client Authentication

```mermaid
sequenceDiagram
    participant Client as External Client (Node-RED etc.)
    participant MW as apiKeyAuth Middleware
    participant DB as PostgreSQL
    participant Route as Route Handler

    Client->>MW: GET /api/assets\n  Authorization: Bearer <secret>
    MW->>DB: SELECT api_client WHERE client_secret = secret
    alt Not found
        MW-->>Client: 401 Invalid API credentials
    else Found
        MW->>MW: Check status (active?)
        MW->>MW: Check expiresAt
        MW->>MW: Check allowedIps (if configured)
        MW->>MW: Check scope (if requiredScope set)
        MW->>MW: isRateLimited() — in-memory 120 RPM window
        MW->>DB: UPDATE lastUsedAt, totalRequests++ (fire-and-forget)
        MW->>Route: next() — req.apiClient set
        Route-->>Client: 200 response
    end
```

---

## 6. User Profile Switch (RBAC)

```mermaid
sequenceDiagram
    participant User as User
    participant SPA as IoT Platform SPA
    participant Query as TanStack Query
    participant API as API Server

    User->>SPA: Select "Operator" profile from dropdown
    SPA->>SPA: UserContext.setCurrentUser({role: "operator", ...})
    SPA->>SPA: localStorage.setItem("iot_current_user", ...)
    SPA->>SPA: setActorHeaders("Mike Wilson", "operator", "mwilson")
    Note over SPA: Future API calls include X-Actor-* headers
    SPA->>SPA: RoleGuard re-evaluates — hides manage_assets elements
    SPA->>SPA: ReadOnlyBanner shown on restricted pages
    User->>SPA: Attempts write action (buttons are hidden/disabled)
```
