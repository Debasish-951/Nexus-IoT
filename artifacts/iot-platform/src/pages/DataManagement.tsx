import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/auth-api";
import { describeApiError, formatApiError } from "@/lib/validation";
import { useCurrentUser } from "@/contexts/UserContext";
import { RoleGuard } from "@/components/RoleGuard";
import {
  Database, HardDrive, Clock, Activity, Plus, Trash2, Play, Pencil,
  RefreshCw, Calendar, Rows3,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
interface StorageStats {
  telemetry: {
    totalRows: number;
    tableSize: string;
    oldestRecord: string | null;
    newestRecord: string | null;
  };
  perAsset: Array<{
    assetId: string;
    assetName: string;
    rows: number;
    metrics: number;
    oldest: string | null;
    newest: string | null;
  }>;
  generatedAt: string;
}

interface RetentionPolicy {
  id: string;
  name: string;
  assetId: string | null;
  metric: string | null;
  retentionDays: number;
  enabled: boolean;
  lastPrunedAt: string | null;
  rowsPruned: number;
  createdAt: string;
  updatedAt: string;
}

function StatCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 shrink-0">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className="text-lg font-semibold leading-tight mt-0.5 truncate">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PolicyDialog({
  open, onOpenChange, initial, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: RetentionPolicy | null;
  /** Resolves true when the server accepted the save; the dialog stays open otherwise. */
  onSave: (data: Partial<RetentionPolicy>) => Promise<boolean>;
}) {
  const [name, setName]             = useState(initial?.name ?? "");
  const [days, setDays]             = useState(String(initial?.retentionDays ?? 90));
  const [assetId, setAssetId]       = useState(initial?.assetId ?? "");
  const [metric, setMetric]         = useState(initial?.metric ?? "");
  const [enabled, setEnabled]       = useState(initial?.enabled ?? true);
  const [saving, setSaving]         = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const ok = await onSave({
        name, retentionDays: Number(days),
        assetId: assetId || null, metric: metric || null, enabled,
      });
      if (ok) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Retention Policy" : "New Retention Policy"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Policy Name</Label>
            <Input className="h-8 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 30-day raw data" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Retention (days)</Label>
            <Input type="number" min={1} className="h-8 text-sm" value={days} onChange={(e) => setDays(e.target.value)} />
            <p className="text-xs text-muted-foreground">Telemetry older than this many days will be permanently deleted.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Asset ID (optional)</Label>
              <Input className="h-8 text-sm font-mono" value={assetId} onChange={(e) => setAssetId(e.target.value)} placeholder="UUID or leave blank" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Metric (optional)</Label>
              <Input className="h-8 text-sm" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="e.g. temperature" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} id="policy-enabled" />
            <Label htmlFor="policy-enabled" className="text-xs">Enabled</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!name || !days || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DataManagement() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
  const [editPolicy, setEditPolicy]             = useState<RetentionPolicy | null>(null);
  const [pruning, setPruning]                   = useState(false);

  // The server requires manage_assets plus the reports module for every
  // retention write (see ROUTE_RULES for /system/retention in authorize.ts).
  const { canAction, session } = useCurrentUser();
  // Storage and retention cover every project, so the server refuses them to
  // project-restricted users; nothing is requested for them.
  const restricted = !!session?.restrictProjects;
  const canManageRetention = canAction("manage_assets", "reports") && !restricted;

  async function getJson<T>(path: string): Promise<T> {
    const r = await apiFetch(`${BASE}${path}`);
    if (!r.ok) throw new Error(formatApiError(await describeApiError(r)));
    return (await r.json()) as T;
  }

  async function reportFailure(title: string, r: Response) {
    toast({ title, description: formatApiError(await describeApiError(r)), variant: "destructive" });
  }

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<StorageStats>({
    queryKey: ["system/storage"],
    queryFn: () => getJson<StorageStats>("/api/system/storage"),
    refetchInterval: 30_000,
    enabled: !restricted,
  });

  const { data: policies = [], isLoading: policiesLoading, refetch: refetchPolicies } = useQuery<RetentionPolicy[]>({
    queryKey: ["system/retention"],
    queryFn: () => getJson<RetentionPolicy[]>("/api/system/retention"),
    enabled: !restricted,
  });

  async function handleSavePolicy(data: Partial<RetentionPolicy>): Promise<boolean> {
    const r = editPolicy
      ? await apiFetch(`${BASE}/api/system/retention/${editPolicy.id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        })
      : await apiFetch(`${BASE}/api/system/retention`, {
          method: "POST",
          body: JSON.stringify(data),
        });
    if (!r.ok) {
      await reportFailure(editPolicy ? "Could not update policy" : "Could not create policy", r);
      return false;
    }
    refetchPolicies();
    toast({ title: editPolicy ? "Policy updated" : "Policy created" });
    return true;
  }

  async function deletePolicy(id: string) {
    const r = await apiFetch(`${BASE}/api/system/retention/${id}`, { method: "DELETE" });
    if (!r.ok) {
      await reportFailure("Could not delete policy", r);
      return;
    }
    refetchPolicies();
    toast({ title: "Policy deleted" });
  }

  async function togglePolicy(policy: RetentionPolicy) {
    const r = await apiFetch(`${BASE}/api/system/retention/${policy.id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: !policy.enabled }),
    });
    if (!r.ok) {
      await reportFailure("Could not change policy", r);
      return;
    }
    refetchPolicies();
  }

  async function runPruneNow() {
    setPruning(true);
    try {
      const r = await apiFetch(`${BASE}/api/system/retention/run`, { method: "POST" });
      if (!r.ok) {
        await reportFailure("Pruning failed", r);
        return;
      }
      const result = await r.json();
      toast({
        title: "Pruning complete",
        description: `${result.totalRowsDeleted} rows deleted across ${result.policiesRun} policies.`,
      });
      refetchStats();
      refetchPolicies();
    } catch (err) {
      toast({ title: "Pruning failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setPruning(false);
    }
  }

  const totalRows   = stats?.telemetry.totalRows ?? 0;
  const tableSize   = stats?.telemetry.tableSize ?? "—";
  const oldestStr   = stats?.telemetry.oldestRecord
    ? formatDistanceToNow(new Date(stats.telemetry.oldestRecord), { addSuffix: true })
    : "—";
  const newestStr   = stats?.telemetry.newestRecord
    ? formatDistanceToNow(new Date(stats.telemetry.newestRecord), { addSuffix: true })
    : "—";

  if (restricted) {
    return (
      <div className="p-6 max-w-xl space-y-2">
        <h1 className="text-xl font-semibold">Data Management</h1>
        <p className="text-sm text-muted-foreground">Storage and data retention cover every project, so they are managed by administrators whose accounts are not limited to specific projects.</p>
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border bg-card flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            Data Management
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Storage statistics and retention policies for time-series data
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => { refetchStats(); refetchPolicies(); }}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          <RoleGuard permission="manage_assets" module="reports">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={runPruneNow} disabled={pruning}>
              <Play className="w-3.5 h-3.5" /> {pruning ? "Pruning…" : "Run Pruning Now"}
            </Button>
          </RoleGuard>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5 space-y-6">
        {/* Storage overview */}
        <section>
          <h2 className="text-sm font-medium mb-3">Storage Overview</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={Rows3}    label="Total Telemetry Rows" value={statsLoading ? "…" : totalRows.toLocaleString()} />
            <StatCard icon={HardDrive} label="Table Size"          value={statsLoading ? "…" : tableSize} />
            <StatCard icon={Clock}    label="Oldest Record"        value={statsLoading ? "…" : oldestStr} sub={stats?.telemetry.oldestRecord ? format(new Date(stats.telemetry.oldestRecord), "PPp") : undefined} />
            <StatCard icon={Activity} label="Most Recent"          value={statsLoading ? "…" : newestStr} sub={stats?.telemetry.newestRecord ? format(new Date(stats.telemetry.newestRecord), "PPp") : undefined} />
          </div>
        </section>

        {/* Per-asset breakdown */}
        {stats && stats.perAsset.length > 0 && (
          <section>
            <h2 className="text-sm font-medium mb-3">Per-Asset Breakdown</h2>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Asset</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Rows</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Metrics</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Oldest</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Newest</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.perAsset.sort((a, b) => b.rows - a.rows).map((row, i) => (
                    <tr key={row.assetId} className={i % 2 === 0 ? "bg-card" : "bg-muted/20"}>
                      <td className="px-3 py-2 font-medium">{row.assetName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.rows.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.metrics}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground hidden sm:table-cell">
                        {row.oldest ? format(new Date(row.oldest), "PP") : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground hidden sm:table-cell">
                        {row.newest ? format(new Date(row.newest), "PP") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Retention policies */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-medium">Retention Policies</h2>
              <p className="text-xs text-muted-foreground">Pruning runs automatically every hour. More specific policies (asset+metric) take precedence.</p>
            </div>
            <RoleGuard permission="manage_assets" module="reports">
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => { setEditPolicy(null); setPolicyDialogOpen(true); }}>
                <Plus className="w-3.5 h-3.5" /> Add Policy
              </Button>
            </RoleGuard>
          </div>

          {policiesLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading…</div>
          ) : policies.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-10 text-center">
              <Database className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium text-muted-foreground">No retention policies</p>
              <p className="text-xs text-muted-foreground mt-1">Add a policy to automatically prune old telemetry data.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {policies.map((policy) => (
                <div key={policy.id} className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3">
                  <Switch
                    checked={policy.enabled}
                    onCheckedChange={() => togglePolicy(policy)}
                    disabled={!canManageRetention}
                    className="shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{policy.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {policy.retentionDays}d
                      </Badge>
                      {policy.metric && (
                        <Badge variant="outline" className="text-xs font-mono">{policy.metric}</Badge>
                      )}
                      {!policy.enabled && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">Disabled</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {policy.assetId && (
                        <span className="text-xs text-muted-foreground font-mono">Asset: {policy.assetId.slice(0, 8)}…</span>
                      )}
                      {!policy.assetId && !policy.metric && (
                        <span className="text-xs text-muted-foreground">Applies to all assets & metrics</span>
                      )}
                      {policy.lastPrunedAt && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Last pruned {formatDistanceToNow(new Date(policy.lastPrunedAt), { addSuffix: true })}
                          {policy.rowsPruned > 0 && ` · ${policy.rowsPruned.toLocaleString()} rows total`}
                        </span>
                      )}
                      {!policy.lastPrunedAt && (
                        <span className="text-xs text-muted-foreground">Not yet run</span>
                      )}
                    </div>
                  </div>
                  {canManageRetention && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditPolicy(policy); setPolicyDialogOpen(true); }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => deletePolicy(policy.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Architecture note */}
        <section className="rounded-lg border border-border bg-muted/30 p-4">
          <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-primary" />
            Storage Architecture
          </h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Telemetry is stored in PostgreSQL with three composite indexes optimized for time-series queries: <code className="text-foreground bg-muted px-1 rounded font-mono">(asset_id, metric, timestamp)</code>, <code className="text-foreground bg-muted px-1 rounded font-mono">(asset_id, timestamp)</code>, and <code className="text-foreground bg-muted px-1 rounded font-mono">(timestamp)</code>.</li>
            <li>• Retention pruning runs automatically in the background every hour; you can also trigger it manually above.</li>
            <li>• Policies are evaluated most-specific-first: a policy with both Asset ID and Metric overrides one with only Asset ID or only Metric.</li>
            <li>• The aggregation endpoint (<code className="text-foreground bg-muted px-1 rounded font-mono">GET /api/system/aggregate</code>) buckets raw rows into time-averaged summaries (min/avg/max) for charting at any granularity.</li>
          </ul>
        </section>
      </div>

      <PolicyDialog
        open={policyDialogOpen}
        onOpenChange={(v) => { setPolicyDialogOpen(v); if (!v) setEditPolicy(null); }}
        initial={editPolicy}
        onSave={handleSavePolicy}
      />
    </div>
  );
}
