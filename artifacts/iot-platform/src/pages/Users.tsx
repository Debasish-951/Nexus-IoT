import { useState } from "react";
import {
  useListUsers,
  useCreateUser,
  useDeleteUser,
  useUpdateUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Users as UsersIcon, Plus, Trash2, Pencil, ShieldCheck, RotateCcw, Info } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";

// ── Role styles ───────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<string, string> = {
  admin:    "bg-purple-100 text-purple-700",
  engineer: "bg-blue-100 text-blue-700",
  operator: "bg-green-100 text-green-700",
  viewer:   "bg-gray-100 text-gray-700",
};

const STATUS_STYLES: Record<string, string> = {
  active:    "bg-green-100 text-green-700",
  inactive:  "bg-gray-100 text-gray-600",
  suspended: "bg-red-100 text-red-700",
};

// ── Module definitions ────────────────────────────────────────────────────────
// type: "simple"   → single on/off circle
// type: "granular" → three R / W / D circles

type GranularPerm = { r: boolean; w: boolean; d: boolean };
type ModuleAccess = boolean | GranularPerm;

interface SimpleModule  { key: string; label: string; type: "simple"   }
interface GranularModule{ key: string; label: string; type: "granular" }
type Module = SimpleModule | GranularModule;

const MODULES: Module[] = [
  { key: "dashboard",     label: "Dashboard",       type: "simple"   },
  { key: "assets",        label: "Assets",           type: "granular" },
  { key: "alarms",        label: "Alarms",           type: "simple"   },
  { key: "brokers",       label: "Brokers",          type: "simple"   },
  { key: "api_clients",   label: "API Clients",      type: "simple"   },
  { key: "reports",       label: "Reports",          type: "simple"   },
  { key: "visualization", label: "Visualization",    type: "granular" },
  { key: "live",          label: "Live Feed",        type: "simple"   },
  { key: "explorer",      label: "Data Explorer",    type: "simple"   },
  { key: "analytics",     label: "Analytics & KPI",  type: "granular" },
  { key: "users",         label: "Users",            type: "simple"   },
  { key: "activity_log",  label: "Activity Log",     type: "simple"   },
];

// ── Role defaults ─────────────────────────────────────────────────────────────

const ROLE_DEFAULTS: Record<string, Record<string, ModuleAccess>> = {
  admin: {
    dashboard: true, alarms: true, brokers: true, api_clients: true,
    reports: true, live: true, explorer: true, users: true, activity_log: true,
    assets:        { r: true, w: true, d: true },
    visualization: { r: true, w: true, d: true },
    analytics:     { r: true, w: true, d: true },
  },
  engineer: {
    dashboard: true, alarms: true, brokers: true, api_clients: false,
    reports: true, live: true, explorer: true, users: false, activity_log: true,
    assets:        { r: true, w: true,  d: false },
    visualization: { r: true, w: true,  d: false },
    analytics:     { r: true, w: false, d: false },
  },
  operator: {
    dashboard: true, alarms: true, brokers: false, api_clients: false,
    reports: true, live: true, explorer: false, users: false, activity_log: false,
    assets:        { r: true,  w: false, d: false },
    visualization: { r: true,  w: false, d: false },
    analytics:     { r: true,  w: false, d: false },
  },
  viewer: {
    dashboard: true, alarms: false, brokers: false, api_clients: false,
    reports: true, live: true, explorer: false, users: false, activity_log: false,
    assets:        { r: true,  w: false, d: false },
    visualization: { r: true,  w: false, d: false },
    analytics:     { r: false, w: false, d: false },
  },
};

// ── Persistence ───────────────────────────────────────────────────────────────

const LS_KEY = "iot_access_overrides_v2";
type Overrides = Record<string, Record<string, ModuleAccess>>;

function loadOverrides(): Overrides {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}"); } catch { return {}; }
}
function saveOverrides(o: Overrides) {
  localStorage.setItem(LS_KEY, JSON.stringify(o));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function effectiveAccess(user: any, mod: Module, overrides: Overrides): ModuleAccess {
  const u = overrides[user.id];
  if (u && mod.key in u) return u[mod.key];
  return ROLE_DEFAULTS[user.role]?.[mod.key] ?? (mod.type === "granular" ? { r: false, w: false, d: false } : false);
}

// Cascade rules: enabling a higher permission also enables lower ones
function applyGranularToggle(current: GranularPerm, clicked: "r" | "w" | "d"): GranularPerm {
  const next = { ...current };
  if (clicked === "r") {
    next.r = !current.r;
    if (!next.r) { next.w = false; next.d = false; } // disable W+D when R turns off
  } else if (clicked === "w") {
    next.w = !current.w;
    if (next.w) next.r = true;          // enable R when W turns on
    if (!next.w) next.d = false;        // disable D when W turns off
  } else {
    next.d = !current.d;
    if (next.d) { next.r = true; next.w = true; } // enable R+W when D turns on
  }
  return next;
}

// ── SimpleCircle ─────────────────────────────────────────────────────────────

function SimpleCircle({
  granted, canEdit, onClick, title,
  isOverridden,
}: {
  granted: boolean;
  canEdit: boolean;
  onClick: () => void;
  title: string;
  isOverridden: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!canEdit}
      title={title}
      className={cn(
        "w-6 h-6 rounded-full transition-all duration-150 mx-auto block",
        canEdit ? "cursor-pointer hover:scale-110" : "cursor-default",
        granted ? "bg-green-500" : "border-2 border-gray-300 bg-transparent",
        isOverridden && "ring-2 ring-amber-400 ring-offset-1"
      )}
    />
  );
}

// ── GranularCircles ───────────────────────────────────────────────────────────

function GranularCircles({
  value, canEdit, onToggle, isOverridden,
}: {
  value: GranularPerm;
  canEdit: boolean;
  onToggle: (p: "r" | "w" | "d") => void;
  isOverridden: boolean;
}) {
  const perms: { key: "r" | "w" | "d"; label: string; title: string }[] = [
    { key: "r", label: "R", title: "Read"   },
    { key: "w", label: "W", title: "Write"  },
    { key: "d", label: "D", title: "Delete" },
  ];
  return (
    <div className={cn("flex items-center justify-center gap-1", isOverridden && "ring-2 ring-amber-400 ring-offset-1 rounded-full px-0.5")}>
      {perms.map(p => (
        <button
          key={p.key}
          onClick={() => onToggle(p.key)}
          disabled={!canEdit}
          title={`${p.title}: ${value[p.key] ? "enabled — click to disable" : "disabled — click to enable"}`}
          className={cn(
            "w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center transition-all duration-150 select-none",
            canEdit ? "cursor-pointer hover:scale-110" : "cursor-default",
            value[p.key]
              ? "bg-green-500 text-white"
              : "border-2 border-gray-300 text-gray-300 bg-transparent"
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── AccessMatrix ─────────────────────────────────────────────────────────────

function AccessMatrix({ users, canEdit }: { users: any[]; canEdit: boolean }) {
  const [overrides, setOverrides] = useState<Overrides>(loadOverrides);

  function update(userId: string, moduleKey: string, value: ModuleAccess) {
    const next: Overrides = {
      ...overrides,
      [userId]: { ...(overrides[userId] ?? {}), [moduleKey]: value },
    };
    setOverrides(next);
    saveOverrides(next);
  }

  function resetUser(userId: string) {
    const next = { ...overrides };
    delete next[userId];
    setOverrides(next);
    saveOverrides(next);
  }

  function resetAll() {
    setOverrides({});
    saveOverrides({});
  }

  const anyOverrides = Object.keys(overrides).length > 0;

  // Count total columns for colSpan calculations
  const totalModuleCols = MODULES.reduce((n, m) => n + (m.type === "granular" ? 3 : 1), 0);

  return (
    <div className="space-y-3">
      {/* Legend + reset */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-5 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-green-500 inline-block shrink-0" />
            Access granted
          </span>
          <span className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full border-2 border-gray-300 inline-block shrink-0" />
            No access
          </span>
          <span className="flex items-center gap-2 border-l pl-4">
            <span className="flex gap-1">
              {["R","W","D"].map(l => (
                <span key={l} className="w-4 h-4 rounded-full bg-green-500 text-white text-[9px] font-bold flex items-center justify-center">{l}</span>
              ))}
            </span>
            Read · Write · Delete
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="w-4 h-4 rounded-full bg-green-500 text-white text-[9px] font-bold flex items-center justify-center">R</span>
              <span className="w-4 h-4 rounded-full border-2 border-gray-300 text-gray-300 text-[9px] font-bold flex items-center justify-center">W</span>
              <span className="w-4 h-4 rounded-full border-2 border-gray-300 text-gray-300 text-[9px] font-bold flex items-center justify-center">D</span>
            </span>
            Read-only
          </span>
        </div>
        {canEdit && anyOverrides && (
          <Button variant="ghost" size="sm" className="text-xs text-amber-600 hover:text-amber-800" onClick={resetAll}>
            <RotateCcw className="w-3 h-3 mr-1" /> Reset all overrides
          </Button>
        )}
      </div>

      {/* Info */}
      {canEdit && (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Click any circle to toggle access. For R/W/D modules: enabling Write also enables Read; enabling Delete enables all three. Cells with an amber ring differ from the role default.
        </div>
      )}

      {/* Matrix */}
      <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
        <table className="w-full text-sm" style={{ minWidth: `${220 + totalModuleCols * 72}px` }}>
          <thead>
            {/* Row 1: module group headers */}
            <tr className="border-b border-border bg-muted/60">
              <th rowSpan={2} className="text-left px-4 py-2.5 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider sticky left-0 bg-muted/60 min-w-[210px] border-r border-border">
                User / Role
              </th>
              {MODULES.map(m => (
                <th
                  key={m.key}
                  colSpan={m.type === "granular" ? 3 : 1}
                  rowSpan={m.type === "simple" ? 2 : 1}
                  className={cn(
                    "px-2 py-2 text-center font-semibold text-muted-foreground uppercase text-[10px] tracking-wider",
                    m.type === "granular" && "border-b border-border/50",
                    "border-l border-border/30"
                  )}
                >
                  {m.label}
                </th>
              ))}
              {canEdit && (
                <th rowSpan={2} className="px-3 py-2 text-center font-semibold text-muted-foreground uppercase text-[10px] tracking-wider min-w-[60px] border-l border-border/30">
                  Reset
                </th>
              )}
            </tr>
            {/* Row 2: R / W / D sub-headers for granular modules only */}
            <tr className="border-b border-border bg-muted/50">
              {MODULES.filter(m => m.type === "granular").flatMap(m => [
                <th key={`${m.key}-r`} className="px-1 py-1 text-center text-[10px] text-green-600 font-bold w-8 border-l border-border/30">R</th>,
                <th key={`${m.key}-w`} className="px-1 py-1 text-center text-[10px] text-blue-600 font-bold w-8">W</th>,
                <th key={`${m.key}-d`} className="px-1 py-1 text-center text-[10px] text-red-500 font-bold w-8">D</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={totalModuleCols + (canEdit ? 2 : 1)} className="px-4 py-12 text-center text-muted-foreground">
                  <UsersIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No users found
                </td>
              </tr>
            ) : (
              users.map((user: any) => {
                const hasOverride = !!(overrides[user.id] && Object.keys(overrides[user.id]).length > 0);
                return (
                  <tr key={user.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors group">
                    {/* Sticky user info */}
                    <td className="px-4 py-3 sticky left-0 bg-card group-hover:bg-muted/20 transition-colors border-r border-border/30">
                      <div className="font-semibold text-foreground">{user.fullName}</div>
                      <div className="text-xs text-muted-foreground font-mono">{user.username}</div>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium mt-1 inline-block", ROLE_STYLES[user.role] ?? "bg-muted")}>
                        {user.role}
                      </span>
                    </td>

                    {/* Module cells */}
                    {MODULES.map(mod => {
                      const access = effectiveAccess(user, mod, overrides);
                      const isOverridden = !!(overrides[user.id] && mod.key in overrides[user.id]);

                      if (mod.type === "simple") {
                        const granted = access as boolean;
                        return (
                          <td key={mod.key} className="px-2 py-3 text-center border-l border-border/20">
                            <SimpleCircle
                              granted={granted}
                              canEdit={canEdit}
                              isOverridden={isOverridden}
                              title={canEdit ? (granted ? `Revoke ${mod.label}` : `Grant ${mod.label}`) : (granted ? "Granted" : "No access")}
                              onClick={() => update(user.id, mod.key, !granted)}
                            />
                          </td>
                        );
                      }

                      // Granular module — 3 cells
                      const perm = access as GranularPerm;
                      return (
                        <>
                          <td key={`${mod.key}-r`} colSpan={1} className="px-1 py-3 text-center border-l border-border/20">
                            <button
                              onClick={() => canEdit && update(user.id, mod.key, applyGranularToggle(perm, "r"))}
                              disabled={!canEdit}
                              title={`Read: ${perm.r ? "enabled" : "disabled"}`}
                              className={cn(
                                "w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center mx-auto transition-all duration-150 select-none",
                                canEdit ? "cursor-pointer hover:scale-110" : "cursor-default",
                                perm.r ? "bg-green-500 text-white" : "border-2 border-gray-300 text-gray-300 bg-transparent",
                                isOverridden && "ring-2 ring-amber-400 ring-offset-1"
                              )}
                            >R</button>
                          </td>
                          <td key={`${mod.key}-w`} className="px-1 py-3 text-center">
                            <button
                              onClick={() => canEdit && update(user.id, mod.key, applyGranularToggle(perm, "w"))}
                              disabled={!canEdit}
                              title={`Write: ${perm.w ? "enabled" : "disabled"}`}
                              className={cn(
                                "w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center mx-auto transition-all duration-150 select-none",
                                canEdit ? "cursor-pointer hover:scale-110" : "cursor-default",
                                perm.w ? "bg-green-500 text-white" : "border-2 border-gray-300 text-gray-300 bg-transparent"
                              )}
                            >W</button>
                          </td>
                          <td key={`${mod.key}-d`} className="px-1 py-3 text-center">
                            <button
                              onClick={() => canEdit && update(user.id, mod.key, applyGranularToggle(perm, "d"))}
                              disabled={!canEdit}
                              title={`Delete: ${perm.d ? "enabled" : "disabled"}`}
                              className={cn(
                                "w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center mx-auto transition-all duration-150 select-none",
                                canEdit ? "cursor-pointer hover:scale-110" : "cursor-default",
                                perm.d ? "bg-green-500 text-white" : "border-2 border-gray-300 text-gray-300 bg-transparent"
                              )}
                            >D</button>
                          </td>
                        </>
                      );
                    })}

                    {/* Reset per-row */}
                    {canEdit && (
                      <td className="px-3 py-3 text-center border-l border-border/20">
                        {hasOverride && (
                          <button
                            onClick={() => resetUser(user.id)}
                            title="Reset to role defaults"
                            className="inline-flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-800 transition-colors"
                          >
                            <RotateCcw className="w-3 h-3" /> Reset
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Role defaults reference */}
      <details className="rounded-lg border border-border bg-muted/30 text-xs">
        <summary className="px-4 py-2.5 cursor-pointer font-medium text-muted-foreground select-none hover:text-foreground transition-colors">
          Role defaults reference
        </summary>
        <div className="px-4 pb-4 pt-1 overflow-x-auto">
          <table className="w-full" style={{ minWidth: `${160 + totalModuleCols * 56}px` }}>
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-1.5 font-medium text-muted-foreground pr-6 min-w-[90px]">Role</th>
                {MODULES.map(m =>
                  m.type === "granular" ? (
                    <>
                      <th key={`${m.key}-r`} className="py-1.5 text-center font-medium text-green-600 px-1 text-[10px] border-l border-border/30 min-w-[32px]">R</th>
                      <th key={`${m.key}-w`} className="py-1.5 text-center font-medium text-blue-600 px-1 text-[10px] min-w-[32px]">W</th>
                      <th key={`${m.key}-d`} className="py-1.5 text-center font-medium text-red-500 px-1 text-[10px] min-w-[32px]"
                        title={m.label}>D</th>
                    </>
                  ) : (
                    <th key={m.key} className="py-1.5 text-center font-medium text-muted-foreground px-2 text-[10px] uppercase tracking-wider border-l border-border/30" title={m.label}>
                      {m.label.length > 6 ? m.label.slice(0, 5) + "…" : m.label}
                    </th>
                  )
                )}
              </tr>
              <tr className="border-b border-border/30">
                <th />
                {MODULES.map(m =>
                  m.type === "granular" ? (
                    <th key={`${m.key}-lbl`} colSpan={3} className="text-center text-[10px] text-muted-foreground border-l border-border/30 pb-1 uppercase tracking-wider">
                      {m.label}
                    </th>
                  ) : <th key={m.key} />
                )}
              </tr>
            </thead>
            <tbody>
              {(["admin","engineer","operator","viewer"] as const).map(role => (
                <tr key={role} className="border-b border-border/30">
                  <td className="py-1.5 pr-6">
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", ROLE_STYLES[role])}>
                      {role}
                    </span>
                  </td>
                  {MODULES.map(mod => {
                    const val = ROLE_DEFAULTS[role]?.[mod.key];
                    if (mod.type === "granular") {
                      const p = (val ?? { r: false, w: false, d: false }) as GranularPerm;
                      return (
                        <>
                          <td key={`${mod.key}-r`} className="py-1.5 text-center px-1 border-l border-border/30">
                            <span className={cn("w-4 h-4 rounded-full text-[9px] font-bold inline-flex items-center justify-center", p.r ? "bg-green-500 text-white" : "border border-gray-300 text-gray-300")}>R</span>
                          </td>
                          <td key={`${mod.key}-w`} className="py-1.5 text-center px-1">
                            <span className={cn("w-4 h-4 rounded-full text-[9px] font-bold inline-flex items-center justify-center", p.w ? "bg-green-500 text-white" : "border border-gray-300 text-gray-300")}>W</span>
                          </td>
                          <td key={`${mod.key}-d`} className="py-1.5 text-center px-1">
                            <span className={cn("w-4 h-4 rounded-full text-[9px] font-bold inline-flex items-center justify-center", p.d ? "bg-green-500 text-white" : "border border-gray-300 text-gray-300")}>D</span>
                          </td>
                        </>
                      );
                    }
                    const granted = val as boolean;
                    return (
                      <td key={mod.key} className="py-1.5 text-center px-2 border-l border-border/30">
                        <span className={cn("w-4 h-4 rounded-full inline-block", granted ? "bg-green-500" : "border-2 border-gray-300")} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ── Main Users page ───────────────────────────────────────────────────────────

export default function Users() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const { can } = useCurrentUser();

  const { data: users } = useListUsers();
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();
  const updateUser = useUpdateUser();

  const createForm = useForm({
    defaultValues: { username: "", email: "", fullName: "", role: "viewer", password: "" },
  });
  const editForm = useForm({
    defaultValues: { fullName: "", email: "", role: "viewer", status: "active" },
  });

  function onCreateSubmit(data: any) {
    createUser.mutate({ data }, {
      onSuccess: () => {
        toast({ title: "User created" });
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setCreateOpen(false);
        createForm.reset();
      },
      onError: () => toast({ title: "Failed to create user", variant: "destructive" }),
    });
  }

  function openEdit(user: any) {
    setEditingUser(user);
    editForm.reset({ fullName: user.fullName ?? "", email: user.email ?? "", role: user.role ?? "viewer", status: user.status ?? "active" });
    setEditOpen(true);
  }

  function onEditSubmit(data: any) {
    if (!editingUser) return;
    updateUser.mutate({ id: editingUser.id, data }, {
      onSuccess: () => {
        toast({ title: "User updated" });
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setEditOpen(false);
        setEditingUser(null);
      },
      onError: () => toast({ title: "Failed to update user", variant: "destructive" }),
    });
  }

  const userList = (users as any[] | undefined) ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-primary" /> User Management
          </h1>
          <p className="text-sm text-muted-foreground">Manage platform users, roles, and module access</p>
        </div>
        {can("manage_users") && (
          <Button onClick={() => setCreateOpen(true)} size="sm" data-testid="add-user-btn">
            <Plus className="w-4 h-4 mr-1.5" /> Add User
          </Button>
        )}
      </div>
      <ReadOnlyBanner permission="manage_users" message="cannot create or delete users. Administrator role is required." />

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users"><UsersIcon className="w-3.5 h-3.5 mr-1.5" /> User List</TabsTrigger>
          <TabsTrigger value="access"><ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Access Control</TabsTrigger>
        </TabsList>

        {/* User List */}
        <TabsContent value="users" className="mt-4">
          <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Full Name</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Username</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Last Login</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!users ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : userList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                      <UsersIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No users found
                    </td>
                  </tr>
                ) : (
                  userList.map((user: any) => (
                    <tr key={user.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`user-row-${user.id}`}>
                      <td className="px-4 py-3 font-medium">{user.fullName}</td>
                      <td className="px-4 py-3 font-mono text-xs">{user.username}</td>
                      <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                      <td className="px-4 py-3">
                        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", ROLE_STYLES[user.role] ?? "bg-muted")}>{user.role}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_STYLES[user.status] ?? "bg-muted")}>{user.status}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {user.lastLogin ? format(new Date(user.lastLogin), "yyyy-MM-dd HH:mm") : "Never"}
                      </td>
                      <td className="px-4 py-3">
                        {can("manage_users") && (
                          <div className="flex items-center gap-2 justify-end">
                            <button className="text-muted-foreground hover:text-primary transition-colors" onClick={() => openEdit(user)} data-testid={`edit-user-${user.id}`} title="Edit user">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              onClick={() => deleteUser.mutate({ id: user.id }, {
                                onSuccess: () => { toast({ title: "User deleted" }); qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); },
                              })}
                              data-testid={`delete-user-${user.id}`}
                              title="Delete user"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Access Control */}
        <TabsContent value="access" className="mt-4">
          <div className="space-y-2 mb-4">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" /> Access Control Matrix
            </h2>
            <p className="text-sm text-muted-foreground">
              Role-based access matrix. Simple modules show a single on/off circle. Assets, Visualization, and Analytics show Read · Write · Delete controls.
              {can("manage_users") && " Click any circle to override the role default for that user."}
            </p>
          </div>
          {!users
            ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
            : <AccessMatrix users={userList} canEdit={can("manage_users")} />
          }
        </TabsContent>
      </Tabs>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="add-user-dialog">
          <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
              <FormField control={createForm.control} name="fullName" render={({ field }) => (
                <FormItem><FormLabel>Full Name *</FormLabel><FormControl><Input {...field} data-testid="user-fullname-input" /></FormControl></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={createForm.control} name="username" render={({ field }) => (
                  <FormItem><FormLabel>Username *</FormLabel><FormControl><Input {...field} data-testid="user-username-input" /></FormControl></FormItem>
                )} />
                <FormField control={createForm.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>Email *</FormLabel><FormControl><Input type="email" {...field} data-testid="user-email-input" /></FormControl></FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={createForm.control} name="role" render={({ field }) => (
                  <FormItem><FormLabel>Role</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger data-testid="user-role-select"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="engineer">Engineer</SelectItem>
                        <SelectItem value="operator">Operator</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={createForm.control} name="password" render={({ field }) => (
                  <FormItem><FormLabel>Password *</FormLabel><FormControl><Input type="password" {...field} data-testid="user-password-input" /></FormControl></FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createUser.isPending} data-testid="save-user-btn">Create</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) setEditingUser(null); }}>
        <DialogContent data-testid="edit-user-dialog">
          <DialogHeader><DialogTitle>Edit User — {editingUser?.fullName}</DialogTitle></DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField control={editForm.control} name="fullName" render={({ field }) => (
                <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={editForm.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={editForm.control} name="role" render={({ field }) => (
                  <FormItem><FormLabel>Role</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="engineer">Engineer</SelectItem>
                        <SelectItem value="operator">Operator</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="status" render={({ field }) => (
                  <FormItem><FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={updateUser.isPending}>{updateUser.isPending ? "Saving…" : "Save Changes"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
