import { useEffect, useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/auth-api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Level = "read" | "write" | "delete";
type Grant = Record<Level, boolean>;
const NONE: Grant = { read: false, write: false, delete: false };

interface UserRow {
  id: string;
  fullName: string;
  username: string;
  role: string;
}

/**
 * Super Admin or Company Admin only: who else can reach this dashboard. The server is the control;
 * see lib/viz-access.ts in the API. A change is saved as soon as a box is clicked.
 */
export function ShareDashboardDialog({ node, onClose }: { node: { id: string; name: string }; onClose: () => void }) {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [grants, setGrants] = useState<Record<string, Grant>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [usersRes, sharesRes] = await Promise.all([
        apiFetch(`${BASE}/api/users`),
        apiFetch(`${BASE}/api/viz-nodes/${encodeURIComponent(node.id)}/shares`),
      ]);
      if (!usersRes.ok || !sharesRes.ok) throw new Error("load failed");
      const allUsers: UserRow[] = await usersRes.json();
      const body = await sharesRes.json();
      if (cancelled) return;
      setUsers(allUsers.filter((u) => u.role !== "super_admin" && u.role !== "company_admin"));
      setOwnerId(body.ownerId);
      setOwnerName(body.ownerName);
      setGrants(Object.fromEntries(body.shares.map((s: Grant & { userId: string }) => [s.userId, s])));
    })().catch(() => { if (!cancelled) setLoadError("Could not load access for this dashboard."); });
    return () => { cancelled = true; };
  }, [node.id]);

  async function toggle(user: UserRow, level: Level, on: boolean) {
    const previous = grants[user.id] ?? NONE;
    const next: Grant = { ...previous, [level]: on };
    // Mirrors the server rule: write and delete both need read, and removing read
    // removes all access.
    if (on && level !== "read") next.read = true;
    if (!on && level === "read") { next.write = false; next.delete = false; }

    setGrants((g) => ({ ...g, [user.id]: next }));
    try {
      const res = await apiFetch(`${BASE}/api/viz-nodes/${encodeURIComponent(node.id)}/shares/${user.id}`, {
        method: "PUT",
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "The server rejected the change.");
    } catch (e: any) {
      setGrants((g) => ({ ...g, [user.id]: previous }));
      toast({ title: "Access not changed", description: e?.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Share2 className="w-4 h-4 text-primary" /> Manage access: {node.name}</DialogTitle>
          <DialogDescription>
            Owner: {ownerName ?? "none"}. Access also applies to dashboards nested under this one. Changes save immediately.
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : !users ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left font-medium py-1.5">User</th>
                  <th className="font-medium w-14">Read</th>
                  <th className="font-medium w-14">Write</th>
                  <th className="font-medium w-14">Delete</th>
                </tr>
              </thead>
              <tbody>
                {users.filter((u) => u.id !== ownerId).map((u) => {
                  const grant = grants[u.id] ?? NONE;
                  return (
                    <tr key={u.id} className="border-b border-border/50">
                      <td className="py-1.5">
                        <div className="truncate">{u.fullName}</div>
                        <div className="text-xs text-muted-foreground truncate">{u.username}</div>
                      </td>
                      {(["read", "write", "delete"] as Level[]).map((level) => (
                        <td key={level} className="text-center">
                          <Checkbox
                            checked={grant[level]}
                            onCheckedChange={(v) => toggle(u, level, v === true)}
                            aria-label={`${level} access for ${u.fullName}`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
