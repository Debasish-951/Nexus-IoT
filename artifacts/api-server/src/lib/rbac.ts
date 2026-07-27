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
  "admin",
  "customer_admin",
  "engineer",
  "operator",
  "viewer",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  customer_admin: "Customer Admin",
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
  // Added: previously implied by `manage_users`, split out so a Customer Admin
  // can manage their own users without seeing platform-wide security telemetry.
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
  admin: ADMIN_PERMISSIONS,
  // Manages people and dashboards inside one customer, but not brokers,
  // API clients, or platform security configuration.
  customer_admin: [
    "view", "manage_assets", "manage_alarms", "acknowledge_alarms", "manage_users",
  ],
  engineer: [
    "view", "manage_assets", "manage_templates", "manage_alarms", "acknowledge_alarms",
    "manage_brokers", "manage_destinations",
  ],
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
  { key: "visualization", label: "Visualization",    type: "granular" },
  { key: "live",          label: "Live Feed",        type: "simple" },
  { key: "explorer",      label: "Data Explorer",    type: "simple" },
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
    dashboard: true, alarms: true, brokers: true, api_clients: true, reports: true,
    live: true, explorer: true, users: true, security: true, activity_log: true,
    assets: ALL, visualization: ALL, analytics: ALL,
  },
  admin: {
    dashboard: true, alarms: true, brokers: true, api_clients: true, reports: true,
    live: true, explorer: true, users: true, security: true, activity_log: true,
    assets: ALL, visualization: ALL, analytics: ALL,
  },
  customer_admin: {
    dashboard: true, alarms: true, brokers: false, api_clients: false, reports: true,
    live: true, explorer: true, users: true, security: false, activity_log: true,
    assets: RW, visualization: ALL, analytics: RO,
  },
  engineer: {
    dashboard: true, alarms: true, brokers: true, api_clients: false, reports: true,
    live: true, explorer: true, users: false, security: false, activity_log: true,
    assets: RW, visualization: RW, analytics: RO,
  },
  operator: {
    dashboard: true, alarms: true, brokers: false, api_clients: false, reports: true,
    live: true, explorer: false, users: false, security: false, activity_log: false,
    assets: RO, visualization: RO, analytics: RO,
  },
  viewer: {
    dashboard: true, alarms: false, brokers: false, api_clients: false, reports: true,
    live: true, explorer: false, users: false, security: false, activity_log: false,
    assets: RO, visualization: RO, analytics: NONE,
  },
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
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Unknown roles collapse to `viewer` — fail closed, never fail open. */
export function normaliseRole(value: string | null | undefined): Role {
  return value && isRole(value) ? value : "viewer";
}

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

  for (const mod of MODULES) {
    const base = defaultForModule(role, mod.key);
    const override = overrides?.modules?.[mod.key];

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
    restrictProjects: !!overrides?.restrictProjects,
    allowedProjects: overrides?.allowedProjects ?? [],
    restrictDashboards: !!overrides?.restrictDashboards,
    allowedDashboards: overrides?.allowedDashboards ?? [],
    restrictAnalytics: !!overrides?.restrictAnalytics,
    allowedAnalytics: overrides?.allowedAnalytics ?? [],
  };
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
    })),
    permissions: PERMISSIONS,
    modules: MODULES,
    analyticsOptions: ANALYTICS_OPTIONS,
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

  return out;
}
