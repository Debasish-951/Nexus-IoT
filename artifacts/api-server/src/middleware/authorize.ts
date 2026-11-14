import type { Request, Response, NextFunction } from "express";
import { authConfig } from "../lib/auth-config";
import { hasModuleAccess, hasPermission, MODULES, type EffectiveAccess } from "../lib/rbac";
import { recordSecurityEvent } from "../lib/security-log";

/**
 * Deny-by-default route authorisation.
 *
 * Applied once in app.ts rather than route-by-route, so no existing router file
 * changes and no route can be added later that silently forgets its guard —
 * anything not in this table is denied to human callers.
 *
 * Each rule declares:
 *   - `public`      no credential needed (login, activation, health, ingest)
 *   - `permission`  a verb from ROLE_PERMISSIONS (the existing frontend vocabulary)
 *   - `module`      a module key + R/W/D level from the Access Control matrix
 *   - `self`        authenticated, any role (e.g. /auth/session)
 *
 * When both `permission` and `module` are present, BOTH must pass. That is what
 * makes a per-user override meaningful: an engineer has `manage_assets` by role,
 * but an admin can still switch off their `assets.w` circle and the API will
 * refuse the write.
 */

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Level = "read" | "write" | "delete";

interface Rule {
  /** Express-style path pattern, matched against req.path. `:x` matches one segment. */
  path: string;
  methods: Method[] | "*";
  public?: boolean;
  /** Authenticated, but no specific grant required. */
  self?: boolean;
  permission?: string;
  module?: string;
  /** Any one of these modules is enough (used instead of `module`). */
  anyModule?: string[];
  level?: Level;
  /** Route also accepts an API key (machine caller) — apiKeyAuth does the checking. */
  allowApiKey?: boolean;
}

const READ: Method[] = ["GET"];
const WRITE: Method[] = ["POST", "PUT", "PATCH"];
const ALL_WRITE: Method[] = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * Ordered: the first matching rule wins, so specific paths precede their
 * wildcard parents.
 */
const ROUTE_RULES: Rule[] = [
  // ── Public: authentication & account recovery ──────────────────────────────
  { path: "/auth/login",              methods: ["POST"], public: true },
  { path: "/auth/activate",           methods: ["POST"], public: true },
  { path: "/auth/activation/:token",  methods: READ,     public: true },
  { path: "/auth/forgot-password",    methods: ["POST"], public: true },
  { path: "/auth/reset/:token",       methods: READ,     public: true },
  { path: "/auth/reset-password",     methods: ["POST"], public: true },
  { path: "/auth/password-policy",    methods: READ,     public: true },
  // Returns 401 rather than 403 when unauthenticated — it is how the SPA asks
  // "am I logged in?", so it must be reachable without a session.
  { path: "/auth/session",            methods: READ,     public: true },
  { path: "/auth/logout",             methods: ["POST"], self: true },
  { path: "/auth/change-password",    methods: ["POST"], self: true },

  // ── Public: infrastructure ─────────────────────────────────────────────────
  { path: "/healthz",       methods: READ, public: true },
  { path: "/readyz",        methods: READ, public: true },
  { path: "/export/health", methods: READ, public: true },
  { path: "/export/schema", methods: READ, public: true },

  // ── Machine ingest ─────────────────────────────────────────────────────────
  //
  // These were public. They now require a valid `ingest:write` API key, checked
  // by apiKeyAuth on the route itself — that is what makes the per-client load
  // figures on Broker Management trustworthy, since telemetry can no longer be
  // posted anonymously.
  //
  // `allowApiKey` (not `public`) means: a machine caller passes here and the
  // route's own apiKeyAuth does the real work; a browser session with the
  // `brokers` module may also call them, which is what the Payload Simulator
  // page needs.
  { path: "/ingest/payload",             methods: ["POST"], module: "brokers", allowApiKey: true },
  { path: "/ingest/batch",               methods: ["POST"], module: "brokers", allowApiKey: true },
  { path: "/ingest/validate",            methods: ["POST"], module: "brokers", allowApiKey: true },
  { path: "/ingest/register-device",     methods: ["POST"], module: "brokers", allowApiKey: true },
  // Per-client endpoints: /api/ingest/k/<clientId>/{payload,batch,validate}
  { path: "/ingest/k/:clientId/:action", methods: ["POST"], module: "brokers", allowApiKey: true },
  // Copy-and-paste endpoints: /api/ingest/e/<token>/{payload,batch,validate}.
  // The token IS the credential; `attachApiClient` resolves it and refuses any
  // client that is not ingest-scoped, so this path cannot carry a super-key.
  { path: "/ingest/e/:token/:action", methods: ["POST"], module: "brokers", allowApiKey: true },
  // Export endpoints enforce their own scopes via apiKeyAuth; a signed-in human
  // with the matching module grant may also call them.
  { path: "/export/:resource", methods: READ, module: "explorer", level: "read", allowApiKey: true },

  // ── Seen-devices (device discovery, part of ingest tooling) ────────────────
  { path: "/ingest/seen-devices",             methods: READ,       module: "assets", level: "read" },
  { path: "/ingest/seen-devices/prune",       methods: ["POST"],   permission: "manage_assets", module: "assets", level: "delete" },
  { path: "/ingest/seen-devices/:deviceId",   methods: ["DELETE"], permission: "manage_assets", module: "assets", level: "delete" },

  // ── Dashboard ──────────────────────────────────────────────────────────────
  { path: "/dashboard/:metric", methods: READ, module: "dashboard", level: "read" },

  // Tags the Combined Value widget can add together.
  { path: "/viz-tags", methods: READ, module: "visualization", level: "read" },

  // ── Assets, attributes, templates ──────────────────────────────────────────
  { path: "/assets",                      methods: READ,       module: "assets", level: "read" },
  { path: "/assets",                      methods: ["POST"],   permission: "manage_assets", module: "assets", level: "write" },
  { path: "/assets/:id",                  methods: READ,       module: "assets", level: "read" },
  { path: "/assets/:id",                  methods: ["PUT", "PATCH"], permission: "manage_assets", module: "assets", level: "write" },
  { path: "/assets/:id",                  methods: ["DELETE"], permission: "manage_assets", module: "assets", level: "delete" },
  { path: "/assets/:id/health",           methods: READ,       module: "assets", level: "read" },
  { path: "/assets/:id/attributes",       methods: READ,       module: "assets", level: "read" },
  { path: "/assets/:id/attributes",       methods: ["POST"],   permission: "manage_assets", module: "assets", level: "write" },
  { path: "/assets/:id/attributes/bulk",  methods: ["POST"],   permission: "manage_assets", module: "assets", level: "write" },
  { path: "/assets/:id/apply-template",   methods: ["POST"],   permission: "manage_assets", module: "assets", level: "write" },
  { path: "/assets/:id/maintenance",      methods: ["POST"],   permission: "manage_assets", module: "assets", level: "write" },
  { path: "/attributes/:id",              methods: ["PUT", "PATCH"], permission: "manage_assets", module: "assets", level: "write" },
  { path: "/attributes/:id",              methods: ["DELETE"], permission: "manage_assets", module: "assets", level: "delete" },
  { path: "/asset-templates",             methods: READ,       module: "assets", level: "read" },
  { path: "/asset-templates",             methods: WRITE,      permission: "manage_templates", module: "assets", level: "write" },
  { path: "/asset-templates/:id",         methods: READ,       module: "assets", level: "read" },
  { path: "/asset-templates/:id",         methods: ["PUT", "PATCH"], permission: "manage_templates", module: "assets", level: "write" },
  { path: "/asset-templates/:id",         methods: ["DELETE"], permission: "manage_templates", module: "assets", level: "delete" },

  // ── Telemetry ──────────────────────────────────────────────────────────────
  // Dashboards (Visualization, Live Twin) read recent raw telemetry here, so the
  // visualization module is enough. Operators and Viewers have Visualization
  // but not Data Explorer, and their short-range charts were empty. Longer
  // ranges already came through /system/aggregate with the same data. The CSV
  // export stays a Data Explorer feature.
  { path: "/telemetry/:assetId/export",   methods: READ, module: "explorer", level: "read" },
  { path: "/telemetry/:assetId",          methods: READ, anyModule: ["explorer", "visualization"], level: "read" },
  { path: "/telemetry/:assetId/metrics",  methods: READ, anyModule: ["explorer", "visualization"], level: "read" },

  // ── Alarms ─────────────────────────────────────────────────────────────────
  { path: "/alarms",                          methods: READ,     module: "alarms", level: "read" },
  { path: "/alarms/history",                  methods: READ,     module: "alarms", level: "read" },
  //
  // Write rules carry `level: "write"` (or "delete") even on simple modules, where
  // the level makes no difference today. A rule with no level defaults to "read",
  // so if a module ever becomes granular its write routes would otherwise open up
  // to anyone with read access to it.
  { path: "/alarms/:id/acknowledge",          methods: ["POST"], permission: "acknowledge_alarms", module: "alarms", level: "write" },
  { path: "/alarms/history/:id/acknowledge",  methods: ["POST"], permission: "acknowledge_alarms", module: "alarms", level: "write" },
  { path: "/alarm-rules",                     methods: READ,     module: "alarms", level: "read" },
  { path: "/alarm-rules",                     methods: WRITE,    permission: "manage_alarms", module: "alarms", level: "write" },
  { path: "/alarm-rules/:id",                 methods: WRITE,    permission: "manage_alarms", module: "alarms", level: "write" },
  { path: "/alarm-rules/:id",                 methods: ["DELETE"], permission: "manage_alarms", module: "alarms", level: "delete" },
  { path: "/alarm-rules/:id/test-webhook",    methods: ["POST"], permission: "manage_alarms", module: "alarms", level: "write" },

  // ── Brokers & destinations ─────────────────────────────────────────────────
  // Platform-wide rows with no project column: a project-restricted user may read
  // them but not change them (lib/project-access.ts).
  { path: "/brokers",              methods: READ,       module: "brokers" },
  { path: "/brokers",              methods: WRITE,      permission: "manage_brokers", module: "brokers", level: "write" },
  { path: "/brokers/:id",          methods: WRITE,      permission: "manage_brokers", module: "brokers", level: "write" },
  { path: "/brokers/:id",          methods: ["DELETE"], permission: "manage_brokers", module: "brokers", level: "delete" },
  { path: "/brokers/:id/history",  methods: READ,       module: "brokers" },
  { path: "/destinations",         methods: READ,       module: "brokers" },
  { path: "/destinations",         methods: WRITE,      permission: "manage_destinations", module: "brokers", level: "write" },
  { path: "/destinations/:id",     methods: WRITE,      permission: "manage_destinations", module: "brokers", level: "write" },
  { path: "/destinations/:id",     methods: ["DELETE"], permission: "manage_destinations", module: "brokers", level: "delete" },
  { path: "/destinations/:id/test", methods: ["POST"],  permission: "manage_destinations", module: "brokers", level: "write" },

  // ── API clients ────────────────────────────────────────────────────────────
  // Must precede /api-clients/:id so "projects" is not read as an id.
  { path: "/api-clients/projects",     methods: READ,      module: "api_clients" },
  { path: "/api-clients",              methods: READ,      module: "api_clients" },
  { path: "/api-clients",              methods: WRITE,     permission: "manage_api_clients", module: "api_clients", level: "write" },
  { path: "/api-clients/:id",          methods: WRITE,     permission: "manage_api_clients", module: "api_clients", level: "write" },
  { path: "/api-clients/:id",          methods: ["DELETE"], permission: "manage_api_clients", module: "api_clients", level: "delete" },
  { path: "/api-clients/:id/:action",  methods: ["POST"],  permission: "manage_api_clients", module: "api_clients", level: "write" },

  // ── Visualization ──────────────────────────────────────────────────────────
  // Visualization hierarchy + each node's dashboard. `/viz-nodes/import` must
  // precede `/viz-nodes/:id` or "import" is read as a node id — and it is a POST
  // to a collection, so it needs write, not the :id rule's level.
  { path: "/viz-nodes/import",    methods: ["POST"],   module: "visualization", level: "write" },
  { path: "/viz-nodes",           methods: READ,       module: "visualization", level: "read" },
  // Create, update and delete are level "read" here on purpose: whether this user
  // may touch this dashboard depends on who owns it and what was granted, so the
  // route decides using lib/viz-access.ts. A rule here would refuse a Viewer who
  // holds an explicit write grant on one dashboard.
  { path: "/viz-nodes",           methods: ["POST"],   module: "visualization", level: "read" },
  // Super Admin or Company Admin only; enforced in the route, because no permission maps to those roles alone.
  { path: "/viz-nodes/:id/shares",         methods: READ,              module: "visualization", level: "read" },
  { path: "/viz-nodes/:id/shares/:userId", methods: ["PUT", "DELETE"], module: "visualization", level: "read" },
  { path: "/viz-nodes/:id",       methods: ["PUT"],    module: "visualization", level: "read" },
  { path: "/viz-nodes/:id",       methods: ["DELETE"], module: "visualization", level: "read" },

  // 3D plant twins (Live Twin). `/plant-twins/values` must precede `/plant-twins/:id`
  // and is level "read": it is a POST only because the list of readings is long.
  // Change and delete are level "write" here; the route also requires the owner
  // or a Super Admin / Company Admin, because that depends on the row. Delete is
  // not level "delete": roles with read-write Visualization (engineer, developer)
  // must be able to remove a twin they created themselves.
  { path: "/plant-twins/values",  methods: ["POST"],          module: "visualization", level: "read" },
  { path: "/plant-twins",         methods: READ,              module: "visualization", level: "read" },
  { path: "/plant-twins",         methods: ["POST"],          module: "visualization", level: "write" },
  { path: "/plant-twins/:id",     methods: READ,              module: "visualization", level: "read" },
  { path: "/plant-twins/:id",     methods: ["PUT", "DELETE"], module: "visualization", level: "write" },

  // ── Uploads ────────────────────────────────────────────────────────────────
  // `/uploads/:id/content` precedes the collection rules so the download is not
  // read as an id. Delete is a separate level from write: being able to add a
  // file is not the same right as being able to remove someone else's.
  { path: "/uploads/:id/content", methods: READ,       module: "visualization", level: "read" },
  { path: "/uploads",             methods: READ,       module: "visualization", level: "read" },
  { path: "/uploads",             methods: ["POST"],   module: "visualization", level: "write" },
  { path: "/uploads/:id",         methods: ["DELETE"], module: "visualization", level: "delete" },

  // Legacy dashboards, superseded by viz_nodes. Only the list survives, as id and
  // name, because the Access Control editor still reads it; create, update and
  // delete were removed (no owner check, no validation, no live caller).
  { path: "/viz-dashboards",      methods: READ,       module: "visualization", level: "read" },

  // ── Users & security ───────────────────────────────────────────────────────
  { path: "/users",                methods: READ,      permission: "manage_users", module: "users" },
  { path: "/users",                methods: ["POST"],  permission: "manage_users", module: "users", level: "write" },
  { path: "/users/:id",            methods: READ,      permission: "manage_users", module: "users" },
  { path: "/users/:id",            methods: WRITE,     permission: "manage_users", module: "users", level: "write" },
  { path: "/users/:id",            methods: ["DELETE"], permission: "manage_users", module: "users", level: "delete" },
  { path: "/users/:id/:action",    methods: READ,      permission: "manage_users", module: "users" },
  { path: "/users/:id/:action",    methods: ALL_WRITE, permission: "manage_users", module: "users", level: "write" },
  { path: "/security/rbac-catalog", methods: READ,     self: true },
  { path: "/security/:resource",          methods: "*", permission: "manage_security", module: "security" },
  { path: "/security/:resource/:id",      methods: "*", permission: "manage_security", module: "security" },
  { path: "/security/:resource/:id/:sub", methods: "*", permission: "manage_security", module: "security" },

  // ── Reports, analytics, activity log, system ───────────────────────────────
  { path: "/activity-log",         methods: READ,      module: "activity_log" },
  { path: "/system/storage",       methods: READ,      module: "reports" },
  { path: "/system/aggregate",     methods: READ,      module: "reports" },
  { path: "/system/retention",     methods: READ,      module: "reports" },
  { path: "/system/retention",     methods: ["POST"],  permission: "manage_assets", module: "reports", level: "write" },
  { path: "/system/retention/run", methods: ["POST"],  permission: "manage_assets", module: "reports", level: "write" },
  // Data Management operations (routes/data_ops.ts). Reading needs Reports; anything
  // that deletes, restores, changes settings or shows raw SQL needs manage_assets too.
  { path: "/system/storage/all",            methods: READ,     module: "reports" },
  { path: "/system/data-health",            methods: READ,     module: "reports" },
  { path: "/system/data-settings",          methods: READ,     module: "reports" },
  { path: "/system/data-settings",          methods: ["PUT"],  permission: "manage_assets", module: "reports", level: "write" },
  { path: "/system/alerts",                 methods: READ,     module: "reports" },
  { path: "/system/alerts/check",           methods: ["POST"], permission: "manage_assets", module: "reports", level: "write" },
  { path: "/system/alerts/:id/acknowledge", methods: ["POST"], permission: "manage_assets", module: "reports", level: "write" },
  { path: "/system/backups",                methods: READ,     module: "reports" },
  { path: "/system/db-health",              methods: READ,     permission: "manage_assets", module: "reports" },
  { path: "/system/db-health/vacuum",       methods: ["POST"], permission: "manage_assets", module: "reports", level: "write" },
  { path: "/system/holds",                  methods: READ,     module: "reports" },
  { path: "/system/holds",                  methods: ["POST"], permission: "manage_assets", module: "reports", level: "write" },
  { path: "/system/holds/:id/release",      methods: ["POST"], permission: "manage_assets", module: "reports", level: "write" },
  { path: "/system/archives",               methods: READ,     module: "reports" },
  { path: "/system/archives/:id/download",  methods: READ,     permission: "manage_assets", module: "reports" },
  { path: "/system/archives/:id/restore",   methods: ["POST"], permission: "manage_assets", module: "reports", level: "write" },
  { path: "/system/changes",                methods: READ,     module: "reports" },
  { path: "/system/changes/range-preview",  methods: ["POST"], permission: "manage_assets", module: "reports", level: "read" },
  { path: "/system/changes/range-delete",   methods: ["POST"], permission: "manage_assets", module: "reports", level: "delete" },
  { path: "/system/changes/:id/approve",    methods: ["POST"], permission: "manage_assets", module: "reports", level: "delete" },
  { path: "/system/changes/:id/reject",     methods: ["POST"], permission: "manage_assets", module: "reports", level: "write" },
  { path: "/system/retention/runs/:id/report", methods: READ,  module: "reports" },
  // Read-only: an estimate of what a policy would delete. POST only to carry the draft policy.
  { path: "/system/retention/preview", methods: ["POST"], module: "reports", level: "read" },
  { path: "/system/retention/runs", methods: READ,     module: "reports" },
  { path: "/system/retention/:id", methods: WRITE,     permission: "manage_assets", module: "reports", level: "write" },
  { path: "/system/retention/:id", methods: ["DELETE"], permission: "manage_assets", module: "reports", level: "delete" },

  // ── AI copilot ─────────────────────────────────────────────────────────────
  { path: "/ai/chat", methods: ["POST"], module: "explorer", level: "read" },
];

// ── Matching ─────────────────────────────────────────────────────────────────

interface CompiledRule extends Rule { regex: RegExp }

function compile(rule: Rule): CompiledRule {
  const pattern = rule.path
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return { ...rule, regex: new RegExp(`^${pattern}/?$`) };
}

const COMPILED = ROUTE_RULES.map(compile);

/**
 * The only endpoints reachable while `mustChangePassword` is set — enough to
 * see who you are, change the password, and sign out. Nothing else.
 */
const PASSWORD_CHANGE_EXEMPT = /^\/auth\/(session|change-password|logout|password-policy)\/?$/;

function findRule(method: string, path: string): CompiledRule | undefined {
  return COMPILED.find((rule) =>
    rule.regex.test(path) &&
    (rule.methods === "*" || (rule.methods as string[]).includes(method)),
  );
}

/**
 * Precedence:
 *
 *   1. A GRANULAR module (separate read / write / delete) explicitly set for this
 *      user is authoritative for that module: the administrator chose each level,
 *      so switching on `assets.w` for an Operator lets them edit assets. The role
 *      verb is the source of the default, not a ceiling.
 *   2. Everything else needs both the role verb and the module grant. That
 *      includes overridden SIMPLE modules: they have one on/off value, so an
 *      override can only mean "may open this area". It used to skip the verb
 *      check, and rules without a level defaulted to read, so turning on "User
 *      Management" or "API Clients" for an Operator so they could look at it
 *      gave them full administration of that area, including delete.
 *
 * Only an administrator holding `manage_users` can create an override, and
 * every change is written to `security_events` as `access.updated`.
 */
const GRANULAR = new Set(MODULES.filter((m) => m.type === "granular").map((m) => m.key));

function grants(access: EffectiveAccess, rule: Rule): boolean {
  if (rule.anyModule) {
    return rule.anyModule.some((module) => grants(access, { ...rule, anyModule: undefined, module }));
  }
  if (rule.module && GRANULAR.has(rule.module) && access.overriddenModules.includes(rule.module)) {
    return hasModuleAccess(access, rule.module, rule.level ?? "read");
  }
  if (rule.permission && !hasPermission(access, rule.permission)) return false;
  if (rule.module && !hasModuleAccess(access, rule.module, rule.level ?? "read")) return false;
  return true;
}

/**
 * Whether a signed-in user with `access` passes the rule table for this request.
 * Pure: exported for the regression tests, and usable by any route that needs
 * the same answer the middleware would give.
 */
export function ruleAllows(access: EffectiveAccess, method: string, path: string): boolean {
  const rule = findRule(method, path);
  if (!rule) return false;
  return !!rule.public || !!rule.self || grants(access, rule);
}

// ── Middleware ───────────────────────────────────────────────────────────────

export function authorize(req: Request, res: Response, next: NextFunction): void {
  const rule = findRule(req.method, req.path);

  if (rule?.public) { next(); return; }

  // Escape hatch for the documented rollback path. Loud, and never silent.
  if (!authConfig.enforce) {
    warnEnforcementDisabled();
    next();
    return;
  }

  // A valid API key already satisfied its own scope check in apiKeyAuth.
  if (req.apiClient && rule?.allowApiKey) { next(); return; }

  // An API key on any other route is refused, including a path that matches no
  // rule. Rules are case-sensitive while Express routing is not, so an unmatched
  // path is not evidence that no route exists: `/api/Users` reaches the users
  // router. This used to let any key through on an unmatched path, which made
  // every admin route reachable by changing the case of one letter.
  if (req.apiClient && !req.principal) {
    recordSecurityEvent({
      type: "authz.denied",
      outcome: "failure",
      reason: rule ? "api_key_not_allowed" : "api_key_no_rule",
      detail: { method: req.method, path: req.path, apiClientId: req.apiClient.id, clientId: req.apiClient.clientId },
      req,
    });
    res.status(403).json({
      error: "API keys cannot be used on this endpoint.",
      code: "api_key_not_allowed",
    });
    return;
  }

  if (!req.principal) {
    if (!authConfig.sessionRequired && req.method === "GET") { next(); return; }

    const reason = req.authFailure ?? "no_session";

    // A machine route (ingest, export) reached without a key is the common case
    // here, and a bare "Authentication required" tells an integrator nothing —
    // gateways surface it as "post failed, 401". Say which header is missing, and
    // which scope it has to carry.
    const machineRoute = rule?.allowApiKey === true;
    const sentSomeKey = !!(req.headers["x-api-key"] || (req.headers["authorization"] as string | undefined)?.startsWith("Bearer "));

    // A key in the query string is IGNORED unless API_KEY_ALLOW_QUERY_PARAM is on
    // (it would otherwise be written to nginx's access log in cleartext). Saying
    // so here is the difference between a five-minute fix and an afternoon: the
    // caller did send a credential, it was simply not read, and every other
    // message on this path implies they sent nothing at all.
    const queryKeyIgnored = !authConfig.allowApiKeyInQuery
      && ["key", "apiKey", "api_key"].some((p) => {
        const v = (req.query as Record<string, unknown> | undefined)?.[p];
        const raw = Array.isArray(v) ? v[0] : v;
        return typeof raw === "string" && raw.trim().length > 0;
      });

    // A copy-and-paste ingest URL that did not resolve. `attachApiClient` records
    // why it failed; `ingestAuth` in routes/ingest.ts phrases the same cases, but
    // it never gets to run — `authorize` is mounted ahead of the router, so every
    // one of those cases fell through to the generic "send a header" message
    // below. That is wrong advice for someone who pasted a URL and never sent a
    // header at all, and it left them with precisely the blind 401 that the
    // copy-and-paste endpoint exists to remove. Answer the actual question here.
    if (req.ingestTokenFailure === "rate_limited") {
      res.setHeader("Retry-After", "60");
      res.status(429).json({
        error: "Rate limit exceeded",
        code: "rate_limited",
        limit: `${authConfig.apiKey.rateLimitRpm} requests per minute`,
        retryAfter: "60",
      });
      return;
    }
    if (req.ingestTokenFailure === "ip_not_allowed") {
      // Same answer as a header key from the wrong address (apiKeyAuth), without
      // the allowlist itself.
      res.status(403).json({ error: "Request IP not in allowlist", code: "ip_not_allowed" });
      return;
    }
    if (req.ingestTokenFailure) {
      const why = req.ingestTokenFailure;
      res.status(why === "scope_too_broad" ? 403 : 401).json({
        error:
          why === "unknown"  ? "This ingest URL is not recognised. It may have been regenerated or deleted."
        : why === "inactive" ? "This ingest endpoint has been disabled or revoked."
        : why === "expired"  ? "This ingest endpoint has expired."
        : why === "scope_too_broad"
                             ? "This credential is too broadly scoped to be used in a URL. Create a dedicated ingest endpoint instead."
        :                      "This ingest URL is malformed.",
        code: `ingest_url_${why}`,
        hint: "Copy the endpoint again from Integration Hub → Broker Management.",
      });
      return;
    }

    res.status(401).json({
      error: reason === "session_expired"
        ? "Your session has expired. Please sign in again."
        : reason === "account_inactive"
          ? "Your account is no longer active. Contact your administrator."
          : machineRoute
            ? queryKeyIgnored
              ? "The API key was sent in the URL query string, which is not accepted. Send it as a header instead."
              : sentSomeKey
                ? "The API key sent with this request is not valid, has expired, or has been revoked."
                : "This endpoint requires an API key."
            : "Authentication required",
      code: reason === "no_session"
        ? (queryKeyIgnored && machineRoute ? "api_key_in_query_string" : "authentication_required")
        : reason,
      ...(machineRoute && {
        hint: `Send the client secret as  X-API-Key: <clientSecret>  or  Authorization: Bearer <clientSecret>. ${
          req.path.startsWith("/ingest") ? "The key must carry the ingest:write scope." : ""
        }`.trim(),
        ...(queryKeyIgnored && {
          why: "A key in the URL is written to proxy access logs in cleartext, so it is rejected by default. "
             + "Set API_KEY_ALLOW_QUERY_PARAM=true to re-enable it only if the device cannot send headers.",
        }),
        docs: "Integration Hub → API Client. Secrets are shown once, when created or rotated — if you no longer have it, use Rotate Secret.",
      }),
    });
    return;
  }

  // Deny-by-default: an unmapped route is not reachable by a human caller.
  // Adding a route therefore requires adding a rule — the failure mode is a
  // visible 403 during development, not a silent hole in production.
  if (!rule) {
    recordSecurityEvent({
      type: "authz.denied",
      outcome: "failure",
      userId: req.principal.user.id,
      username: req.principal.user.username,
      reason: "no_rule",
      detail: { method: req.method, path: req.path },
      req,
    });
    res.status(403).json({
      error: "This endpoint has no authorisation rule and is denied by default.",
      code: "no_authorization_rule",
      hint: "Add a rule to ROUTE_RULES in middleware/authorize.ts.",
    });
    return;
  }

  // A session established with an admin-issued temporary password can do
  // exactly one thing: replace it. Without this the "temporary" password would
  // be a fully functional credential that merely nags in the UI — and anyone
  // who intercepted it (chat, ticket, sticky note) would have real access.
  if (req.principal.user.mustChangePassword && !PASSWORD_CHANGE_EXEMPT.test(req.path)) {
    res.status(403).json({
      error: "You must choose a new password before continuing.",
      code: "password_change_required",
    });
    return;
  }

  if (rule.self || grants(req.principal.access, rule)) { next(); return; }

  recordSecurityEvent({
    type: "authz.denied",
    outcome: "failure",
    userId: req.principal.user.id,
    username: req.principal.user.username,
    reason: rule.permission && !hasPermission(req.principal.access, rule.permission)
      ? `missing_permission:${rule.permission}`
      : `missing_module:${rule.module ?? rule.anyModule?.join("|")}.${rule.level ?? "read"}`,
    detail: { method: req.method, path: req.path, role: req.principal.user.role },
    req,
  });

  res.status(403).json({
    error: "You do not have permission to perform this action.",
    code: "insufficient_permission",
    required: { permission: rule.permission, module: rule.module ?? rule.anyModule, level: rule.level ?? "read" },
  });
}

let lastEnforcementWarning = 0;
function warnEnforcementDisabled(): void {
  const now = Date.now();
  if (now - lastEnforcementWarning < 60_000) return;
  lastEnforcementWarning = now;
  // eslint-disable-next-line no-console
  console.warn(
    "🚨  AUTH_ENFORCE=false — route authorisation is DISABLED. " +
    "This is a rollback-only setting. Do not run this way in production.",
  );
}

/** Guard for use inside an individual route handler when the table is too coarse. */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.principal) {
      res.status(401).json({ error: "Authentication required", code: "authentication_required" });
      return;
    }
    if (!hasPermission(req.principal.access, permission)) {
      recordSecurityEvent({
        type: "authz.denied",
        outcome: "failure",
        userId: req.principal.user.id,
        username: req.principal.user.username,
        reason: `missing_permission:${permission}`,
        detail: { method: req.method, path: req.path },
        req,
      });
      res.status(403).json({ error: "You do not have permission to perform this action.", code: "insufficient_permission" });
      return;
    }
    next();
  };
}
