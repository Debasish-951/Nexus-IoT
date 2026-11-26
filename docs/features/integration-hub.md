# Integration Hub

Integration Hub covers how other systems exchange data with the platform: gateways that send telemetry, third parties that read and write through the API, receivers of events (Destinations), and sources the platform polls itself (pull connectors).

Everything described here was added without changing what already existed:

- The original pages (API Client, Destinations, Connections, Integration Guide) are unchanged, and each is the first tab of its screen.
- The `/ingest/*` and `/export/*` routes behave as before.
- Existing destinations stay in **direct** mode.
- Every new database column is nullable or has a default that keeps the old behaviour.

`VITE_CLASSIC_INTEGRATION_HUB=true` hides the new tabs. The server features keep running, only the screens are hidden.

## Screens

| Screen | Tabs | What the new tabs do |
|---|---|---|
| API Client | Clients · **Access** · **Usage** · **Alerts** | Permission builder (resource × read/write), templates, asset limit, row and time-range limits, sandbox, rotation with a grace period, OAuth sample · per-client traffic, errors, endpoints, refusals, last 100 requests · alerts |
| Destinations | Destinations · **Delivery** · **Delivery log** · **Alerts** | Direct or queued delivery, event subscriptions, project filter, attempts, HMAC signing, test event · every queued delivery with status, answer, payload and Resend |
| Connections | Overview · **Pull connectors** · **Alerts** | REST, PostgreSQL and Modbus TCP connectors with Test (dry run), Run now and on/off. OPC UA is saved but does not run yet |
| Integration Guide | Guide · **API v1 reference** · **Webhook signatures** | Endpoint list read live from `/api/v1/openapi.json`, with a download · verification code for Node.js and Python, plus a checker |

## Events and delivery

Business events go to an outbox, the `integration_events` table, through `emitIntegrationEvent` in `lib/integration/events.ts`. The event types are:

- `alarm.triggered`
- `alarm.cleared`
- `alarm.acknowledged`
- `asset.created`
- `asset.updated`
- `asset.deleted`
- `asset.maintenance`
- `asset.attributes`
- `connector.error`

The function never throws, so an outbox problem cannot break ingest or an edit.

How each mode delivers:

- **Direct** is the original behaviour. `forwardToDestinations` sends alarm raised/cleared once, straight from ingest. Destinations in queued mode are skipped there, so nothing is sent twice.
- **Queued** adds a `destination_deliveries` row per subscribed destination. `services/delivery-worker.ts` runs every 5 s and sends it.
  - Each request times out after 10 s.
  - On failure it retries after 30 s, 2 min, 10 min, 30 min, 2 h and 6 h, then marks the delivery `dead` after `max_attempts` (default 6).
  - Resend puts a delivery back to `pending`.
  - A disabled destination's deliveries wait without spending attempts.
- Subscriptions: `alarm` (the original value) matches every `alarm.*` event, a group name matches its group, and `*` matches everything.
- Signing (either mode, opt-in) adds two headers:
  - `X-Nexus-Timestamp`
  - `X-Nexus-Signature: sha256=HMAC_SHA256(secret, timestamp + "." + rawBody)`

  Queued sends also carry `X-Nexus-Event` and `X-Nexus-Delivery`. The delivery id stays the same across retries, so a receiver can use it to drop duplicates.

## Third-party API (`/api/v1`)

| Route | Scope |
|---|---|
| `GET /v1/assets`, `GET /v1/assets/:id` | `read:assets` |
| `GET /v1/assets/:id/telemetry` | `read:telemetry` |
| `GET /v1/alarms` | `read:alarms` |
| `GET /v1/alarm-rules` | `read:alarm-rules` |
| `GET /v1/events?after=&types=` | `read:events` (poll instead of receiving webhooks) |
| `POST /v1/alarms/:id/acknowledge` | `write:alarms` |
| `PUT /v1/assets/:id/attributes` `{ values: { name: value } }` | `write:attributes` (calculated attributes refused) |
| `POST /v1/assets/:id/maintenance` `{ enabled, note }` | `write:maintenance` |
| `POST /oauth/token` (client credentials) | none; returns a `nxat_…` token valid `OAUTH_TOKEN_TTL_SEC` (default 3600) |
| `GET /v1/openapi.json`, `GET /v1/event-types` | public |

Every route applies:

- the client's project;
- its asset limit (`allowed_asset_ids`, children included);
- `max_rows` and `max_range_days`. The same limits also apply to `/export/*` when set.

Writes also:

- accept `Idempotency-Key`, with answers replayed for 24 h;
- are audited with the client as the actor;
- emit events.

A **sandbox** client gets the answer a write would give and nothing changes. Ingest is answered by the `/validate` dry run, and a batch is counted.

The v1 contract lives in `lib/integration/v1-openapi.ts`, separate from `lib/api-spec/openapi.yaml`. That file is the server ↔ SPA contract, and changes to the SPA must not change what third parties were given.

## Credentials

The lookup is `findClientBySecret` in `lib/integration/client-auth.ts`. It accepts three forms:

1. An OAuth token (`nxat_` prefix). Only these touch `api_access_tokens`.
2. The current secret. This is unchanged.
3. The previous secret while `previous_secret_expires_at` is in the future. This is the rotation grace period.

Rotation and access tokens:

- Rotating from the Access tab revokes the client's access tokens.
- The original Rotate button is still an immediate cut-over, and it also ends any grace period.
- An empty scope list still means full access. Set `API_KEY_EMPTY_SCOPES_DENY=true` to retire that meaning once no such keys remain; the Alerts tab lists them.

Every request made with a credential is buffered in memory and written to `api_request_log` every 5 s, with ids and URL tokens removed from the path. The Usage tab and the alerts read it.

## Pull connectors

`services/connectors.ts` checks every 5 s and runs enabled connectors whose interval has passed. Readings go through `processNormalised`, so attributes, calculated values and alarms apply, and the connector's project limits which assets it may write to.

| Type | How it reads | Notes |
|---|---|---|
| REST | `safeFetch`; records at a dot path; device id from a field or fixed | Private addresses follow `ALLOW_PRIVATE_WEBHOOK_TARGETS` |
| PostgreSQL | One `SELECT`/`WITH` in a `READ ONLY` transaction with a 15 s timeout; `$1` = last watermark | Use a read-only database user |
| Modbus TCP | Function 3/4; uint16, int16, uint32, int32, float32; word order; scale | Plant-network addresses are allowed; loopback and link-local are refused |
| OPC UA | Saved, **not run** | Needs an OPC UA client library; use a gateway meanwhile |

A connector that starts failing emits `connector.error` once, not on every run.

## Retention (hourly)

| Data | Kept for |
|---|---|
| Delivered and dead deliveries, and their events | `INTEGRATION_LOG_RETENTION_DAYS` (default 30). An event with a pending delivery is kept. |
| `api_request_log` | `API_REQUEST_LOG_RETENTION_DAYS` (default 30) |
| Expired OAuth tokens | Removed |
| Idempotency keys | 24 hours |

## Files

- Server:
  - `lib/integration/` (events, signing, client-auth, idempotency, sandbox, v1-openapi)
  - `services/delivery-worker.ts`, `services/connectors.ts`
  - `routes/integration.ts`, `routes/v1.ts`
  - Tests: `tests/integration-hub.test.ts`
- Schema: `lib/db/src/schema/integrations.ts`, plus new columns on `api_clients` and `destinations`.
- UI: `features/integrations/` (ApiClientsHub, DestinationsHub, ConnectionsHub, GuideHub, shared).
