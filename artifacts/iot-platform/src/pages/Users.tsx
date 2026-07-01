import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListUsers, useListAssets,
  useCreateUser, useDeleteUser, useUpdateUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  Users as UsersIcon, Plus, Trash2, Pencil,
  ShieldCheck, RotateCcw, FolderOpen, LayoutDashboard, BarChart3, Settings2,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";

// ── Styles ────────────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<string, string> = {
  admin:    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  engineer: "bg-blue-100  text-blue-700  dark:bg-blue-900/40  dark:text-blue-300",
  operator: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  viewer:   "bg-slate-100 text-slate-600 dark:bg-slate-800    dark:text-slate-300",
};
const STATUS_STYLES: Record<string, string> = {
  active:    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  inactive:  "bg-slate-100 text-slate-600 dark:bg-slate-800   dark:text-slate-300",
  suspended: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

// ── Module definitions ────────────────────────────────────────────────────────

type GranularPerm = { r: boolean; w: boolean; d: boolean };
type ModuleAccess = boolean | GranularPerm;

const MODULES = [
  { key: "dashboard",     label: "Dashboard",       type: "simple"   },
  { key: "assets",        label: "Asset Management",type: "granular" },
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
] as const;

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

const ANALYTICS_OPTIONS = [
  { id: "telemetry_summary", label: "Telemetry Summary" },
  { id: "alarm_reports",     label: "Alarm Reports"     },
  { id: "asset_status",      label: "Asset Status Snapshots" },
  { id: "performance_kpi",   label: "Performance KPIs"  },
  { id: "trend_analysis",    label: "Trend Analysis"    },
  { id: "data_export",       label: "Data Export"       },
];

// ── Persistence ───────────────────────────────────────────────────────────────

const LS_KEY = "iot_access_v3";

type UserAccessConfig = {
  modules?: Record<string, ModuleAccess>;
  restrictProjects?: boolean;
  allowedProjects?: string[];
  restrictDashboards?: boolean;
  allowedDashboards?: string[];
  restrictAnalytics?: boolean;
  allowedAnalytics?: string[];
};
type AllOverrides = Record<string, UserAccessConfig>;

function loadOverrides(): AllOverrides {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}"); } catch { return {}; }
}
function saveOverrides(o: AllOverrides) {
  localStorage.setItem(LS_KEY, JSON.stringify(o));
}

// ── Cascade logic ─────────────────────────────────────────────────────────────

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

function effectiveModuleAccess(user: any, modKey: string, modType: string, config: UserAccessConfig): ModuleAccess {
  if (config.modules && modKey in config.modules) return config.modules[modKey];
  return ROLE_DEFAULTS[user.role]?.[modKey] ?? (modType === "granular" ? { r: false, w: false, d: false } : false);
}

// ── Small circle atoms ────────────────────────────────────────────────────────

function SimpleCircle({ granted, canEdit, onClick, title, overridden }: {
  granted: boolean; canEdit: boolean; onClick: () => void; title: string; overridden: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={!canEdit} title={title}
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
          title={{ r:"Read", w:"Write", d:"Delete" }[p]}
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

// ── Section card wrapper ──────────────────────────────────────────────────────

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

// ── Resource access section (projects / dashboards / analytics) ───────────────

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
            {restricted
              ? `Choose which ${title.toLowerCase()} this user can access.`
              : allLabel}
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
                  allowedIds.includes(item.id) && "bg-green-50 border-green-200"
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
  user, config, canEdit, onUpdateModules, onUpdateConfig, onReset,
  projects, dashboards,
}: {
  user: any; config: UserAccessConfig; canEdit: boolean;
  onUpdateModules: (key: string, val: ModuleAccess) => void;
  onUpdateConfig: (patch: Partial<UserAccessConfig>) => void;
  onReset: () => void;
  projects: { id: string; name: string }[];
  dashboards: { id: string; name: string }[];
}) {
  const hasOverrides = !!(config.modules && Object.keys(config.modules).length > 0);
  const isRestricted = !!(config.restrictProjects || config.restrictDashboards || config.restrictAnalytics);

  return (
    <div className="h-full flex flex-col">
      {/* User header */}
      <div className="px-5 py-4 border-b border-border bg-muted/20 shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">{user.fullName}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground font-mono">{user.username}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-xs text-muted-foreground">{user.email}</span>
            </div>
            <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium mt-2 inline-block", ROLE_STYLES[user.role])}>
              {user.role}
            </span>
          </div>
          {canEdit && (hasOverrides || isRestricted) && (
            <button
              onClick={onReset}
              className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Reset all
            </button>
          )}
        </div>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Module Permissions */}
        <Section icon={<Settings2 className="w-4 h-4" />} title="Module Permissions">
          {!canEdit && (
            <p className="text-xs text-muted-foreground mb-3 italic">View only — admin role required to edit.</p>
          )}
          <div className="space-y-1">
            {MODULES.map(mod => {
              const overridden = !!(config.modules && mod.key in config.modules);
              const access = effectiveModuleAccess(user, mod.key, mod.type, config);

              return (
                <div
                  key={mod.key}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-md transition-colors",
                    overridden ? "bg-amber-50 border border-amber-200" : "hover:bg-muted/20"
                  )}
                >
                  <span className="text-sm text-foreground">{mod.label}</span>
                  <div className="flex items-center gap-2">
                    {overridden && (
                      <span className="text-[10px] text-amber-600 font-medium">overridden</span>
                    )}
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
          <div className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <span className="mt-0.5 w-2 h-2 rounded-full bg-amber-400 shrink-0 inline-block" />
            Amber highlight = differs from role default. Circles: green filled = granted, grey outline = no access.
          </div>
        </Section>

        {/* Project Access */}
        <ResourceSection
          icon={<FolderOpen className="w-4 h-4" />}
          title="Project Access"
          allItems={projects}
          restricted={!!config.restrictProjects}
          allowedIds={config.allowedProjects ?? []}
          canEdit={canEdit}
          allLabel="This user can see all projects based on their role."
          emptyText="No projects found. Projects appear when assets with no parent are created."
          onToggleRestrict={(v) => onUpdateConfig({ restrictProjects: v, allowedProjects: v ? [] : undefined })}
          onToggleItem={(id, checked) => {
            const cur = config.allowedProjects ?? [];
            onUpdateConfig({ allowedProjects: checked ? [...cur, id] : cur.filter(x => x !== id) });
          }}
        />

        {/* Visualization / Dashboard Access */}
        <ResourceSection
          icon={<LayoutDashboard className="w-4 h-4" />}
          title="Visualization Dashboards"
          allItems={dashboards}
          restricted={!!config.restrictDashboards}
          allowedIds={config.allowedDashboards ?? []}
          canEdit={canEdit}
          allLabel="This user can view all dashboards their role permits."
          emptyText="No dashboards found. Create dashboards in the Visualization page."
          onToggleRestrict={(v) => onUpdateConfig({ restrictDashboards: v, allowedDashboards: v ? [] : undefined })}
          onToggleItem={(id, checked) => {
            const cur = config.allowedDashboards ?? [];
            onUpdateConfig({ allowedDashboards: checked ? [...cur, id] : cur.filter(x => x !== id) });
          }}
        />

        {/* Analytics Access */}
        <ResourceSection
          icon={<BarChart3 className="w-4 h-4" />}
          title="Analytics & Reports"
          allItems={ANALYTICS_OPTIONS}
          restricted={!!config.restrictAnalytics}
          allowedIds={config.allowedAnalytics ?? []}
          canEdit={canEdit}
          allLabel="This user can access all analytics and report types their role permits."
          emptyText=""
          onToggleRestrict={(v) => onUpdateConfig({ restrictAnalytics: v, allowedAnalytics: v ? [] : undefined })}
          onToggleItem={(id, checked) => {
            const cur = config.allowedAnalytics ?? [];
            onUpdateConfig({ allowedAnalytics: checked ? [...cur, id] : cur.filter(x => x !== id) });
          }}
        />

      </div>
    </div>
  );
}

// ── Access Control tab ────────────────────────────────────────────────────────

function AccessControlTab({ users, canEdit }: { users: any[]; canEdit: boolean }) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<AllOverrides>(loadOverrides);

  const { data: allAssets = [] } = useListAssets() as { data: any[] };
  const { data: vizDashboards = [] } = useQuery<any[]>({
    queryKey: ["viz-dashboards"],
    queryFn: () => fetch("/api/viz-dashboards").then(r => r.json()),
    staleTime: 30_000,
  });

  const projects = (allAssets as any[]).filter((a: any) => !a.parentId);
  const dashboards = (vizDashboards as any[]).map((d: any) => ({ id: d.id, name: d.name }));

  const selectedUser = users.find(u => u.id === selectedUserId) ?? null;
  const selectedConfig: UserAccessConfig = overrides[selectedUserId ?? ""] ?? {};

  function updateConfig(patch: Partial<UserAccessConfig>) {
    if (!selectedUserId) return;
    const next: AllOverrides = {
      ...overrides,
      [selectedUserId]: { ...selectedConfig, ...patch },
    };
    setOverrides(next);
    saveOverrides(next);
  }

  function updateModule(key: string, val: ModuleAccess) {
    updateConfig({ modules: { ...(selectedConfig.modules ?? {}), [key]: val } });
  }

  function resetUser(userId: string) {
    const next = { ...overrides };
    delete next[userId];
    setOverrides(next);
    saveOverrides(next);
  }

  return (
    <div
      className="flex rounded-lg border border-border overflow-hidden shadow-sm"
      style={{ height: "calc(100vh - 230px)", minHeight: "520px" }}
    >
      {/* ── Left: user list sidebar ── */}
      <div className="w-52 shrink-0 border-r border-border flex flex-col bg-muted/10">
        <div className="px-3 py-2.5 bg-muted/50 border-b border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
          Users ({users.length})
        </div>
        <div className="flex-1 overflow-y-auto">
          {users.map(user => {
            const selected = user.id === selectedUserId;
            const hasOverride = !!overrides[user.id];
            return (
              <button
                key={user.id}
                onClick={() => setSelectedUserId(user.id)}
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
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {selected && <ChevronRight className="w-3.5 h-3.5 text-primary mt-0.5" />}
                    {hasOverride && (
                      <span className="w-2 h-2 rounded-full bg-amber-400 mt-1" title="Has custom permissions" />
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="px-3 py-2.5 border-t border-border text-[10px] text-muted-foreground bg-muted/20 shrink-0">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block mr-1" />
          = custom permissions
        </div>
      </div>

      {/* ── Right: detail panel ── */}
      {!selectedUser ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground bg-muted/5">
          <div className="text-center px-8">
            <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium text-foreground">Select a user</p>
            <p className="text-xs mt-1 text-muted-foreground">
              Click any user on the left to view and configure their access permissions, project visibility, dashboards, and analytics access.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-w-0 overflow-hidden">
          <UserDetailPanel
            user={selectedUser}
            config={selectedConfig}
            canEdit={canEdit}
            onUpdateModules={updateModule}
            onUpdateConfig={updateConfig}
            onReset={() => resetUser(selectedUser.id)}
            projects={projects}
            dashboards={dashboards}
          />
        </div>
      )}
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
  const createUser  = useCreateUser();
  const deleteUser  = useDeleteUser();
  const updateUser  = useUpdateUser();

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-primary" /> User Management
          </h1>
          <p className="text-sm text-muted-foreground">Manage platform users, roles, and access permissions</p>
        </div>
        {can("manage_users") && (
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="w-4 h-4 mr-1.5" /> Add User
          </Button>
        )}
      </div>
      <ReadOnlyBanner permission="manage_users" message="cannot create or delete users. Administrator role is required." />

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">
            <UsersIcon className="w-3.5 h-3.5 mr-1.5" /> User List
          </TabsTrigger>
          <TabsTrigger value="access">
            <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Access Control
          </TabsTrigger>
        </TabsList>

        {/* ── User List tab ── */}
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
                            <button
                              className="text-muted-foreground hover:text-primary transition-colors"
                              onClick={() => openEdit(user)} title="Edit user"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              onClick={() => deleteUser.mutate({ id: user.id }, {
                                onSuccess: () => { toast({ title: "User deleted" }); qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); },
                              })}
                              title="Delete user"
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
        </TabsContent>

        {/* ── Access Control tab ── */}
        <TabsContent value="access" className="mt-4">
          <div className="mb-3">
            <p className="text-sm text-muted-foreground">
              Click a user to configure their module permissions, project visibility, dashboard access, and analytics access.
            </p>
          </div>
          {!users
            ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
            : <AccessControlTab users={userList} canEdit={can("manage_users")} />
          }
        </TabsContent>
      </Tabs>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
              <FormField control={createForm.control} name="fullName" render={({ field }) => (
                <FormItem><FormLabel>Full Name *</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={createForm.control} name="username" render={({ field }) => (
                  <FormItem><FormLabel>Username *</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={createForm.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>Email *</FormLabel><FormControl><Input type="email" {...field} /></FormControl></FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={createForm.control} name="role" render={({ field }) => (
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
                <FormField control={createForm.control} name="password" render={({ field }) => (
                  <FormItem><FormLabel>Password *</FormLabel><FormControl><Input type="password" {...field} /></FormControl></FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createUser.isPending}>Create</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
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
