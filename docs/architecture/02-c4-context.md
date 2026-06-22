# C4 Context Diagram

**Confidence: High** — reflects implemented integration points.

---

## Level 1: System Context

```mermaid
C4Context
    title System Context — Integrated Suite

    Person(operator, "Shift Operator", "Monitors live feeds, acknowledges alarms via browser")
    Person(engineer, "Controls Engineer", "Configures assets, brokers, alarm rules")
    Person(admin, "Plant Administrator", "Manages users, API clients, retention policies")

    System(platform, "Integrated Suite", "Industrial IoT data acquisition, alarm management, and analytics platform")

    System_Ext(mqtt_broker, "MQTT Broker", "Eclipse Mosquitto, HiveMQ, Azure IoT Hub, or any MQTT 5 broker")
    System_Ext(rest_devices, "REST Field Devices", "Gateways or edge devices that push JSON payloads over HTTP")
    System_Ext(webhook_receiver, "Webhook Receivers", "External alerting, ticketing, or SCADA systems receiving alarm events")
    System_Ext(nodered, "Node-RED / ETL", "Flow-based integration tool consuming the REST API")

    Rel(operator, platform, "Monitors via dashboard, acknowledges alarms", "HTTPS + WebSocket")
    Rel(engineer, platform, "Configures assets, rules, brokers", "HTTPS")
    Rel(admin, platform, "Manages users and platform settings", "HTTPS")
    Rel(mqtt_broker, platform, "Pushes telemetry", "MQTT 5")
    Rel(rest_devices, platform, "Pushes telemetry payloads", "HTTP POST /api/ingest/payload")
    Rel(platform, webhook_receiver, "Sends alarm trigger/clear events", "HTTP POST")
    Rel(nodered, platform, "Queries assets, attributes, telemetry", "HTTP REST")
```

---

## Key Interactions

| Actor / System | Interaction | Auth Method |
|----------------|------------|-------------|
| Browser Operator | View dashboards, live feed, alarms | UI session (localStorage profile) |
| Controls Engineer | CRUD assets, templates, brokers, rules | UI session + RBAC role check |
| REST Field Device | Push telemetry payload | API Key (`Authorization: Bearer` or `X-API-Key`) |
| MQTT Broker | Publish sensor data to subscribed topics | Credentials in broker config record |
| Webhook Receiver | Receive alarm notifications | Configured per alarm rule (no inbound auth) |
| Node-RED | Call REST endpoints | API Key with appropriate scope |
