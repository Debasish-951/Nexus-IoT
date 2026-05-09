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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Users as UsersIcon, Plus, Trash2, Pencil } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700",
  engineer: "bg-blue-100 text-blue-700",
  operator: "bg-green-100 text-green-700",
  viewer: "bg-gray-100 text-gray-700",
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  inactive: "bg-gray-100 text-gray-600",
  suspended: "bg-red-100 text-red-700",
};

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-primary" /> User Management
          </h1>
          <p className="text-sm text-muted-foreground">Manage platform users and roles</p>
        </div>
        {can("manage_users") && (
          <Button onClick={() => setCreateOpen(true)} size="sm" data-testid="add-user-btn">
            <Plus className="w-4 h-4 mr-1.5" /> Add User
          </Button>
        )}
      </div>
      <ReadOnlyBanner permission="manage_users" message="cannot create or delete users. Administrator role is required." />

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
