/**
 * OpenAPI 3.1 description of the third-party API (/api/v1 and /api/oauth/token),
 * served at GET /api/v1/openapi.json and rendered in the Integration Guide.
 *
 * Kept separate from lib/api-spec/openapi.yaml on purpose: that file is the
 * contract between this server and its own SPA (and drives codegen); this one
 * is what is handed to third parties, and must not change when the SPA does.
 */

const idParam = (name: string, what: string) => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" }, description: what });
const q = (name: string, description: string, type = "string") => ({ name, in: "query", required: false, schema: { type }, description });
const idem = { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 200 }, description: "Send the same value when retrying; the first answer is replayed for 24 hours." };
const ok = (description: string) => ({ description, content: { "application/json": { schema: { type: "object" } } } });
const errors = {
  "401": { description: "Missing, invalid, expired or revoked credential" },
  "403": { description: "Scope missing, IP not allowed, or asset outside the client's project / asset limit" },
  "429": { description: "Rate limit reached; see Retry-After" },
};

export const V1_OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Integration API",
    version: "1.0.0",
    description:
      "Read and write API for third-party systems (SCADA, CMMS, MES, BI). Authenticate with an API client's secret " +
      "(X-API-Key or Authorization: Bearer) or with a short-lived token from /oauth/token. Each route names the scope it needs. " +
      "A client assigned to a project, or limited to assets, only ever sees and changes those assets. " +
      "Sandbox clients get the answer a write would give, and nothing is changed.",
  },
  servers: [{ url: "/api" }],
  components: {
    securitySchemes: {
      apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
      bearer: { type: "http", scheme: "bearer" },
      oauth: { type: "oauth2", flows: { clientCredentials: { tokenUrl: "/api/oauth/token", scopes: {} } } },
    },
  },
  security: [{ apiKey: [] }, { bearer: [] }, { oauth: [] }],
  paths: {
    "/oauth/token": {
      post: {
        summary: "Get an access token (client credentials)",
        security: [],
        requestBody: { content: {
          "application/x-www-form-urlencoded": { schema: { type: "object", required: ["grant_type", "client_id", "client_secret"], properties: {
            grant_type: { type: "string", enum: ["client_credentials"] }, client_id: { type: "string" }, client_secret: { type: "string" } } } },
          "application/json": { schema: { type: "object" } },
        } },
        responses: { "200": ok("{ access_token, token_type: Bearer, expires_in, scope }"), "400": { description: "Bad request" }, "401": { description: "invalid_client" } },
      },
    },
    "/v1/assets": { get: { summary: "List assets", "x-scope": "read:assets", parameters: [q("parentId", "Only children of this asset"), q("limit", "Rows (default 1000)", "integer")], responses: { "200": ok("{ count, total, data[] }"), ...errors } } },
    "/v1/assets/{id}": { get: { summary: "One asset with its attributes", "x-scope": "read:assets", parameters: [idParam("id", "Asset id")], responses: { "200": ok("Asset"), "404": { description: "Not found" }, ...errors } } },
    "/v1/assets/{id}/telemetry": { get: { summary: "Telemetry for an asset, newest first", "x-scope": "read:telemetry",
      parameters: [idParam("id", "Asset id"), q("metric", "One metric"), q("from", "ISO time (default 24 h ago)"), q("to", "ISO time (default now)"), q("limit", "Rows (default 1000, max 10000)", "integer")],
      responses: { "200": ok("{ assetId, from, to, count, data[] }"), ...errors } } },
    "/v1/alarms": { get: { summary: "Alarms, newest first", "x-scope": "read:alarms", parameters: [q("status", "active | acknowledged | cleared"), q("assetId", "One asset"), q("limit", "Rows (default 500)", "integer")], responses: { "200": ok("{ count, data[] }"), ...errors } } },
    "/v1/alarm-rules": { get: { summary: "Alarm rules", "x-scope": "read:alarm-rules", responses: { "200": ok("{ count, data[] }"), ...errors } } },
    "/v1/events": { get: { summary: "Event feed (poll instead of webhooks)", "x-scope": "read:events",
      parameters: [q("after", "Last event id you received (0 to start)", "integer"), q("types", "Comma-separated event types"), q("limit", "Rows (default 100, max 1000)", "integer")],
      responses: { "200": ok("{ count, next, data[] } — pass `next` as `after` on the next call"), ...errors } } },
    "/v1/event-types": { get: { summary: "Event types you can subscribe to or filter on", security: [], responses: { "200": ok("[{ id, group, label }]") } } },
    "/v1/alarms/{id}/acknowledge": { post: { summary: "Acknowledge an active alarm", "x-scope": "write:alarms",
      parameters: [idParam("id", "Alarm id"), idem], requestBody: { content: { "application/json": { schema: { type: "object", properties: { note: { type: "string", maxLength: 500 } } } } } },
      responses: { "200": ok("The alarm"), "409": { description: "Alarm is not active" }, ...errors } } },
    "/v1/assets/{id}/attributes": { put: { summary: "Set attribute values by name", "x-scope": "write:attributes",
      parameters: [idParam("id", "Asset id"), idem], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["values"], properties: { values: { type: "object", additionalProperties: { type: ["string", "number", "boolean", "null"] } } } }, example: { values: { Setpoint: 72.5, Shift: "B" } } } } },
      responses: { "200": ok("{ assetId, updated, at }"), "400": { description: "Unknown or calculated attribute" }, ...errors } } },
    "/v1/assets/{id}/maintenance": { post: { summary: "Turn maintenance mode on or off (alarms are not evaluated while on)", "x-scope": "write:maintenance",
      parameters: [idParam("id", "Asset id"), idem], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" }, note: { type: "string" } } } } } },
      responses: { "200": ok("Maintenance state"), ...errors } } },
  },
  "x-webhooks": {
    description:
      "Destinations in queued mode receive POST { id, event, eventId, attempt, createdAt, projectId, assetId, data } with headers " +
      "X-Nexus-Event, X-Nexus-Delivery and, when signing is on, X-Nexus-Timestamp and X-Nexus-Signature = sha256=HMAC_SHA256(secret, timestamp + '.' + rawBody). " +
      "Answer 2xx within 10 seconds. Failures are retried after 30 s, 2 min, 10 min, 30 min, 2 h and 6 h. Use `id` to drop duplicates.",
  },
} as const;
