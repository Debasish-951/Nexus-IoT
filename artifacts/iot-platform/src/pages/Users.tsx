import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListUsers, useListAssets,
  useCreateUser, useDeleteUser, useUpdateUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  Users as UsersIcon, Plus, Trash2, Pencil,
  ShieldCheck, RotateCcw, FolderOpen, LayoutDashboard, BarChart3, Settings2,
  ChevronRight, Mail, MailWarning, KeyRound, Unlock, Save, Loader2, Info, LogOut, Timer, Clock,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";
import { apiGet, apiPost, apiFetch } from "@/lib/auth-api";

// ── Styles ────────────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<string, string> = {
  super_admin:    "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  admin:          "bg-amber-100  text-amber-800  dark:bg-amber-900/40  dark:text-amber-300",
  customer_admin: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  engineer:       "bg-blue-100   text-blue-700   dark:bg-blue-900/40   dark:text-blue-300",
  operator:       "bg-green-100  text-green-700  dark:bg-green-900/40  dark:text-green-300",
  viewer:         "bg-slate-100  text-slate-600  dark:bg-slate-800     dark:text-slate-300",
};
const STATUS_STYLES: Record<string, string> = {
  active:    "bg-green-100  text-green-700  dark:bg-green-900/40  dark:text-green-300",
  invited:   "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  inactive:  "bg-slate-100  text-slate-600  dark:bg-slate-800     dark:text-slate-300",
  suspended: "bg-red-100    text-red-700    dark:bg-red-900/40    dark:text-red-300",
};

// ── Types (mirrors api-server/src/lib/rbac.ts, fetched at runtime) ────────────

type GranularPerm = { r: boolean; w: boolean; d: boolean };
type ModuleAccess = boolean | GranularPerm;
type ModuleDef = { key: string; label: string; type: "simple" | "granular" };

interface RbacCatalog {
  roles: { key: string; label: string; permissions: string[]; moduleDefaults: Record<string, ModuleAccess> }[];
  modules: ModuleDef[];
  analyticsOptions: { id: string; label: string }[];
}

type UserAccessConfig = {
  modules?: Record<string, ModuleAccess>;
  restrictProjects?: boolean;
  allowedProjects?: string[];
  restrictDashboards?: boolean;
  allowedDashboards?: string[];
  restrictAnalytics?: boolean;
  allowedAnalytics?: string[];
};

/**
 * The RBAC catalogue now comes from the API.
 *
 * It used to be two hard-coded constants in this file (MODULES, ROLE_DEFAULTS)
 * that only the browser knew about. Serving them means the circles rendered
 * here are the exact matrix the API enforces — the editor cannot promise access
 * the server will refuse, or vice versa.
 */
function useRbacCatalog() {
  return useQuery<RbacCatalog>({
    queryKey: ["rbac-catalog"],
    queryFn: async () => {
      const res = await apiGet("/api/security/rbac-catalog");
      if (!res.ok) throw new Error("Could not load the permission catalogue");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
}

// ── Cascade logic (unchanged) ─────────────────────────────────────────────────

function applyGranularToggle(current: GranularPerm, clicked: "r" | "w" | "d"): GranularPerm {
  const next = { ...current };
  if (clicked === "r") {
    next.r = !current.r;
    if (!next.r) { next.w = false; next.d = false; }
  } else if (clicked === "w") {
    next.w = !current.w;
    if (next.w) next.r = true;
    if (!next.w) next.d = false;
  } else {
    next.d = !current.d;
    if (next.d) { next.r = true; next.w = true; }
  }
  return next;
}

function effectiveModuleAccess(
  role: string, mod: ModuleDef, config: UserAccessConfig, catalog: RbacCatalog,
): ModuleAccess {
  if (config.modules && mod.key in config.modules) return config.modules[mod.key];
  const roleDef = catalog.roles.find((r) => r.key === role);
  return roleDef?.moduleDefaults[mod.key] ?? (mod.type === "granular" ? { r: false, w: false, d: false } : false);
}

// ── Small circle atoms (unchanged) ────────────────────────────────────────────

function SimpleCircle({ granted, canEdit, onClick, title, overridden }: {
  granted: boolean; canEdit: boolean; onClick: () => void; title: string; overridden: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={!canEdit} title={title} aria-pressed={granted}
      className={cn(
        "w-6 h-6 rounded-full transition-all duration-150 shrink-0",
        canEdit ? "cursor-pointer hover:scale-110" : "cursor-default",
        granted ? "bg-green-500" : "border-2 border-gray-300 bg-transparent",
        overridden && "ring-2 ring-amber-400 ring-offset-1"
      )}
    />
  );
}

function GranularRow({ value, canEdit, onToggle, overridden }: {
  value: GranularPerm; canEdit: boolean; onToggle: (p: "r" | "w" | "d") => void; overridden: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", overridden && "ring-2 ring-amber-400 ring-offset-1 rounded-full px-0.5 py-0.5")}>
      {(["r","w","d"] as const).map(p => (
        <button
          key={p}
          onClick={() => onToggle(p)} disabled={!canEdit}
          title={{ r: "Read", w: "Write (create + update)", d: "Delete" }[p]}
          aria-pressed={value[p]}
          className={cn(
            "w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center transition-all duration-150 select-none shrink-0",
            canEdit ? "cursor-pointer hover:scale-110" : "cursor-default",
            value[p] ? "bg-green-500 text-white" : "border-2 border-gray-300 text-gray-400 bg-transparent"
          )}
        >
          {p.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-muted/40 border-b border-border">
        <span className="text-primary">{icon}</span>
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ResourceSection({
  icon, title, allItems, restricted, allowedIds, canEdit,
  onToggleRestrict, onToggleItem, emptyText, allLabel,
}: {
  icon: React.ReactNode; title: string;
  allItems: { id: string; name: string }[];
  restricted: boolean; allowedIds: string[];
  canEdit: boolean;
  onToggleRestrict: (v: boolean) => void;
  onToggleItem: (id: string, checked: boolean) => void;
  emptyText: string; allLabel: string;
}) {
  return (
    <Section icon={icon} title={title}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {restricted ? `Choose which ${title.toLowerCase()} this user can access.` : allLabel}
          </p>
          {canEdit && (
            <div className="flex items-center gap-2 shrink-0 ml-4">
              <span className="text-xs text-muted-foreground">Restrict access</span>
              <Switch checked={restricted} onCheckedChange={onToggleRestrict} />
            </div>
          )}
        </div>

        {restricted && (
          allItems.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">{emptyText}</p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {allItems.map(item => (
                <label key={item.id} className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 border border-border/60 transition-colors select-none text-sm",
                  canEdit ? "cursor-pointer hover:bg-muted/30" : "cursor-default",
                  allowedIds.includes(item.id) && "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900/40"
                )}>
                  <Checkbox
                    checked={allowedIds.includes(item.id)}
                    onCheckedChange={(v) => onToggleItem(item.id, !!v)}
                    disabled={!canEdit}
                  />
                  <span>{item.name}</span>
                  {allowedIds.includes(item.id) && (
                    <span className="ml-auto text-[10px] text-green-600 font-medium">Allowed</span>
                  )}
                </label>
              ))}
            </div>
          )
        )}
      </div>
    </Section>
  );
}

// ── User detail panel ─────────────────────────────────────────────────────────

function UserDetailPanel({
  user, catalog, config, canEdit, dirty, saving,
  onUpdateModules, onUpdateConfig, onReset, onSave,
  projects, dashboards,
}: {
  user: any; catalog: RbacCatalog; config: UserAccessConfig; canEdit: boolean;
  dirty: boolean; saving: boolean;
  onUpdateModules: (key: string, val: ModuleAccess) => void;
  onUpdateConfig: (patch: Partial<UserAccessConfig>) => void;
  onReset: () => void;
  onSave: () => void;
  projects: { id: string; name: string }[];
  dashboards: { id: string; name: string }[];
}) {
  const hasOverrides = !!(config.modules && Object.keys(config.modules).length > 0);
  const isRestricted = !!(config.restrictProjects || config.restrictDashboards || config.restrictAnalytics);

  return (
    <div className="h-full flex flex-col">
      {/* User header */}
      <div className="px-5 py-4 border-b border-border bg-muted/20 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate">{user.fullName}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground font-mono">{user.username}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-xs text-muted-foreground truncate">{user.email}</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", ROLE_STYLES[user.role])}>
                {user.role}
              </span>
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", STATUS_STYLES[user.status])}>
                {user.status}
              </span>
            </div>
          </div>
          {canEdit && (hasOverrides || isRestricted) && (
            <button
              onClick={onReset}
              className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 transition-colors shrink-0"
            >
              <RotateCcw className="w-3 h-3" /> Reset all
            </button>
          )}
        </div>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <Section icon={<Settings2 className="w-4 h-4" />} title="Module Permissions">
          {!canEdit && (
            <p className="text-xs text-muted-foreground mb-3 italic">View only — the manage_users permission is required to edit.</p>
          )}
          <div className="space-y-1">
            {catalog.modules.map(mod => {
              const overridden = !!(config.modules && mod.key in config.modules);
              const access = effectiveModuleAccess(user.role, mod, config, catalog);

              return (
                <div
                  key={mod.key}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-md transition-colors",
                    overridden ? "bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/40" : "hover:bg-muted/20"
                  )}
                >
                  <span className="text-sm text-foreground">{mod.label}</span>
                  <div className="flex items-center gap-2">
                    {overridden && <span className="text-[10px] text-amber-600 font-medium">overridden</span>}
                    {mod.type === "simple" ? (
                      <SimpleCircle
                        granted={access as boolean}
                        canEdit={canEdit}
                        overridden={overridden}
                        title={canEdit ? ((access as boolean) ? `Revoke ${mod.label}` : `Grant ${mod.label}`) : ""}
                        onClick={() => onUpdateModules(mod.key, !(access as boolean))}
                      />
                    ) : (
                      <GranularRow
                        value={access as GranularPerm}
                        canEdit={canEdit}
                        overridden={overridden}
                        onToggle={(p) => onUpdateModules(mod.key, applyGranularToggle(access as GranularPerm, p))}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
            <p className="flex items-start gap-1.5">
              <span className="mt-1 w-2 h-2 rounded-full bg-amber-400 shrink-0 inline-block" />
              Amber = differs from the role default. Green filled = granted, grey outline = no access.
            </p>
            <p className="flex items-start gap-1.5">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              <span><strong>W</strong> covers create <em>and</em> update. These grants are enforced by the API,
              not just hidden in the UI.</span>
            </p>
          </div>
        </Section>

        <ResourceSection
          icon={<FolderOpen className="w-4 h-4" />}
          title="Project Access"
          allItems={projects}
          restricted={!!config.restrictProjects}
          allowedIds={config.allowedProjects ?? []}
          canEdit={canEdit}
          allLabel="This user can see all projects based on their role."
          emptyText="No projects found. Projects appear when assets with no parent are created."
          onToggleRestrict={(v) => onUpdateConfig({ restrictProjects: v, allowedProjects: v ? (config.allowedProjects ?? []) : [] })}
          onToggleItem={(id, checked) => {
            const cur = config.allowedProjects ?? [];
            onUpdateConfig({ allowedProjects: checked ? [...cur, id] : cur.filter(x => x !== id) });
          }}
        />

        <ResourceSection
          icon={<LayoutDashboard className="w-4 h-4" />}
          title="Visualization Dashboards"
          allItems={dashboards}
          restricted={!!config.restrictDashboards}
          allowedIds={config.allowedDashboards ?? []}
          canEdit={canEdit}
          allLabel="This user can view all dashboards their role permits."
          emptyText="No dashboards found. Create dashboards in the Visualization page."
          onToggleRestrict={(v) => onUpdateConfig({ restrictDashboards: v, allowedDashboards: v ? (config.allowedDashboards ?? []) : [] })}
          onToggleItem={(id, checked) => {
            const cur = config.allowedDashboards ?? [];
            onUpdateConfig({ allowedDashboards: checked ? [...cur, id] : cur.filter(x => x !== id) });
          }}
        />

        <ResourceSection
          icon={<BarChart3 className="w-4 h-4" />}
          title="Analytics & Reports"
          allItems={catalog.analyticsOptions.map(o => ({ id: o.id, name: o.label }))}
          restricted={!!config.restrictAnalytics}
          allowedIds={config.allowedAnalytics ?? []}
          canEdit={canEdit}
          allLabel="This user can access all analytics and report types their role permits."
          emptyText=""
          onToggleRestrict={(v) => onUpdateConfig({ restrictAnalytics: v, allowedAnalytics: v ? (config.allowedAnalytics ?? []) : [] })}
          onToggleItem={(id, checked) => {
            const cur = config.allowedAnalytics ?? [];
            onUpdateConfig({ allowedAnalytics: checked ? [...cur, id] : cur.filter(x => x !== id) });
          }}
        />
      </div>

      {/* Save bar — grants are persisted to the user record, not this browser. */}
      {canEdit && (
        <div className="shrink-0 border-t border-border bg-muted/20 px-5 py-3 flex items-center gap-3">
          <p className="text-[11px] text-muted-foreground flex-1">
            {dirty
              ? "Unsaved changes — these apply to the user everywhere, on every device."
              : "Saved to the user's account."}
          </p>
          <Button size="sm" onClick={onSave} disabled={!dirty || saving}>
            {saving
              ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</>
              : <><Save className="w-3.5 h-3.5 mr-1.5" /> Save access</>}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Access Control tab ────────────────────────────────────────────────────────

function AccessControlTab({ users, canEdit }: { users: any[]; canEdit: boolean }) {
  const { toast } = useToast();
  const { refresh, currentUser } = useCurrentUser();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserAccessConfig>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: catalog } = useRbacCatalog();
  const { data: allAssets = [] } = useListAssets() as { data: any[] };
  const { data: vizDashboards = [] } = useQuery<any[]>({
    queryKey: ["viz-dashboards"],
    queryFn: async () => {
      const res = await apiGet("/api/viz-dashboards");
      return res.ok ? res.json() : [];
    },
    staleTime: 30_000,
  });

  /**
   * Load the selected user's stored overrides.
   *
   * Previously this whole map lived in `localStorage["iot_access_v3"]`, so the
   * grants an admin set were invisible to the server, invisible to the user,
   * and lost when the admin switched browsers. They are now a column on the
   * user row and the API's authorisation input.
   */
  const { data: stored, isLoading: loadingAccess } = useQuery<{ overrides: UserAccessConfig }>({
    queryKey: ["user-access", selectedUserId],
    enabled: !!selectedUserId,
    queryFn: async () => {
      const res = await apiGet(`/api/users/${selectedUserId}/access`);
      if (!res.ok) throw new Error("Could not load this user's access");
      return res.json();
    },
  });

  useEffect(() => {
    setDraft(stored?.overrides ?? {});
    setDirty(false);
  }, [stored, selectedUserId]);

  const selectedUser = users.find(u => u.id === selectedUserId) ?? null;

  function updateConfig(patch: Partial<UserAccessConfig>) {
    setDraft(prev => ({ ...prev, ...patch }));
    setDirty(true);
  }

  function updateModule(key: string, val: ModuleAccess) {
    setDraft(prev => ({ ...prev, modules: { ...(prev.modules ?? {}), [key]: val } }));
    setDirty(true);
  }

  function resetUser() {
    setDraft({});
    setDirty(true);
  }

  async function save() {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      const csrf = document.cookie.split(";").find(c => c.trim().startsWith("is_csrf="))?.split("=")[1];
      const res = await apiFetch(`/api/users/${selectedUserId}/access`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {}),
        },
        body: JSON.stringify({ overrides: draft }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: body.error ?? "Could not save access", variant: "destructive" });
        return;
      }
      setDirty(false);
      toast({ title: "Access saved", description: "Applies immediately, on every device." });
      // Editing your own grants changes what this browser may render.
      if (selectedUserId === currentUser?.id) void refresh();
    } catch {
      toast({ title: "Network error — access not saved", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const projects = (allAssets as any[]).filter((a: any) => !a.parentId);
  const dashboards = (vizDashboards as any[]).map((d: any) => ({ id: d.id, name: d.name }));

  return (
    <div
      className="flex rounded-lg border border-border overflow-hidden shadow-sm"
      style={{ height: "calc(100vh - 230px)", minHeight: "520px" }}
    >
      {/* Left: user list */}
      <div className="w-52 shrink-0 border-r border-border flex flex-col bg-muted/10">
        <div className="px-3 py-2.5 bg-muted/50 border-b border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
          Users ({users.length})
        </div>
        <div className="flex-1 overflow-y-auto">
          {users.map(user => {
            const selected = user.id === selectedUserId;
            return (
              <button
                key={user.id}
                onClick={() => {
                  if (dirty && !window.confirm("Discard unsaved access changes?")) return;
                  setSelectedUserId(user.id);
                }}
                className={cn(
                  "w-full text-left px-3 py-3 border-b border-border/40 transition-colors relative",
                  selected
                    ? "bg-primary/8 border-l-2 border-l-primary"
                    : "hover:bg-muted/30 border-l-2 border-l-transparent"
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{user.fullName}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">{user.username}</div>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium mt-1 inline-block", ROLE_STYLES[user.role])}>
                      {user.role}
                    </span>
                  </div>
                  {selected && <ChevronRight className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: detail */}
      {!selectedUser || !catalog ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground bg-muted/5">
          <div className="text-center px-8">
            <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium text-foreground">
              {catalog ? "Select a user" : "Loading permission catalogue…"}
            </p>
            {catalog && (
              <p className="text-xs mt-1 text-muted-foreground">
                Click any user to configure their module permissions, project visibility,
                dashboard access, and analytics access.
              </p>
            )}
          </div>
        </div>
      ) : loadingAccess ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="flex-1 min-w-0 overflow-hidden">
          <UserDetailPanel
            user={selectedUser}
            catalog={catalog}
            config={draft}
            canEdit={canEdit}
            dirty={dirty}
            saving={saving}
            onUpdateModules={updateModule}
            onUpdateConfig={updateConfig}
            onReset={resetUser}
            onSave={save}
            projects={projects}
            dashboards={dashboards}
          />
        </div>
      )}
    </div>
  );
}

// ── Row actions ───────────────────────────────────────────────────────────────

/** Presets offered before issuing; the server caps anything above 24h. */
const TEMP_EXPIRY_PRESETS = [
  { minutes: 15, label: "15 minutes", hint: "Hand it over on a call" },
  { minutes: 60, label: "1 hour", hint: "Same working session" },
  { minutes: 240, label: "4 hours", hint: "Different shift" },
  { minutes: 1440, label: "24 hours", hint: "Longest allowed" },
];

/**
 * Asks how long the temporary password should live before issuing it.
 *
 * The window is the administrator's call: a credential read out over a phone call
 * wants minutes, one handed to a technician joining a later shift wants hours. The
 * server still caps it at 24 hours and enforces a 1-minute floor.
 */
function TemporaryPasswordExpiryDialog({ user, onCancel, onIssue }: {
  user: any; onCancel: () => void; onIssue: (minutes: number) => void;
}) {
  const [minutes, setMinutes] = useState(15);
  const [custom, setCustom] = useState("");

  const chosen = custom.trim() !== "" ? Number(custom) : minutes;
  const valid = Number.isInteger(chosen) && chosen >= 1 && chosen <= 1440;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="w-4 h-4" /> Temporary password for {user.fullName}
          </DialogTitle>
          <DialogDescription>
            How long should it stay usable? Their current password stops working immediately
            and every session of theirs is signed out.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {TEMP_EXPIRY_PRESETS.map((p) => {
              const active = custom.trim() === "" && minutes === p.minutes;
              return (
                <button key={p.minutes} type="button"
                  onClick={() => { setMinutes(p.minutes); setCustom(""); }}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    active ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50",
                  )}>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-[11px] text-muted-foreground">{p.hint}</p>
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Or a custom window (minutes)</Label>
            <Input type="number" min={1} max={1440} value={custom} placeholder="e.g. 45"
              onChange={(e) => setCustom(e.target.value)} className="h-9" />
            {custom.trim() !== "" && !valid && (
              <p className="text-[11px] text-destructive">Enter a whole number of minutes between 1 and 1440 (24 hours).</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={!valid} onClick={() => onIssue(chosen)}>
            Issue for {valid ? formatWindow(chosen) : "—"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatWindow(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Shows a freshly-issued temporary password exactly once.
 *
 * The server returns the cleartext in this one response and never stores it, so
 * there is no "show it again" — closing this dialog is the last chance to copy
 * it. The copy said here has to make that unambiguous.
 */
function TemporaryPasswordDialog({ result, onClose }: { result: any; onClose: () => void }) {
  const { toast } = useToast();
  const [remaining, setRemaining] = useState(() => new Date(result.expiresAt).getTime() - Date.now());

  useEffect(() => {
    const id = setInterval(() => setRemaining(new Date(result.expiresAt).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [result.expiresAt]);

  const expired = remaining <= 0;
  const mins = Math.max(0, Math.floor(remaining / 60_000));
  const secs = Math.max(0, Math.floor((remaining % 60_000) / 1000));
  // Long windows are now possible (up to 24h), so seconds only earn their place
  // in the last hour.
  const left = mins >= 60 ? formatWindow(mins) : `${mins}m ${secs}s`;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Temporary password for {result.username}
          </DialogTitle>
          <DialogDescription>
            Shown once and never stored. Copy it now — closing this dialog is your last chance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Password</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 select-all font-mono text-lg font-semibold tracking-wide">
                {result.temporaryPassword}
              </code>
              <Button size="sm" variant="outline" onClick={() => {
                navigator.clipboard?.writeText(result.temporaryPassword);
                toast({ title: "Copied to clipboard" });
              }}>Copy</Button>
            </div>
          </div>

          <div className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
            expired
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"
              : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300",
          )}>
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {expired
              ? "Expired — issue a new one."
              : <span>Expires in <strong className="tabular-nums">{left}</strong> ({format(new Date(result.expiresAt), "MMM d, HH:mm:ss")})</span>}
          </div>

          <p className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Signing in with this password unlocks <strong>nothing</strong> until the user
              sets their own — the API refuses every other endpoint. Deliver it over a channel
              you trust; it is a password, not a one-time link.
            </span>
          </p>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Done — I have copied it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserRowActions({ user, onDone }: { user: any; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [tempResult, setTempResult] = useState<any>(null);
  const [tempAskOpen, setTempAskOpen] = useState(false);

  async function issueTemporary(minutes: number) {
    setTempAskOpen(false);
    setBusy("temporary-password");
    try {
      const res = await apiPost(`/api/users/${user.id}/temporary-password`, { expiresInMinutes: minutes });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: body.error ?? "Could not issue a temporary password", variant: "destructive" });
        return;
      }
      setTempResult(body);
      onDone();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function call(action: string, label: string, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(action);
    try {
      const res = await apiPost(`/api/users/${user.id}/${action}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: body.error ?? `${label} failed`, variant: "destructive" });
        return;
      }
      // The email transport can fail without the action failing — say so
      // plainly rather than reporting a success the user never receives.
      toast({
        title: body.emailSent === false ? `${label} — but the email could not be sent` : label,
        description: body.emailSent === false
          ? "Check the Security Center for the delivery error, then retry."
          : undefined,
        variant: body.emailSent === false ? "destructive" : undefined,
      });
      onDone();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const Btn = ({ action, title, icon: Icon, onClick, className }: {
    action: string; title: string; icon: React.ElementType; onClick: () => void; className?: string;
  }) => (
    <button
      title={title} aria-label={title} onClick={onClick} disabled={busy !== null}
      className={cn("text-muted-foreground transition-colors disabled:opacity-40", className)}
    >
      {busy === action ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
    </button>
  );

  return (
    <>
      {user.status === "invited" && (
        <Btn action="resend-invitation" title="Resend activation email" icon={Mail}
          className="hover:text-violet-600"
          onClick={() => call("resend-invitation", "Invitation resent")} />
      )}
      {user.status !== "invited" && (
        <Btn action="send-password-reset" title="Email a password reset link" icon={KeyRound}
          className="hover:text-violet-600"
          onClick={() => call("send-password-reset", "Password reset email sent",
            `Send a password reset link to ${user.email}?`)} />
      )}
      {user.isLocked && (
        <Btn action="unlock" title="Unlock account" icon={Unlock}
          className="hover:text-emerald-600"
          onClick={() => call("unlock", "Account unlocked")} />
      )}
      <Btn action="temporary-password" title="Issue a temporary password" icon={Timer}
        className="hover:text-amber-600" onClick={() => setTempAskOpen(true)} />
      {tempAskOpen && (
        <TemporaryPasswordExpiryDialog user={user} onCancel={() => setTempAskOpen(false)} onIssue={issueTemporary} />
      )}
      {tempResult && <TemporaryPasswordDialog result={tempResult} onClose={() => setTempResult(null)} />}
    </>
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
  const { data: catalog } = useRbacCatalog();

  const { data: users } = useListUsers();
  const createUser  = useCreateUser();
  const deleteUser  = useDeleteUser();
  const updateUser  = useUpdateUser();

  const createForm = useForm({
    defaultValues: { username: "", email: "", fullName: "", role: "viewer" },
  });
  const editForm = useForm({
    defaultValues: { fullName: "", email: "", role: "viewer", status: "active" },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListUsersQueryKey() });

  const roleOptions = useMemo(
    () => catalog?.roles.map(r => ({ value: r.key, label: r.label }))
      ?? [{ value: "viewer", label: "Viewer" }],
    [catalog],
  );

  function onCreateSubmit(data: any) {
    createUser.mutate({ data }, {
      onSuccess: (created: any) => {
        toast({
          title: created?.invitationEmailSent === false
            ? "User created — but the invitation email failed"
            : "Invitation sent",
          description: created?.invitationEmailSent === false
            ? "Check the Security Center for the delivery error, then use Resend."
            : `${data.email} has been emailed an activation link.`,
          variant: created?.invitationEmailSent === false ? "destructive" : undefined,
        });
        invalidate();
        setCreateOpen(false);
        createForm.reset();
      },
      onError: (err: any) => toast({
        title: err?.data?.error ?? "Failed to create user",
        variant: "destructive",
      }),
    });
  }

  function openEdit(user: any) {
    setEditingUser(user);
    editForm.reset({
      fullName: user.fullName ?? "", email: user.email ?? "",
      role: user.role ?? "viewer", status: user.status ?? "active",
    });
    setEditOpen(true);
  }

  function onEditSubmit(data: any) {
    if (!editingUser) return;
    updateUser.mutate({ id: editingUser.id, data }, {
      onSuccess: () => {
        toast({ title: "User updated" });
        invalidate();
        setEditOpen(false);
        setEditingUser(null);
      },
      onError: (err: any) => toast({
        title: err?.data?.error ?? "Failed to update user",
        variant: "destructive",
      }),
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
          <p className="text-sm text-muted-foreground">Invite users, assign roles, and configure access permissions</p>
        </div>
        {can("manage_users") && (
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="w-4 h-4 mr-1.5" /> Invite User
          </Button>
        )}
      </div>
      <ReadOnlyBanner permission="manage_users" message="cannot invite or delete users. Administrator role is required." />

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users"><UsersIcon className="w-3.5 h-3.5 mr-1.5" /> User List</TabsTrigger>
          <TabsTrigger value="access"><ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Access Control</TabsTrigger>
        </TabsList>

        {/* ── User List ── */}
        <TabsContent value="users" className="mt-4">
          <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
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
                  {!users
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50">
                          {Array.from({ length: 7 }).map((__, j) => (
                            <td key={j} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>
                          ))}
                        </tr>
                      ))
                    : userList.length === 0
                    ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                          <UsersIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          No users found
                        </td>
                      </tr>
                    )
                    : userList.map((user: any) => (
                      <tr key={user.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">{user.fullName}</td>
                        <td className="px-4 py-3 font-mono text-xs">{user.username}</td>
                        <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                        <td className="px-4 py-3">
                          <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", ROLE_STYLES[user.role] ?? "bg-muted")}>
                            {user.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_STYLES[user.status] ?? "bg-muted")}>
                              {user.status}
                            </span>
                            {/* Onboarding state an admin has to act on. */}
                            {user.status === "invited" && user.invitationExpired && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                title="The activation link has expired — resend the invitation">
                                <MailWarning className="w-2.5 h-2.5" /> link expired
                              </span>
                            )}
                            {user.isLocked && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                title={`Locked after ${user.failedLoginAttempts} failed attempts`}>
                                locked
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {user.lastLogin ? format(new Date(user.lastLogin), "yyyy-MM-dd HH:mm") : "Never"}
                        </td>
                        <td className="px-4 py-3">
                          {can("manage_users") && (
                            <div className="flex items-center gap-2.5 justify-end">
                              <UserRowActions user={user} onDone={invalidate} />
                              <button
                                className="text-muted-foreground hover:text-primary transition-colors"
                                onClick={() => openEdit(user)} title="Edit user" aria-label="Edit user"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                className="text-muted-foreground hover:text-destructive transition-colors"
                                title="Delete user" aria-label="Delete user"
                                onClick={() => {
                                  if (!window.confirm(`Delete ${user.fullName}? Their sessions and pending invitations are removed. Security events are kept.`)) return;
                                  deleteUser.mutate({ id: user.id }, {
                                    onSuccess: () => { toast({ title: "User deleted" }); invalidate(); },
                                    onError: (err: any) => toast({
                                      title: err?.data?.error ?? "Failed to delete user", variant: "destructive",
                                    }),
                                  });
                                }}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              New users are created in <strong>invited</strong> status with no password and are emailed a
              single-use activation link. Administrators never see or set another user&apos;s password.
            </span>
          </p>
        </TabsContent>

        {/* ── Access Control ── */}
        <TabsContent value="access" className="mt-4">
          <div className="mb-3">
            <p className="text-sm text-muted-foreground">
              Click a user to configure module permissions, project visibility, dashboard access, and analytics access.
              Grants are stored on the user&apos;s account and enforced by the API.
            </p>
          </div>
          {!users
            ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
            : <AccessControlTab users={userList} canEdit={can("manage_users")} />
          }
        </TabsContent>
      </Tabs>

      {/* ── Invite dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>
              An activation link is emailed to the address below. The user sets their own password —
              you never see or choose it.
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
              <FormField control={createForm.control} name="fullName" rules={{ required: true }} render={({ field }) => (
                <FormItem><FormLabel>Full Name *</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={createForm.control} name="username" rules={{ required: true }} render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username *</FormLabel>
                    <FormControl><Input {...field} autoComplete="off" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={createForm.control} name="email" rules={{ required: true }} render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email *</FormLabel>
                    <FormControl><Input type="email" {...field} placeholder="person@company.com" /></FormControl>
                  </FormItem>
                )} />
              </div>
              <FormField control={createForm.control} name="role" render={({ field }) => (
                <FormItem><FormLabel>Role</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {roleOptions.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />

              <p className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
                <Mail className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  The user must already own this email address — the platform does not create mailboxes.
                  Fine-tune their module, dashboard, and analytics access on the <strong>Access Control</strong> tab
                  after inviting them.
                </span>
              </p>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createUser.isPending}>
                  {createUser.isPending
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Sending…</>
                    : <><Mail className="w-3.5 h-3.5 mr-1.5" /> Send invitation</>}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) setEditingUser(null); }}>
        <DialogContent>
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
                        {roleOptions.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="status" render={({ field }) => (
                  <FormItem><FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {/* `invited` is set by the system, not chosen here — an
                            account cannot be marked active without activating. */}
                        {editingUser?.status === "invited" && <SelectItem value="invited">Invited</SelectItem>}
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>

              <p className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
                <LogOut className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Suspending or deactivating a user revokes all their sessions immediately.
              </p>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={updateUser.isPending}>
                  {updateUser.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
