import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { setActorHeaders, setCsrfToken, setUnauthorizedHandler } from "@workspace/api-client-react";

/**
 * Authenticated identity + effective permissions.
 *
 * What changed in the auth upgrade:
 *   - Identity comes from an HttpOnly session cookie the browser cannot read.
 *     There is no `ws_authed` flag and no user object in localStorage, so there
 *     is nothing an attacker can set in devtools to fake a login.
 *   - `permissions` and `modules` are computed by the API from the role matrix
 *     plus that user's per-user overrides, and shipped in the session payload.
 *     The hard-coded ROLE_PERMISSIONS map that used to live here is gone —
 *     it now has exactly one home, `api-server/src/lib/rbac.ts`.
 *
 * `can(permission)` keeps its exact signature, so every existing
 * `<RoleGuard permission="manage_assets">` call site works untouched.
 */

export type GranularPerm = { r: boolean; w: boolean; d: boolean };
export type ModuleAccess = boolean | GranularPerm;

export interface CurrentUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: string;
  status: string;
  /** True while the account is on an admin-issued temporary password. */
  mustChangePassword: boolean;
  /** Expiry of that temporary password; null for a user-chosen one. */
  passwordExpiresAt: string | null;
  mfaEnabled: boolean;
  lastLogin: string | null;
}

export interface SessionPayload extends CurrentUser {
  csrfToken: string;
  permissions: string[];
  modules: Record<string, ModuleAccess>;
  /** Modules an admin set explicitly — these override the role verb. */
  overriddenModules: string[];
  restrictProjects: boolean;
  allowedProjects: string[];
  restrictDashboards: boolean;
  allowedDashboards: string[];
  restrictAnalytics: boolean;
  allowedAnalytics: string[];
  /**
   * API-client scopes this user may grant. `["*"]` means any.
   *
   * Optional so a session issued by an older server (or a cached payload from
   * before this field existed) does not read as "no scopes" and lock the user
   * out of a dialog they are entitled to use — see grantableApiScopes().
   */
  apiScopes?: string[];
}

interface UserContextValue {
  currentUser: CurrentUser | null;
  session: SessionPayload | null;
  /** True until the initial /auth/session probe settles — render a splash, not a redirect. */
  loading: boolean;
  can: (permission: string) => boolean;
  canModule: (moduleKey: string, level?: "read" | "write" | "delete") => boolean;
  /**
   * Combined check with the same precedence the API applies. Prefer this over
   * `can()` alone wherever a module is involved.
   */
  canAction: (permission: string, moduleKey?: string, level?: "read" | "write" | "delete") => boolean;
  canDashboard: (dashboardId: string) => boolean;
  canProject: (projectId: string) => boolean;
  canAnalytics: (optionId: string) => boolean;
  /** Called by the Login page with the payload returned by POST /auth/login. */
  applySession: (payload: SessionPayload) => void;
  /** Re-read /auth/session — e.g. after an admin edits your own access. */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const EMPTY: UserContextValue = {
  currentUser: null,
  session: null,
  loading: true,
  // Fail closed. The old default returned `true`, which meant a render before
  // the identity resolved briefly showed controls the user may not have.
  can: () => false,
  canModule: () => false,
  canAction: () => false,
  canDashboard: () => false,
  canProject: () => false,
  canAnalytics: () => false,
  applySession: () => {},
  refresh: async () => {},
  logout: async () => {},
};

const UserContext = createContext<UserContextValue>(EMPTY);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const clear = useCallback(() => {
    setSession(null);
    setCsrfToken(null);
    setActorHeaders(null, null);
    // Legacy keys from the pre-upgrade client-side auth. Removed on every
    // logout so an old browser profile cannot resurrect a fake session.
    localStorage.removeItem("ws_authed");
    localStorage.removeItem("iot_current_user");
  }, []);

  const apply = useCallback((payload: SessionPayload) => {
    setSession(payload);
    setCsrfToken(payload.csrfToken);
    setActorHeaders(payload.fullName, payload.role, payload.username);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!res.ok) { clear(); return; }
      apply(await res.json());
    } catch {
      // Network failure is not the same as "signed out" — keep whatever
      // identity we already have rather than bouncing the user to /login
      // because the API restarted.
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [apply, clear]);

  // Probe the session cookie on mount. This is the only way the SPA learns who
  // it is — the cookie itself is HttpOnly and unreadable from JS.
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  // Any 401 from anywhere in the app means the session died server-side
  // (expired, revoked, account suspended). Drop the identity immediately so the
  // route guard redirects instead of leaving a broken shell on screen.
  useEffect(() => {
    setUnauthorizedHandler(() => { clear(); setLoading(false); });
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: session?.csrfToken ? { "x-csrf-token": session.csrfToken } : {},
      });
    } catch {
      /* revoke best-effort — clear locally regardless */
    }
    clear();
  }, [clear, session]);

  const value = useMemo<UserContextValue>(() => {
    const currentUser: CurrentUser | null = session
      ? {
          id: session.id, username: session.username, fullName: session.fullName,
          email: session.email, role: session.role, status: session.status,
          mustChangePassword: session.mustChangePassword,
          passwordExpiresAt: session.passwordExpiresAt,
          mfaEnabled: session.mfaEnabled,
          lastLogin: session.lastLogin,
        }
      : null;

    const can = (permission: string) => !!session?.permissions.includes(permission);

    const canModule = (moduleKey: string, level: "read" | "write" | "delete" = "read") => {
      const access = session?.modules[moduleKey];
      if (access === undefined) return false;
      if (typeof access === "boolean") return access;
      return level === "read" ? access.r : level === "write" ? access.w : access.d;
    };

    /**
     * Mirrors `grants()` in api-server/src/middleware/authorize.ts. An explicit
     * per-user module override wins over the role verb; otherwise both apply.
     * Keeping the two in step is why the payload ships `overriddenModules`.
     */
    const isOverridden = (moduleKey: string) =>
      !!session?.overriddenModules?.includes(moduleKey);

    return {
      currentUser,
      session,
      loading,
      can,
      canModule,
      canAction: (permission, moduleKey, level = "read") => {
        if (moduleKey && isOverridden(moduleKey)) return canModule(moduleKey, level);
        if (!can(permission)) return false;
        return moduleKey ? canModule(moduleKey, level) : true;
      },
      canDashboard: (id: string) =>
        canModule("visualization") && (!session?.restrictDashboards || !!session?.allowedDashboards.includes(id)),
      canProject: (id: string) =>
        !session?.restrictProjects || !!session?.allowedProjects.includes(id),
      canAnalytics: (id: string) =>
        !session?.restrictAnalytics || !!session?.allowedAnalytics.includes(id),
      applySession: apply,
      refresh,
      logout,
    };
  }, [session, loading, apply, refresh, logout]);

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useCurrentUser() { return useContext(UserContext); }
