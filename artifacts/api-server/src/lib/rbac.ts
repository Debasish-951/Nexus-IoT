import type { UserAccessOverrides } from "@workspace/db";

/**
 * The platform's single authorisation catalogue.
 *
 * This is a *move*, not a redesign. The verbs come verbatim from
 * `iot-platform/src/contexts/UserContext.tsx` and the module matrix comes
 * verbatim from `iot-platform/src/pages/Users.tsx` — both previously lived only
 * in the browser. They now live here, are enforced by the API, and are served
 * to the SPA so the two can never drift.
 *
 * Existing role names and permission strings are byte-identical to before, so
 * every `can("manage_assets")` / `<RoleGuard permission="…">` call site in the
 * frontend keeps working untouched.
 */

// ── Roles ────────────────────────────────────────────────────────────────────

export const ROLES = [
  "super_admin",
  "company_admin",
  "admin",
  "project_manager",
  "team_lead",
  "developer",
  "engineer",
  "operator",
  "viewer",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  company_admin: "Company Admin",
  admin: "Admin",
  project_manager: "Project Manager",
  team_lead: "Team Lead",
  developer: "Developer",
  engineer: "Engineer",
  operator: "Operator",
  viewer: "Viewer",
};

// ── Permission verbs (unchanged from UserContext.tsx) ────────────────────────

export const PERMISSIONS = [
  "view",
  "manage_assets",
  "manage_templates",
  "manage_alarms",
  "acknowledge_alarms",
  "manage_users",
  "manage_brokers",
  "manage_destinations",
  "manage_api_clients",
  // Added: previously implied by `manage_users`, split out so a role
  // can manage users without seeing platform-wide security telemetry.
  "manage_security",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ADMIN_PERMISSIONS: Permission[] = [
  "view", "manage_assets", "manage_templates", "manage_alarms", "acknowledge_alarms",
  "manage_users", "manage_brokers", "manage_destinations", "manage_api_clients", "manage_security",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  // Reserved for platform operators. Identical grants to admin today; exists so
  // tenant-scoping can be added later without re-labelling existing admins.
  super_admin: ADMIN_PERMISSIONS,
  // The customer's own top administrator on their deployment. Created by a Super
  // Admin, and holds the same power, except over Super Admins and other Company
  // Admins (see ROLE_RANK).
  company_admin: ADMIN_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  project_manager: ["view", "acknowledge_alarms"],
  team_lead: ["view", "acknowledge_alarms"],
  // Same rights as Engineer, but only on the projects assigned to them.
  developer: [
    "view", "manage_assets", "manage_templates", "manage_alarms", "acknowledge_alarms",
    "manage_brokers", "manage_destinations", "manage_api_clients",
  ],
  engineer: [
    "view", "manage_assets", "manage_templates", "manage_alarms", "acknowledge_alarms",
    "manage_brokers", "manage_destinations", "manage_api_clients",
  ],
  // Deliberately NOT granted to operator/viewer. These are read-only roles, and a
  // credential outlives the session that created it — an account that cannot change
  // anything through the UI should not be able to mint something that can.
  operator: ["view", "acknowledge_alarms"],
  viewer: ["view"],
};

// ── Modules (unchanged from Users.tsx, plus the ones the nav already had) ─────

export type ModuleType = "simple" | "granular";
export interface ModuleDef {
  key: string;
  label: string;
  type: ModuleType;
}

export const MODULES: ModuleDef[] = [
  { key: "dashboard",     label: "Dashboard",        type: "simple" },
  { key: "assets",        label: "Asset Management", type: "granular" },
  { key: "alarms",        label: "Alarms",           type: "simple" },
  { key: "brokers",       label: "Brokers",          type: "simple" },
  { key: "api_clients",   label: "API Clients",      type: "simple" },
  { key: "reports",       label: "Reports",          type: "simple" },
  // Own module since November 2026 (it used to ride on Reports): storage, retention,
  // legal holds, archives, backups and data health. Role defaults copy Reports (except
  // Operator and Viewer, which no longer get it), and a
  // user whose Reports access was overridden keeps that decision (LEGACY_SOURCE).
  { key: "data_management", label: "Data Management", type: "simple" },
  { key: "visualization", label: "Visualization",    type: "granular" },
  { key: "live",          label: "Live Feed",        type: "simple" },
  { key: "explorer",      label: "Data Explorer",    type: "simple" },
  // Own modules since November 2026 (they used to ride on Data Explorer and
  // Visualization). Role defaults copy those modules, and a user whose old module
  // was overridden keeps that decision until the new one is set (LEGACY_SOURCE).
  { key: "ai_advisor",    label: "AI Advisor",       type: "simple" },
  // Read = open twins; Write = create and change; Delete = delete. Roles that could
  // edit twins before keep delete too (it used to come with write).
  { key: "live_twin",     label: "Live Twin",        type: "granular" },
  { key: "analytics",     label: "Analytics & KPI",  type: "granular" },
  { key: "users",         label: "User Management",  type: "simple" },
  { key: "security",      label: "Security Settings", type: "simple" },
  { key: "activity_log",  label: "Audit Logs",       type: "simple" },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
const MODULE_BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

export type GranularPerm = { r: boolean; w: boolean; d: boolean };
export type ModuleAccess = boolean | GranularPerm;

const ALL: GranularPerm = { r: true, w: true, d: true };
const RW: GranularPerm = { r: true, w: true, d: false };
const RO: GranularPerm = { r: true, w: false, d: false };
const NONE: GranularPerm = { r: false, w: false, d: false };

export const ROLE_MODULE_DEFAULTS: Record<Role, Record<string, ModuleAccess>> = {
  super_admin: {
    dashboard: true, alarms: true, brokers: true, api_clients: true, reports: true, data_management: true,
    live: true, explorer: true, users: true, security: true, activity_log: true,
    assets: ALL, visualization: ALL, ai_advisor: true, live_twin: ALL, analytics: ALL,
  },
  company_admin: {
    dashboard: true, alarms: true, brokers: true, api_clients: true, reports: true, data_management: true,
    live: true, explorer: true, users: true, security: true, activity_log: true,
    assets: ALL, visualization: ALL, ai_advisor: true, live_twin: ALL, analytics: ALL,
  },
  admin: {
    dashboard: true, alarms: true, brokers: true, api_clients: true, reports: true, data_management: true,
    live: true, explorer: true, users: true, security: true, activity_log: true,
    assets: ALL, visualization: ALL, ai_advisor: true, live_twin: ALL, analytics: ALL,
  },
  project_manager: {
    dashboard: true, alarms: true, brokers: false, api_clients: false, reports: true, data_management: true,
    live: true, explorer: true, users: false, security: false, activity_log: false,
    assets: RO, visualization: RW, ai_advisor: true, live_twin: ALL, analytics: RO,
  },
  team_lead: {
    dashboard: true, alarms: true, brokers: false, api_clients: false, reports: true, data_management: true,
    live: true, explorer: true, users: false, security: false, activity_log: false,
    assets: RO, visualization: RW, ai_advisor: true, live_twin: ALL, analytics: RO,
  },
  developer: {
    dashboard: true, alarms: true, brokers: true, api_clients: true, reports: true, data_management: true,
    live: true, explorer: true, users: false, security: false, activity_log: true,
    assets: RW, visualization: RW, ai_advisor: true, live_twin: ALL, analytics: RO,
  },
  engineer: {
    dashboard: true, alarms: true, brokers: true, api_clients: true, reports: true, data_management: true,
    live: true, explorer: true, users: false, security: false, activity_log: true,
    assets: RW, visualization: RW, ai_advisor: true, live_twin: ALL, analytics: RO,
  },
  // Operators and Viewers no longer get Data Management by default (audit 23 Nov
  // 2026, L-3): backup runs, the archive path and legal-hold names are not theirs
  // to see. A per-user override (or an older Reports override) still applies.
  operator: {
    dashboard: true, alarms: true, brokers: false, api_clients: false, reports: true, data_management: false,
    live: true, explorer: false, users: false, security: false, activity_log: false,
    assets: RO, visualization: RO, ai_advisor: false, live_twin: RO, analytics: RO,
  },
  viewer: {
    dashboard: true, alarms: false, brokers: false, api_clients: false, reports: true, data_management: false,
    live: true, explorer: false, users: false, security: false, activity_log: false,
    assets: RO, visualization: RO, ai_advisor: false, live_twin: RO, analytics: NONE,
  },
};

// ── API-client scopes a user may grant ───────────────────────────────────────
//
// Distinct from the user's own module access. These bound what a credential the
// user creates is allowed to do, so that "can commission a gateway" does not
// imply "can mint a key that reads the whole platform".

/** Scope ids that may appear on an API client, and how to label them. */
export const API_SCOPE_OPTIONS = [
  { id: "ingest:write",       label: "Write Telemetry",    kind: "write" as const },
  { id: "read:assets",        label: "Read Assets",        kind: "read"  as const },
  { id: "read:telemetry",     label: "Read Telemetry",     kind: "read"  as const },
  { id: "read:alarms",        label: "Read Alarms",        kind: "read"  as const },
  { id: "read:alarm-history", label: "Read Alarm History", kind: "read"  as const },
  // Integration Hub: third-party read/write API (/api/v1) and the event feed.
  { id: "read:alarm-rules",   label: "Read Alarm Rules",   kind: "read"  as const },
  { id: "read:events",        label: "Read Event Feed",    kind: "read"  as const },
  { id: "write:alarms",       label: "Acknowledge Alarms", kind: "write" as const },
  { id: "write:attributes",   label: "Set Attribute Values", kind: "write" as const },
  { id: "write:maintenance",  label: "Set Maintenance Mode", kind: "write" as const },
];

export const API_SCOPE_IDS = API_SCOPE_OPTIONS.map((s) => s.id);
/** The super-key. Only ever grantable by a full administrator. */
export const API_SCOPE_ALL = "*";

/**
 * Who may grant what, by role.
 *
 * Engineers commission gateways, so they get write — that is
 * the whole job. Read scopes expose asset, telemetry and alarm data across the
 * platform through a credential that outlives any session, so they stay with the
 * administrators. Operators and viewers mint nothing.
 *
 * An administrator can override any of this per user in Access Control.
 */
export const ROLE_API_SCOPE_DEFAULTS: Record<Role, string[]> = {
  super_admin:    [API_SCOPE_ALL, ...API_SCOPE_IDS],
  company_admin:  [API_SCOPE_ALL, ...API_SCOPE_IDS],
  admin:          [API_SCOPE_ALL, ...API_SCOPE_IDS],
  project_manager: [],
  team_lead:      [],
  developer:      ["ingest:write"],
  engineer:       ["ingest:write"],
  operator:       [],
  viewer:         [],
};

/** Analytics/report sub-features (unchanged from Users.tsx). */
export const ANALYTICS_OPTIONS = [
  { id: "telemetry_summary", label: "Telemetry Summary" },
  { id: "alarm_reports",     label: "Alarm Reports" },
  { id: "asset_status",      label: "Asset Status Snapshots" },
  { id: "performance_kpi",   label: "Performance KPIs" },
  { id: "trend_analysis",    label: "Trend Analysis" },
  { id: "data_export",       label: "Data Export" },
];

// ── Effective access resolution ──────────────────────────────────────────────

export interface EffectiveAccess {
  role: Role;
  permissions: Permission[];
  modules: Record<string, ModuleAccess>;
  /**
   * Modules the administrator set explicitly for this user, as opposed to
   * inheriting from the role.
   *
   * This drives the precedence rule in `authorize`: where an admin has
   * deliberately set a module's R/W/D circles, that decision is authoritative
   * for that module. Without it, granting `assets.w` to an operator would be a
   * no-op — the role verb `manage_assets` would still veto the write, and the
   * toggle in the Access Control editor would silently do nothing.
   */
  overriddenModules: string[];
  restrictProjects: boolean;
  allowedProjects: string[];
  restrictDashboards: boolean;
  allowedDashboards: string[];
  restrictAnalytics: boolean;
  allowedAnalytics: string[];
  /** API-client scopes this user may grant. See ROLE_API_SCOPE_DEFAULTS. */
  apiScopes: string[];
}

/**
 * How a role reaches projects. Project Managers see all of them. Team Leads and
 * Developers see only what they are assigned, so an empty list means no projects.
 * Every other role follows the per-user Project Access setting.
 */
export type ProjectRule = "all" | "assigned" | "per_user";

export function projectRule(role: Role): ProjectRule {
  if (role === "project_manager") return "all";
  return role === "team_lead" || role === "developer" ? "assigned" : "per_user";
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Unknown roles collapse to `viewer` — fail closed, never fail open. */
export function normaliseRole(value: string | null | undefined): Role {
  return value && isRole(value) ? value : "viewer";
}

/**
 * Modules split out of older ones. Until an administrator sets the new module for
 * a user, that user's override of the old module applies, so nobody gains (or
 * loses) AI Advisor, Live Twin or Data Management through the split.
 */
const LEGACY_SOURCE: Record<string, string> = { ai_advisor: "explorer", live_twin: "visualization", data_management: "reports" };

function defaultForModule(role: Role, key: string): ModuleAccess {
  const def = ROLE_MODULE_DEFAULTS[role]?.[key];
  if (def !== undefined) return def;
  return MODULE_BY_KEY.get(key)?.type === "granular" ? { ...NONE } : false;
}

/**
 * Role defaults, with the per-user overrides layered on top.
 *
 * Overrides can only be applied to known module keys, and a granular module can
 * only ever hold a granular value (and vice versa) — a hand-edited jsonb blob
 * cannot smuggle in a shape the enforcement code does not expect.
 */
export function resolveAccess(
  roleValue: string | null | undefined,
  overrides: UserAccessOverrides | null | undefined,
): EffectiveAccess {
  const role = normaliseRole(roleValue);
  const modules: Record<string, ModuleAccess> = {};
  const overriddenModules: string[] = [];
  const projects = projectRule(role);

  for (const mod of MODULES) {
    const base = defaultForModule(role, mod.key);
    const legacy = LEGACY_SOURCE[mod.key];
    let override = overrides?.modules?.[mod.key];
    if (override === undefined && legacy) {
      const old = overrides?.modules?.[legacy];
      // Twins could always be deleted by anyone who could edit them; keep that.
      override = mod.key === "live_twin" && old && typeof old === "object" ? { ...old, d: !!old.d || !!old.w } : old;
    }

    if (override === undefined) {
      modules[mod.key] = typeof base === "boolean" ? base : { ...base };
      continue;
    }
    overriddenModules.push(mod.key);

    if (mod.type === "simple") {
      modules[mod.key] = typeof override === "boolean"
        ? override
        : Boolean(override?.r);
    } else {
      modules[mod.key] = typeof override === "boolean"
        ? { r: override, w: override, d: override }
        : { r: !!override?.r, w: !!override?.w, d: !!override?.d };
    }
  }

  return {
    role,
    permissions: [...(ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.viewer)],
    modules,
    overriddenModules,
    restrictProjects: projects === "per_user" ? !!overrides?.restrictProjects : projects === "assigned",
    allowedProjects: overrides?.allowedProjects ?? [],
    restrictDashboards: !!overrides?.restrictDashboards,
    allowedDashboards: overrides?.allowedDashboards ?? [],
    restrictAnalytics: !!overrides?.restrictAnalytics,
    allowedAnalytics: overrides?.allowedAnalytics ?? [],
    apiScopes: overrides?.apiScopes ?? [...(ROLE_API_SCOPE_DEFAULTS[role] ?? [])],
  };
}

/**
 * Which of the requested scopes this user is NOT allowed to grant.
 *
 * An empty result means the request is permitted. Holding `*` permits everything,
 * which is why only administrators have it by default.
 *
 * Requesting no scopes at all is rejected by the caller rather than here: an empty
 * scopes array is treated as "all scopes" by apiKeyAuth, so it is a privilege
 * escalation dressed as an omission.
 */
export function ungrantableScopes(access: EffectiveAccess, requested: string[]): string[] {
  if (access.apiScopes.includes(API_SCOPE_ALL)) return [];
  return requested.filter((s) => !access.apiScopes.includes(s));
}

/** Whether this user may create API credentials at all. */
export function canCreateApiClients(access: EffectiveAccess): boolean {
  return access.apiScopes.length > 0;
}

// ── Predicates used by the middleware ────────────────────────────────────────

export function hasPermission(access: EffectiveAccess, permission: string): boolean {
  return (access.permissions as string[]).includes(permission);
}

/**
 * `level` maps onto the existing R/W/D circles in the Access Control editor.
 * There is deliberately no separate "update" level: the matrix has always been
 * R/W/D and every write path in the codebase treats create and update
 * identically, so `write` covers both. See docs/security/auth-upgrade.md §2.4.
 */
export function hasModuleAccess(
  access: EffectiveAccess,
  moduleKey: string,
  level: "read" | "write" | "delete" = "read",
): boolean {
  const value = access.modules[moduleKey];
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (level === "read") return value.r;
  if (level === "write") return value.w;
  return value.d;
}

export function canAccessDashboard(access: EffectiveAccess, dashboardId: string): boolean {
  if (!hasModuleAccess(access, "visualization", "read")) return false;
  if (!access.restrictDashboards) return true;
  return access.allowedDashboards.includes(dashboardId);
}

export function canAccessProject(access: EffectiveAccess, projectId: string): boolean {
  if (!access.restrictProjects) return true;
  return access.allowedProjects.includes(projectId);
}

/** Payload for GET /api/security/rbac-catalog — drives the Access Control editor. */
export function rbacCatalog() {
  return {
    roles: ROLES.map((r) => ({
      key: r,
      label: ROLE_LABELS[r],
      permissions: ROLE_PERMISSIONS[r],
      moduleDefaults: ROLE_MODULE_DEFAULTS[r],
      apiScopeDefaults: ROLE_API_SCOPE_DEFAULTS[r],
      projectAccess: projectRule(r),
    })),
    permissions: PERMISSIONS,
    modules: MODULES,
    analyticsOptions: ANALYTICS_OPTIONS,
    apiScopeOptions: API_SCOPE_OPTIONS,
  };
}

/**
 * Sanitise an untrusted overrides object before it is written to the database.
 * Drops unknown module keys and coerces every value to the module's declared
 * shape, so the stored jsonb is always something `resolveAccess` can read.
 */
export function sanitiseAccessOverrides(input: unknown): UserAccessOverrides {
  const src = (input ?? {}) as Record<string, unknown>;
  const out: UserAccessOverrides = {};

  if (src.modules && typeof src.modules === "object") {
    const modules: NonNullable<UserAccessOverrides["modules"]> = {};
    for (const [key, raw] of Object.entries(src.modules as Record<string, unknown>)) {
      const def = MODULE_BY_KEY.get(key);
      if (!def) continue; // unknown module key — drop silently
      if (def.type === "simple") {
        modules[key] = typeof raw === "boolean" ? raw : Boolean((raw as GranularPerm)?.r);
      } else if (typeof raw === "boolean") {
        modules[key] = { r: raw, w: raw, d: raw };
      } else if (raw && typeof raw === "object") {
        const g = raw as Partial<GranularPerm>;
        // Mirror the editor's cascade so a stored grant is never incoherent
        // (delete without write, write without read).
        const r = !!g.r || !!g.w || !!g.d;
        const w = !!g.w || !!g.d;
        modules[key] = { r, w, d: !!g.d };
      }
    }
    if (Object.keys(modules).length > 0) out.modules = modules;
  }

  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 1000) : [];

  if (src.restrictProjects !== undefined) out.restrictProjects = !!src.restrictProjects;
  if (src.allowedProjects !== undefined) out.allowedProjects = ids(src.allowedProjects);
  if (src.restrictDashboards !== undefined) out.restrictDashboards = !!src.restrictDashboards;
  if (src.allowedDashboards !== undefined) out.allowedDashboards = ids(src.allowedDashboards);
  if (src.restrictAnalytics !== undefined) out.restrictAnalytics = !!src.restrictAnalytics;
  if (src.allowedAnalytics !== undefined) {
    const valid = new Set(ANALYTICS_OPTIONS.map((o) => o.id));
    out.allowedAnalytics = ids(src.allowedAnalytics).filter((id) => valid.has(id));
  }
  if (src.apiScopes !== undefined) {
    // Only known scope ids survive, so a hand-edited blob cannot invent a scope
    // that later matches a route guard by accident.
    const valid = new Set([API_SCOPE_ALL, ...API_SCOPE_IDS]);
    out.apiScopes = [...new Set(ids(src.apiScopes).filter((id) => valid.has(id)))];
  }

  return out;
}

// ── Role hierarchy ───────────────────────────────────────────────────────────
//
// The permission matrix answers "may this role manage users?". It does NOT
// answer "may this user manage THAT user?", and until this section existed the
// second question was never asked — so anyone holding `manage_users` could
// assign any role in the list, including one above their own.
//
// Concretely: `admin` carries `manage_users`, so an admin could
// POST a new `super_admin`, or PUT their own record with `role: "super_admin"`.
// The existing guards around this code are all AVAILABILITY guards — do not
// demote the last admin, do not delete yourself — and none of them look at
// whether the actor outranks the target.
//
// Rank makes that question answerable.

const ROLE_RANK: Record<Role, number> = {
  super_admin: 100,
  // Above every role a company manages for itself, and below Super Admin. Because
  // rank must be strictly greater, only a Super Admin can create or change a
  // Company Admin, and a Company Admin can never edit or remove a Super Admin.
  company_admin: 90,
  admin: 80,
  project_manager: 60,
  team_lead: 50,
  developer: 40,
  engineer: 40,
  operator: 20,
  viewer: 10,
};

/** Super Admin and Company Admin: full reach, including what no permission verb covers. */
export function isTopAdminRole(role: string | null | undefined): boolean {
  return role === "super_admin" || role === "company_admin";
}

export function roleRank(role: string | null | undefined): number {
  const r = normaliseRole(role);
  return ROLE_RANK[r] ?? 0;
}

/**
 * May `actor` administer a user holding `targetRole`?
 *
 * Strictly-greater rank, with one exception: a super admin may act on another
 * super admin. Without that exception the top tier becomes unmanageable — nobody
 * could ever disable a compromised super-admin account, which is a worse
 * position than the one this rule exists to prevent.
 */
export function canActOnRole(actorRole: string | null | undefined, targetRole: string | null | undefined): boolean {
  const actor = roleRank(actorRole);
  if (actor >= ROLE_RANK.super_admin) return true;
  return actor > roleRank(targetRole);
}

/**
 * May `actor` grant `roleToGrant`?
 *
 * Same rule, applied to the role being handed out rather than the user being
 * edited. Both checks are needed and neither implies the other: promoting an
 * `operator` to `admin` passes the target check for an admin (an
 * operator is below them) and must still fail on the role being granted.
 */
export function canGrantRole(actorRole: string | null | undefined, roleToGrant: string | null | undefined): boolean {
  const actor = roleRank(actorRole);
  if (actor >= ROLE_RANK.super_admin) return true;
  return actor > roleRank(roleToGrant);
}

/**
 * Nobody edits their own role — not even a super admin.
 *
 * Rank alone does not cover self-promotion, because the comparison is against
 * the role you already hold and always succeeds for the top tier. Requiring a
 * second person to change a role turns a single compromised session into
 * something that cannot silently become permanent, and costs a super admin one
 * conversation in the rare case they genuinely need to change their own.
 */
export const SELF_ROLE_CHANGE_MESSAGE =
  "You cannot change your own role. Ask another administrator to make this change.";
