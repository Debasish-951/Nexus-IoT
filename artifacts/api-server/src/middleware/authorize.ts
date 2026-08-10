import type { Request, Response, NextFunction } from "express";
import { authConfig } from "../lib/auth-config";
import { hasModuleAccess, hasPermission, type EffectiveAccess } from "../lib/rbac";
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
  // Export endpoints enforce their own scopes via apiKeyAuth; a signed-in human
  // with the matching module grant may also call them.
  { path: "/export/:resource", methods: READ, module: "explorer", level: "read", allowApiKey: true },

  // ── Seen-devices (device discovery, part of ingest tooling) ────────────────
  { path: "/ingest/seen-devices",             methods: READ,       module: "assets", level: "read" },
  { path: "/ingest/seen-devices/prune",       methods: ["POST"],   permission: "manage_assets", module: "assets", level: "delete" },
  { path: "/ingest/seen-devices/:deviceId",   methods: ["DELETE"], permission: "manage_assets", module: "assets", level: "delete" },

  // ── Dashboard ──────────────────────────────────────────────────────────────
  { path: "/dashboard/:metric", methods: READ, module: "dashboard", level: "read" },

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
  { path: "/telemetry/:assetId",          methods: READ, module: "explorer", level: "read" },
  { path: "/telemetry/:assetId/:view",    methods: READ, module: "explorer", level: "read" },

  // ── Alarms ─────────────────────────────────────────────────────────────────
  { path: "/alarms",                          methods: READ,     module: "alarms", level: "read" },
  { path: "/alarms/history",                  methods: READ,     module: "alarms", level: "read" },
  { path: "/alarms/:id/acknowledge",          methods: ["POST"], permission: "acknowledge_alarms", module: "alarms" },
  { path: "/alarms/history/:id/acknowledge",  methods: ["POST"], permission: "acknowledge_alarms", module: "alarms" },
  { path: "/alarm-rules",                     methods: READ,     module: "alarms", level: "read" },
  { path: "/alarm-rules",                     methods: WRITE,    permission: "manage_alarms", module: "alarms" },
  { path: "/alarm-rules/:id",                 methods: WRITE,    permission: "manage_alarms", module: "alarms" },
  { path: "/alarm-rules/:id",                 methods: ["DELETE"], permission: "manage_alarms", module: "alarms" },
  { path: "/alarm-rules/:id/test-webhook",    methods: ["POST"], permission: "manage_alarms", module: "alarms" },

  // ── Brokers & destinations ─────────────────────────────────────────────────
  { path: "/brokers",              methods: READ,       module: "brokers" },
  { path: "/brokers",              methods: WRITE,      permission: "manage_brokers", module: "brokers" },
  { path: "/brokers/:id",          methods: ALL_WRITE,  permission: "manage_brokers", module: "brokers" },
  { path: "/brokers/:id/history",  methods: READ,       module: "brokers" },
  { path: "/destinations",         methods: READ,       module: "brokers" },
  { path: "/destinations",         methods: WRITE,      permission: "manage_destinations", module: "brokers" },
  { path: "/destinations/:id",     methods: ALL_WRITE,  permission: "manage_destinations", module: "brokers" },
  { path: "/destinations/:id/test", methods: ["POST"],  permission: "manage_destinations", module: "brokers" },

  // ── API clients ────────────────────────────────────────────────────────────
  // Must precede /api-clients/:id so "projects" is not read as an id.
  { path: "/api-clients/projects",     methods: READ,      module: "api_clients" },
  { path: "/api-clients",              methods: READ,      module: "api_clients" },
  { path: "/api-clients",              methods: WRITE,     permission: "manage_api_clients", module: "api_clients" },
  { path: "/api-clients/:id",          methods: ALL_WRITE, permission: "manage_api_clients", module: "api_clients" },
  { path: "/api-clients/:id/:action",  methods: ["POST"],  permission: "manage_api_clients", module: "api_clients" },

  // ── Visualization ──────────────────────────────────────────────────────────
  // Visualization hierarchy + each node's dashboard. `/viz-nodes/import` must
  // precede `/viz-nodes/:id` or "import" is read as a node id — and it is a POST
  // to a collection, so it needs write, not the :id rule's level.
  { path: "/viz-nodes/import",    methods: ["POST"],   module: "visualization", level: "write" },
  { path: "/viz-nodes",           methods: READ,       module: "visualization", level: "read" },
  { path: "/viz-nodes",           methods: ["POST"],   module: "visualization", level: "write" },
  { path: "/viz-nodes/:id",       methods: ["PUT"],    module: "visualization", level: "write" },
  { path: "/viz-nodes/:id",       methods: ["DELETE"], module: "visualization", level: "delete" },

  // ── Uploads ────────────────────────────────────────────────────────────────
  // `/uploads/:id/content` precedes the collection rules so the download is not
  // read as an id. Delete is a separate level from write: being able to add a
  // file is not the same right as being able to remove someone else's.
  { path: "/uploads/:id/content", methods: READ,       module: "visualization", level: "read" },
  { path: "/uploads",             methods: READ,       module: "visualization", level: "read" },
  { path: "/uploads",             methods: ["POST"],   module: "visualization", level: "write" },
  { path: "/uploads/:id",         methods: ["DELETE"], module: "visualization", level: "delete" },

  { path: "/viz-dashboards",      methods: READ,       module: "visualization", level: "read" },
  { path: "/viz-dashboards",      methods: ["POST"],   module: "visualization", level: "write" },
  { path: "/viz-dashboards/:id",  methods: ["PUT", "PATCH"], module: "visualization", level: "write" },
  { path: "/viz-dashboards/:id",  methods: ["DELETE"], module: "visualization", level: "delete" },

  // ── Users & security ───────────────────────────────────────────────────────
  { path: "/users",                methods: READ,      permission: "manage_users", module: "users" },
  { path: "/users",                methods: ["POST"],  permission: "manage_users", module: "users" },
  { path: "/users/:id",            methods: READ,      permission: "manage_users", module: "users" },
  { path: "/users/:id",            methods: ALL_WRITE, permission: "manage_users", module: "users" },
  { path: "/users/:id/:action",    methods: "*",       permission: "manage_users", module: "users" },
  { path: "/security/rbac-catalog", methods: READ,     self: true },
  { path: "/security/:resource",          methods: "*", permission: "manage_security", module: "security" },
  { path: "/security/:resource/:id",      methods: "*", permission: "manage_security", module: "security" },
  { path: "/security/:resource/:id/:sub", methods: "*", permission: "manage_security", module: "security" },

  // ── Reports, analytics, activity log, system ───────────────────────────────
  { path: "/activity-log",         methods: READ,      module: "activity_log" },
  { path: "/system/storage",       methods: READ,      module: "reports" },
  { path: "/system/aggregate",     methods: READ,      module: "reports" },
  { path: "/system/retention",     methods: READ,      module: "reports" },
  { path: "/system/retention",     methods: ["POST"],  permission: "manage_assets", module: "reports" },
  { path: "/system/retention/run", methods: ["POST"],  permission: "manage_assets", module: "reports" },
  { path: "/system/retention/:id", methods: ALL_WRITE, permission: "manage_assets", module: "reports" },

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
 *   1. If an administrator has explicitly set this module's grants for this
 *      user, that decision is authoritative for the module. The role verb is
 *      the *source of the default*, not a ceiling — otherwise switching on
 *      `assets.w` for an operator in the Access Control editor would silently
 *      do nothing, which is worse than not offering the toggle.
 *   2. Otherwise both the role verb and the role's module default must allow
 *      it. With no overrides in play this is identical to the pre-upgrade
 *      frontend behaviour, so existing roles behave exactly as before.
 *
 * Only an administrator holding `manage_users` can create an override, and
 * every change is written to `security_events` as `access.updated`.
 */
function grants(access: EffectiveAccess, rule: Rule): boolean {
  if (rule.module && access.overriddenModules.includes(rule.module)) {
    return hasModuleAccess(access, rule.module, rule.level ?? "read");
  }
  if (rule.permission && !hasPermission(access, rule.permission)) return false;
  if (rule.module && !hasModuleAccess(access, rule.module, rule.level ?? "read")) return false;
  return true;
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
  if (req.apiClient && (rule?.allowApiKey || rule === undefined)) { next(); return; }

  if (!req.principal) {
    if (!authConfig.sessionRequired && req.method === "GET") { next(); return; }

    const reason = req.authFailure ?? "no_session";

    // A machine route (ingest, export) reached without a key is the common case
    // here, and a bare "Authentication required" tells an integrator nothing —
    // gateways surface it as "post failed, 401". Say which header is missing, and
    // which scope it has to carry.
    const machineRoute = rule?.allowApiKey === true;
    const sentSomeKey = !!(req.headers["x-api-key"] || (req.headers["authorization"] as string | undefined)?.startsWith("Bearer "));

    res.status(401).json({
      error: reason === "session_expired"
        ? "Your session has expired. Please sign in again."
        : reason === "account_inactive"
          ? "Your account is no longer active. Contact your administrator."
          : machineRoute
            ? sentSomeKey
              ? "The API key sent with this request is not valid, has expired, or has been revoked."
              : "This endpoint requires an API key."
            : "Authentication required",
      code: reason === "no_session" ? "authentication_required" : reason,
      ...(machineRoute && {
        hint: `Send the client secret as  X-API-Key: <clientSecret>  or  Authorization: Bearer <clientSecret>. ${
          req.path.startsWith("/ingest") ? "The key must carry the ingest:write scope." : ""
        }`.trim(),
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
      : `missing_module:${rule.module}.${rule.level ?? "read"}`,
    detail: { method: req.method, path: req.path, role: req.principal.user.role },
    req,
  });

  res.status(403).json({
    error: "You do not have permission to perform this action.",
    code: "insufficient_permission",
    required: { permission: rule.permission, module: rule.module, level: rule.level ?? "read" },
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
