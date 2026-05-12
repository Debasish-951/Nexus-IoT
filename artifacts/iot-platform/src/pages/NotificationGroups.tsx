import { useState, useCallback } from "react";
import { Users, Plus, Trash2, Edit2, Mail, MessageCircle, Shield, X, UserCheck, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useListUsers } from "@workspace/api-client-react";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";

const GROUPS_KEY = "ws-notification-groups-v1";

interface NotificationGroup {
  id: string;
  name: string;
  description: string;
  memberUserIds: string[];
  emails: string[];
  whatsAppNumbers: string[];
  createdAt: string;
}

function loadGroups(): NotificationGroup[] {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "[]"); }
  catch { return []; }
}
function saveGroups(groups: NotificationGroup[]) {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
}

function TagInput({ values, onChange, placeholder, type = "text" }: {
  values: string[]; onChange: (v: string[]) => void; placeholder?: string; type?: string;
}) {
  const [input, setInput] = useState("");

  function add() {
    const v = input.trim();
    if (!v || values.includes(v)) { setInput(""); return; }
    onChange([...values, v]);
    setInput("");
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <Input
          className="h-8 text-xs flex-1"
          type={type}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={placeholder}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <Button size="sm" variant="outline" className="h-8 px-2.5" onClick={add} disabled={!input.trim()}>
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map(v => (
            <div key={v} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted border border-border">
              <span>{v}</span>
              <button onClick={() => onChange(values.filter(x => x !== v))} className="hover:text-destructive">
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface GroupDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: NotificationGroup | null;
  users: any[];
  onSave: (g: NotificationGroup) => void;
}

function GroupDialog({ open, onOpenChange, initial, users, onSave }: GroupDialogProps) {
  const [name,           setName]           = useState(initial?.name ?? "");
  const [description,    setDescription]    = useState(initial?.description ?? "");
  const [memberIds,      setMemberIds]      = useState<string[]>(initial?.memberUserIds ?? []);
  const [emails,         setEmails]         = useState<string[]>(initial?.emails ?? []);
  const [whatsAppNumbers,setWhatsAppNumbers]= useState<string[]>(initial?.whatsAppNumbers ?? []);
  const [userSearch,     setUserSearch]     = useState("");

  // Reset on open
  useState(() => {
    if (open) {
      setName(initial?.name ?? "");
      setDescription(initial?.description ?? "");
      setMemberIds(initial?.memberUserIds ?? []);
      setEmails(initial?.emails ?? []);
      setWhatsAppNumbers(initial?.whatsAppNumbers ?? []);
      setUserSearch("");
    }
  });

  function toggleMember(id: string) {
    setMemberIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  const filteredUsers = users.filter(u =>
    !userSearch || u.name?.toLowerCase().includes(userSearch.toLowerCase()) || u.username?.toLowerCase().includes(userSearch.toLowerCase())
  );

  function handleSave() {
    const group: NotificationGroup = {
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      description: description.trim(),
      memberUserIds: memberIds,
      emails,
      whatsAppNumbers,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    };
    onSave(group);
    onOpenChange(false);
  }

  const ROLE_COLORS: Record<string, string> = {
    admin: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    engineer: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    operator: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    viewer: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Group" : "New Notification Group"}</DialogTitle>
          <DialogDescription>
            Configure this group's members and contact channels for alarm notifications.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {/* Name */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Group Name *</Label>
            <Input className="h-9" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Maintenance Team, Night Shift" />
          </div>
          {/* Description */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Description (optional)</Label>
            <Textarea className="text-xs resize-none h-14" value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What this group is responsible for…" />
          </div>
          {/* Members */}
          <div className="space-y-2">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5" /> Platform Users
            </Label>
            <p className="text-[10px] text-muted-foreground">Select users who belong to this group.</p>
            {users.length > 0 && (
              <div className="relative mb-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input className="pl-7 h-7 text-xs" placeholder="Search users…"
                  value={userSearch} onChange={e => setUserSearch(e.target.value)} />
              </div>
            )}
            <div className="max-h-36 overflow-y-auto rounded border border-border divide-y divide-border/50">
              {filteredUsers.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground text-center">No users found</div>
              ) : filteredUsers.map((u: any) => (
                <div key={u.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => toggleMember(u.id)}>
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                    memberIds.includes(u.id) ? "bg-primary border-primary" : "border-border"}`}>
                    {memberIds.includes(u.id) && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium">{u.name}</span>
                    {u.username && <span className="text-[10px] text-muted-foreground ml-1.5">@{u.username}</span>}
                  </div>
                  <Badge className={`text-[9px] h-4 capitalize ${ROLE_COLORS[u.role] ?? ROLE_COLORS.viewer}`} variant="outline">
                    {u.role}
                  </Badge>
                </div>
              ))}
            </div>
            {memberIds.length > 0 && (
              <p className="text-[10px] text-muted-foreground">{memberIds.length} user{memberIds.length !== 1 ? "s" : ""} selected</p>
            )}
          </div>
          {/* Email */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> Email Addresses
            </Label>
            <p className="text-[10px] text-muted-foreground">Type an address and press Enter or + to add.</p>
            <TagInput values={emails} onChange={setEmails} placeholder="user@example.com" type="email" />
          </div>
          {/* WhatsApp */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp Numbers
            </Label>
            <p className="text-[10px] text-muted-foreground">Include country code, e.g. +12025550123. Press Enter or + to add.</p>
            <TagInput values={whatsAppNumbers} onChange={setWhatsAppNumbers} placeholder="+12025550123" type="tel" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!name.trim()}>
            {initial ? "Save Changes" : "Create Group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function NotificationGroups() {
  const { toast } = useToast();
  const { can } = useCurrentUser();
  const canManage = can("manage_users");

  const [groups,       setGroups]       = useState<NotificationGroup[]>(loadGroups);
  const [dialogOpen,   setDialogOpen]   = useState(false);
  const [editingGroup, setEditingGroup] = useState<NotificationGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NotificationGroup | null>(null);
  const [search,       setSearch]       = useState("");

  const { data: usersData } = useListUsers();
  const users = (usersData as any[] | undefined) ?? [];

  const persist = useCallback((next: NotificationGroup[]) => { setGroups(next); saveGroups(next); }, []);

  function handleSave(group: NotificationGroup) {
    const next = editingGroup
      ? groups.map(g => g.id === group.id ? group : g)
      : [...groups, group];
    persist(next);
    toast({ title: editingGroup ? "Group updated" : "Group created" });
    setEditingGroup(null);
  }

  function handleDelete(group: NotificationGroup) {
    persist(groups.filter(g => g.id !== group.id));
    toast({ title: `"${group.name}" deleted` });
    setDeleteTarget(null);
  }

  function getUserName(id: string) {
    return users.find((u: any) => u.id === id)?.name ?? id;
  }

  const filtered = groups.filter(g =>
    !search || g.name.toLowerCase().includes(search.toLowerCase()) || g.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Notification Groups
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Organise users into groups for alarm email and WhatsApp notifications.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => { setEditingGroup(null); setDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> New Group
          </Button>
        )}
      </div>

      <ReadOnlyBanner permission="manage_users" message="cannot create or edit notification groups." />

      {/* Stats bar */}
      {groups.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{groups.length} group{groups.length !== 1 ? "s" : ""}</span>
          <span>·</span>
          <span>{groups.reduce((s, g) => s + g.emails.length, 0)} email{groups.reduce((s, g) => s + g.emails.length, 0) !== 1 ? "s" : ""}</span>
          <span>·</span>
          <span>{groups.reduce((s, g) => s + g.whatsAppNumbers.length, 0)} WhatsApp number{groups.reduce((s, g) => s + g.whatsAppNumbers.length, 0) !== 1 ? "s" : ""}</span>
        </div>
      )}

      {groups.length > 3 && (
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input className="pl-8 h-8 text-xs" placeholder="Search groups…" value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
      )}

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-20 text-center">
          <Users className="w-10 h-10 mb-4 opacity-30 text-muted-foreground" />
          <p className="text-sm font-medium text-muted-foreground">No notification groups yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Create a group to organise users and contacts for alarm email and WhatsApp alerts.
          </p>
          {canManage && (
            <Button size="sm" className="mt-4" onClick={() => { setEditingGroup(null); setDialogOpen(true); }}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> New Group
            </Button>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">No groups match "{search}"</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(group => (
            <div key={group.id} className="rounded-lg border border-border bg-card shadow-sm hover:border-primary/30 transition-colors p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm truncate">{group.name}</h3>
                  {group.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{group.description}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      className="p-1.5 rounded hover:bg-muted transition-colors"
                      title="Edit"
                      onClick={() => { setEditingGroup(group); setDialogOpen(true); }}>
                      <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    <button
                      className="p-1.5 rounded hover:bg-red-500/10 transition-colors"
                      title="Delete"
                      onClick={() => setDeleteTarget(group)}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </button>
                  </div>
                )}
              </div>

              {/* Channels summary */}
              <div className="space-y-1.5">
                {group.memberUserIds.length > 0 && (
                  <div className="flex items-start gap-2">
                    <Shield className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex flex-wrap gap-1">
                      {group.memberUserIds.slice(0, 4).map(id => (
                        <Badge key={id} variant="secondary" className="text-[9px] h-4 px-1.5">
                          {getUserName(id)}
                        </Badge>
                      ))}
                      {group.memberUserIds.length > 4 && (
                        <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                          +{group.memberUserIds.length - 4}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                {group.emails.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">
                      {group.emails.length} email address{group.emails.length !== 1 ? "es" : ""}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 truncate">{group.emails[0]}</span>
                  </div>
                )}

                {group.whatsAppNumbers.length > 0 && (
                  <div className="flex items-center gap-2">
                    <MessageCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">
                      {group.whatsAppNumbers.length} WhatsApp number{group.whatsAppNumbers.length !== 1 ? "s" : ""}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">{group.whatsAppNumbers[0]}</span>
                  </div>
                )}

                {group.memberUserIds.length === 0 && group.emails.length === 0 && group.whatsAppNumbers.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No members or contacts yet</p>
                )}
              </div>

              {/* Footer: total recipients */}
              <div className="pt-2 border-t border-border/50 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {group.memberUserIds.length + group.emails.length + group.whatsAppNumbers.length} total recipients
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(group.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Group dialog */}
      <GroupDialog
        open={dialogOpen}
        onOpenChange={v => { setDialogOpen(v); if (!v) setEditingGroup(null); }}
        initial={editingGroup}
        users={users}
        onSave={handleSave}
      />

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Group</DialogTitle>
            <DialogDescription>
              Remove "{deleteTarget?.name}"? This cannot be undone and will remove the group from all alarm rule associations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => deleteTarget && handleDelete(deleteTarget)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
