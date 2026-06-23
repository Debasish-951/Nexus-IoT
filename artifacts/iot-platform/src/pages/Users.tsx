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
import {
  Users as UsersIcon, Plus, Trash2, Pencil,
  ShieldCheck, CheckCircle2, XCircle, RotateCcw, Info,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";

// ── Role colours ─────────────────────────────────────────────────────────────

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

// ── Access-control matrix definition ─────────────────────────────────────────

const MODULES = [
  { key: "dashboard",     label: "Dashboard" },
  { key: "assets",        label: "Assets" },
  { key: "alarms",        label: "Alarms" },
  { key: "brokers",       label: "Brokers" },
  { key: "api_clients",   label: "API Clients" },
  { key: "destinations",  label: "Destinations" },
  { key: "reports",       label: "Reports" },
  { key: "visualization", label: "Visualization" },
  { key: "live",          label: "Live Feed" },
  { key: "explorer",      label: "Data Explorer" },
  { key: "users",         label: "Users" },
  { key: "activity_log",  label: "Activity Log" },
] as const;

type ModuleKey = (typeof MODULES)[number]["key"];

/** Which modules each role can access by default */
const ROLE_DEFAULTS: Record<string, ModuleKey[]> = {
  admin:    ["dashboard","assets","alarms","brokers","api_clients","destinations","reports","visualization","live","explorer","users","activity_log"],
  engineer: ["dashboard","assets","alarms","brokers","destinations","reports","visualization","live","explorer","activity_log"],
  operator: ["dashboard","alarms","reports","visualization","live"],
  viewer:   ["dashboard","reports","visualization","live"],
};

// ── Override persistence (localStorage) ──────────────────────────────────────

const LS_KEY = "iot_access_overrides";
type Overrides = Record<string, Partial<Record<ModuleKey, boolean>>>;

function loadOverrides(): Overrides {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}"); } catch { return {}; }
}
function saveOverrides(o: Overrides) {
  localStorage.setItem(LS_KEY, JSON.stringify(o));
}

// ── AccessMatrix component ────────────────────────────────────────────────────

function AccessMatrix({ users, canEdit }: { users: any[]; canEdit: boolean }) {
  const [overrides, setOverrides] = useState<Overrides>(loadOverrides);

  function effectiveAccess(user: any, key: ModuleKey): boolean {
    const u = overrides[user.id];
    if (u && key in u) return u[key]!;
    return (ROLE_DEFAULTS[user.role] ?? []).includes(key);
  }

  function toggle(user: any, key: ModuleKey) {
    if (!canEdit) return;
    const current = effectiveAccess(user, key);
    const next: Overrides = {
      ...overrides,
      [user.id]: { ...(overrides[user.id] ?? {}), [key]: !current },
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

  return (
    <div className="space-y-3">
      {/* Legend + actions */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-green-100 border-2 border-green-400 inline-flex items-center justify-center">
              <CheckCircle2 className="w-3 h-3 text-green-600" />
            </span>
            Access granted
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-muted border-2 border-border inline-flex items-center justify-center">
              <XCircle className="w-3 h-3 text-muted-foreground/40" />
            </span>
            No access
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-green-100 border-2 border-green-400 ring-2 ring-amber-400 ring-offset-1 inline-flex items-center justify-center">
              <CheckCircle2 className="w-3 h-3 text-green-600" />
            </span>
            Overridden from role default
          </span>
        </div>
        {canEdit && anyOverrides && (
          <Button variant="ghost" size="sm" className="text-xs text-amber-600 hover:text-amber-800" onClick={resetAll}>
            <RotateCcw className="w-3 h-3 mr-1" /> Reset all overrides
          </Button>
        )}
      </div>

      {/* Info banner */}
      {canEdit && (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Click any cell to grant or revoke access for that user. Overrides are applied on top of the user's role defaults and highlighted with an amber ring.
        </div>
      )}

      {/* Matrix table */}
      <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
        <table className="w-full text-sm" style={{ minWidth: `${200 + MODULES.length * 96}px` }}>
          <thead>
            <tr className="border-b border-border bg-muted/60">
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider sticky left-0 bg-muted/60 min-w-[200px]">
                User / Role
              </th>
              {MODULES.map(m => (
                <th key={m.key} className="px-2 py-3 text-center font-semibold text-muted-foreground uppercase text-[10px] tracking-wider min-w-[80px]">
                  {m.label}
                </th>
              ))}
              {canEdit && (
                <th className="px-3 py-3 text-center font-semibold text-muted-foreground uppercase text-[10px] tracking-wider min-w-[70px]">
                  Reset
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={MODULES.length + (canEdit ? 2 : 1)} className="px-4 py-12 text-center text-muted-foreground">
                  <UsersIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No users found
                </td>
              </tr>
            ) : (
              users.map((user: any) => {
                const hasOverride = !!(overrides[user.id] && Object.keys(overrides[user.id]).length > 0);
                return (
                  <tr key={user.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors group">
                    {/* User info — sticky left col */}
                    <td className="px-4 py-3 sticky left-0 bg-card group-hover:bg-muted/20 transition-colors">
                      <div className="font-semibold text-foreground">{user.fullName}</div>
                      <div className="text-xs text-muted-foreground font-mono">{user.username}</div>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium mt-1 inline-block", ROLE_STYLES[user.role] ?? "bg-muted")}>
                        {user.role}
                      </span>
                    </td>

                    {/* Module toggles */}
                    {MODULES.map(m => {
                      const granted = effectiveAccess(user, m.key);
                      const isOverridden = !!(overrides[user.id] && m.key in overrides[user.id]);
                      return (
                        <td key={m.key} className="px-2 py-3 text-center">
                          <button
                            onClick={() => toggle(user, m.key)}
                            disabled={!canEdit}
                            title={
                              canEdit
                                ? granted ? `Revoke ${m.label} access` : `Grant ${m.label} access`
                                : granted ? "Access granted" : "No access"
                            }
                            className={cn(
                              "w-7 h-7 rounded-full inline-flex items-center justify-center transition-all duration-150",
                              canEdit ? "cursor-pointer hover:scale-110" : "cursor-default",
                              granted
                                ? "bg-green-100 text-green-600 border-2 border-green-400 hover:bg-green-200"
                                : "bg-muted text-muted-foreground/40 border-2 border-border hover:bg-muted/80",
                              isOverridden && "ring-2 ring-amber-400 ring-offset-1"
                            )}
                          >
                            {granted
                              ? <CheckCircle2 className="w-3.5 h-3.5" />
                              : <XCircle className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      );
                    })}

                    {/* Per-row reset */}
                    {canEdit && (
                      <td className="px-3 py-3 text-center">
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

      {/* Role defaults reference card */}
      <details className="rounded-lg border border-border bg-muted/30 text-xs">
        <summary className="px-4 py-2.5 cursor-pointer font-medium text-muted-foreground select-none hover:text-foreground transition-colors">
          Role defaults reference
        </summary>
        <div className="px-4 pb-4 pt-1 overflow-x-auto">
          <table className="w-full" style={{ minWidth: `${160 + MODULES.length * 80}px` }}>
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-1.5 font-medium text-muted-foreground pr-6">Role</th>
                {MODULES.map(m => (
                  <th key={m.key} className="py-1.5 text-center font-medium text-muted-foreground px-2 text-[10px] uppercase tracking-wider">
                    {m.label}
                  </th>
                ))}
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
                  {MODULES.map(m => {
                    const ok = ROLE_DEFAULTS[role].includes(m.key);
                    return (
                      <td key={m.key} className="py-1.5 text-center px-2">
                        {ok
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mx-auto" />
                          : <XCircle className="w-3.5 h-3.5 text-muted-foreground/30 mx-auto" />}
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
    createUser.mutate(
      { data },
      {
        onSuccess: () => {
          toast({ title: "User created" });
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          setCreateOpen(false);
          createForm.reset();
        },
        onError: () => toast({ title: "Failed to create user", variant: "destructive" }),
      }
    );
  }

  function openEdit(user: any) {
    setEditingUser(user);
    editForm.reset({
      fullName: user.fullName ?? "",
      email: user.email ?? "",
      role: user.role ?? "viewer",
      status: user.status ?? "active",
    });
    setEditOpen(true);
  }

  function onEditSubmit(data: any) {
    if (!editingUser) return;
    updateUser.mutate(
      { id: editingUser.id, data },
      {
        onSuccess: () => {
          toast({ title: "User updated" });
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          setEditOpen(false);
          setEditingUser(null);
        },
        onError: () => toast({ title: "Failed to update user", variant: "destructive" }),
      }
    );
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
          <p className="text-sm text-muted-foreground">Manage platform users, roles, and module access</p>
        </div>
        {can("manage_users") && (
          <Button onClick={() => setCreateOpen(true)} size="sm" data-testid="add-user-btn">
            <Plus className="w-4 h-4 mr-1.5" /> Add User
          </Button>
        )}
      </div>
      <ReadOnlyBanner permission="manage_users" message="cannot create or delete users. Administrator role is required." />

      {/* Tabs */}
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
                    <tr
                      key={user.id}
                      className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                      data-testid={`user-row-${user.id}`}
                    >
                      <td className="px-4 py-3 font-medium">{user.fullName}</td>
                      <td className="px-4 py-3 font-mono text-xs">{user.username}</td>
                      <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                      <td className="px-4 py-3">
                        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", ROLE_STYLES[user.role] ?? "bg-muted")}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", STATUS_STYLES[user.status] ?? "bg-muted")}>
                          {user.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {user.lastLogin ? format(new Date(user.lastLogin), "yyyy-MM-dd HH:mm") : "Never"}
                      </td>
                      <td className="px-4 py-3">
                        {can("manage_users") && (
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              className="text-muted-foreground hover:text-primary transition-colors"
                              onClick={() => openEdit(user)}
                              data-testid={`edit-user-${user.id}`}
                              title="Edit user"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              onClick={() =>
                                deleteUser.mutate(
                                  { id: user.id },
                                  {
                                    onSuccess: () => {
                                      toast({ title: "User deleted" });
                                      qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
                                    },
                                  }
                                )
                              }
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

        {/* ── Access Control tab ── */}
        <TabsContent value="access" className="mt-4">
          <div className="space-y-2 mb-4">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" /> Access Control Matrix
            </h2>
            <p className="text-sm text-muted-foreground">
              Role-based access matrix. Each role grants module visibility by default.
              {can("manage_users") && " As admin, you can override individual modules per user."}
            </p>
          </div>

          {!users ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
            </div>
          ) : (
            <AccessMatrix users={userList} canEdit={can("manage_users")} />
          )}
        </TabsContent>
      </Tabs>

      {/* Create User Dialog */}
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

      {/* Edit User Dialog */}
      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) setEditingUser(null); }}>
        <DialogContent data-testid="edit-user-dialog">
          <DialogHeader>
            <DialogTitle>Edit User — {editingUser?.fullName}</DialogTitle>
          </DialogHeader>
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
