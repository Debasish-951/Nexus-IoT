import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { setActorHeaders } from "@workspace/api-client-react";

export interface CurrentUser {
  id: string;
  fullName: string;
  email: string;
  role: "admin" | "engineer" | "operator" | "viewer";
}

const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin:    ["view","manage_assets","manage_templates","manage_alarms","acknowledge_alarms","manage_users","manage_brokers","manage_destinations","manage_api_clients"],
  engineer: ["view","manage_assets","manage_templates","manage_alarms","acknowledge_alarms","manage_brokers","manage_destinations"],
  operator: ["view","acknowledge_alarms"],
  viewer:   ["view"],
};

interface UserContextValue {
  currentUser: CurrentUser | null;
  setCurrentUser: (u: CurrentUser | null) => void;
  can: (permission: string) => boolean;
}

const UserContext = createContext<UserContextValue>({
  currentUser: null,
  setCurrentUser: () => {},
  can: () => true,
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<CurrentUser | null>(null);

  // Restore the logged-in identity from a prior session. Identity is only ever
  // set by a real login (see pages/Login.tsx) — no auto-select fallback.
  useEffect(() => {
    const saved = localStorage.getItem("iot_current_user");
    if (saved) {
      try { setCurrentUserState(JSON.parse(saved)); } catch { localStorage.removeItem("iot_current_user"); }
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      setActorHeaders(currentUser.fullName, currentUser.role, currentUser.email.split("@")[0]);
    } else {
      setActorHeaders(null, null);
    }
  }, [currentUser]);

  const setCurrentUser = useCallback((u: CurrentUser | null) => {
    setCurrentUserState(u);
    if (u) {
      localStorage.setItem("iot_current_user", JSON.stringify(u));
      setActorHeaders(u.fullName, u.role, u.email.split("@")[0]);
    } else {
      localStorage.removeItem("iot_current_user");
      setActorHeaders(null, null);
    }
  }, []);

  const can = useCallback((permission: string) => {
    if (!currentUser) return false;
    return (ROLE_PERMISSIONS[currentUser.role] ?? []).includes(permission);
  }, [currentUser]);

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser, can }}>
      {children}
    </UserContext.Provider>
  );
}

export function useCurrentUser() { return useContext(UserContext); }
