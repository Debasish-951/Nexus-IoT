import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RetentionPolicy, RetentionRunRecord } from "@workspace/api-client-react";
import { format, formatDistanceStrict } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RoleGuard } from "@/components/RoleGuard";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/UserContext";
import { useMetricChoices } from "@/features/dashboards/useWidgetData";
import { Plus, Trash2, Pencil, Database, AlertTriangle, CheckCircle2, Download, ShieldCheck, Eraser, Check, X, Clock } from "lucide-react";
import { ALL, PolicyDialog, PreviewBox, postPreview, useAssetPaths } from "./policy";
import { Section, Table, ErrorLine, ago, download, fmtCount, getJson, send, td, tdr, th, thr, whole } from "./shared";

export interface ChangeRequest {
  id: string; kind: string; summary: string; estimatedRows: number; status: string;
  requestedBy: string | null; requestedById: string | null; requestedAt: string;
  decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; rowsDeleted: number | null; error: string | null;
  payload: Record<string, unknown>;
}
interface Hold { id: string; name: string; reason: string | null; assetId: string | null; metric: string | null; fromTs: string | null; toTs: string | null; createdBy: string | null; createdAt: string; expiresAt: string | null; releasedAt: string | null; releasedBy: string | null }

const KIND_LABEL: Record<string, string> = { range_delete: "Remove bad data", manual_prune: "Run pruning now", policy_change: "Policy change" };

function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RetentionTab({ operational, pruneWindow, onChanged }: {
  operational: Array<{ key: string; label: string; env: string; days: number }>;
  pruneWindow?: { enabled: boolean; start: string; end: string };
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { canAction, session } = useCurrentUser();
  const canManage = canAction("manage_assets", "data_management");
  const assets = useAssetPaths();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RetentionPolicy | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RetentionPolicy | null>(null);
  const [badOpen, setBadOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [showReleased, setShowReleased] = useState(false);

  const policies = useQuery({ queryKey: ["system/retention"], queryFn: () => getJson<RetentionPolicy[]>("/api/system/retention"), retry: 1 });
  const runs = useQuery({ queryKey: ["system/retention/runs"], queryFn: () => getJson<RetentionRunRecord[]>("/api/system/retention/runs"), refetchInterval: 60_000, retry: 1 });
  const changes = useQuery({ queryKey: ["system/changes"], queryFn: () => getJson<ChangeRequest[]>("/api/system/changes"), refetchInterval: 30_000, retry: 1 });
  const holds = useQuery({ queryKey: ["system/holds"], queryFn: () => getJson<Hold[]>("/api/system/holds"), retry: 1 });
  const deletePreview = useQuery({
    queryKey: ["system/retention/preview", "remove", confirmDelete?.id],
    queryFn: () => postPreview({ removeId: confirmDelete!.id }), enabled: !!confirmDelete, retry: false,
  });

  function refresh() {
    for (const k of ["system/retention", "system/retention/runs", "system/changes", "system/holds", "system/retention/preview", "system/storage"]) qc.invalidateQueries({ queryKey: [k] });
    onChanged();
  }

  async function act(fn: () => Promise<{ status: number; data: unknown }>, ok: string, pendingMsg = "Sent for approval: a second administrator must approve it under Retention > Waiting for approval.") {
    try {
      const r = await fn();
      const pending = r.status === 202 && (r.data as { pendingApproval?: boolean })?.pendingApproval;
      toast({ title: pending ? "Waiting for approval" : ok, description: pending ? pendingMsg : undefined });
      refresh();
      return true;
    } catch (err) {
      toast({ title: "Not done", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      return false;
    }
  }

  const savePolicy = (data: Partial<RetentionPolicy>) =>
    act(() => editing ? send("PUT", `/api/system/retention/${editing.id}`, data) : send("POST", "/api/system/retention", data), editing ? "Policy updated" : "Policy created");

  const pending = (changes.data ?? []).filter((c) => c.status === "pending");
  const decided = (changes.data ?? []).filter((c) => c.status !== "pending").slice(0, 15);
  const holdList = (holds.data ?? []).filter((h) => showReleased || !h.releasedAt);
  const policyList = policies.data ?? [];

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <Section title={`Waiting for approval (${pending.length})`} hint="Deletions above the approval limit. Another administrator approves or rejects; the requester can withdraw.">
          <div className="space-y-2">
            {pending.map((c) => {
              const mine = !!c.requestedById && c.requestedById === session?.id;
              return (
                <div key={c.id} className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 flex items-center gap-3 flex-wrap">
                  <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                  <div className="flex-1 min-w-0 text-xs">
                    <p className="text-sm font-medium">{KIND_LABEL[c.kind] ?? c.kind}: {c.summary}</p>
                    <p className="text-muted-foreground">About {fmtCount(c.estimatedRows)} readings · requested by {c.requestedBy ?? "?"} {ago(c.requestedAt)}{typeof c.payload?.reason === "string" ? ` · reason: ${c.payload.reason}` : ""}</p>
                  </div>
                  {canManage && (
                    <div className="flex gap-1.5">
                      {!mine && <Button size="sm" className="h-7 text-xs gap-1 bg-red-600 hover:bg-red-700" onClick={() => act(() => send("POST", `/api/system/changes/${c.id}/approve`, {}), "Approved and carried out")}><Check className="w-3.5 h-3.5" /> Approve</Button>}
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => act(() => send("POST", `/api/system/changes/${c.id}/reject`, {}), mine ? "Request withdrawn" : "Request rejected")}><X className="w-3.5 h-3.5" /> {mine ? "Withdraw" : "Reject"}</Button>
                    </div>
                  )}
                  {mine && <span className="text-[11px] text-muted-foreground w-full">You made this request, so another administrator has to approve it.</span>}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Retention policies"
        hint={`The pruning run deletes readings older than these periods every hour${pruneWindow?.enabled ? `, only between ${pruneWindow.start} and ${pruneWindow.end} (plant time)` : ""}. The most specific policy decides: asset and metric, then asset, then metric, then all.`}
        action={
          <RoleGuard permission="manage_assets" module="data_management">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setBadOpen(true)}><Eraser className="w-3.5 h-3.5" /> Remove bad data</Button>
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="w-3.5 h-3.5" /> Add policy</Button>
            </div>
          </RoleGuard>
        }>
        {policies.isError ? <ErrorLine error={policies.error} onRetry={() => policies.refetch()} /> : policies.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p> : policyList.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-8 text-center">
            <Database className="w-7 h-7 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium text-muted-foreground">No retention policies</p>
            <p className="text-xs text-muted-foreground mt-1">Every reading is kept for ever. A common start is one policy for all assets, for example 180 days.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {policyList.map((p) => (
              <div key={p.id} className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3">
                <Switch checked={p.enabled} onCheckedChange={() => act(() => send("PUT", `/api/system/retention/${p.id}`, { enabled: !p.enabled }), p.enabled ? "Policy disabled" : "Policy enabled")} disabled={!canManage} className="shrink-0" aria-label={p.enabled ? "Disable policy" : "Enable policy"} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{p.name}</span>
                    <Badge variant="secondary" className="text-xs">Keep {p.retentionDays} days</Badge>
                    {!p.enabled && <Badge variant="outline" className="text-xs text-muted-foreground">Disabled</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
                    <span>{assets.pathOf(p.assetId)}{p.metric ? ` · ${p.metric}` : " · all metrics"}</span>
                    <span>{p.lastPrunedAt ? `Last run ${ago(p.lastPrunedAt)} · ${whole.format(p.rowsPruned)} deleted in total` : "Not run yet"}</span>
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Edit policy" onClick={() => { setEditing(p); setDialogOpen(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" aria-label="Delete policy" onClick={() => setConfirmDelete(p)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Legal holds" hint="Readings under a hold are never deleted: not by pruning, not by bad-data removal. Use them for incidents, audits and disputes."
        action={
          <div className="flex items-center gap-3">
            <label className="text-xs flex items-center gap-1.5 text-muted-foreground"><Switch checked={showReleased} onCheckedChange={setShowReleased} className="scale-75" /> Show released</label>
            <RoleGuard permission="manage_assets" module="data_management">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setHoldOpen(true)}><ShieldCheck className="w-3.5 h-3.5" /> Add hold</Button>
            </RoleGuard>
          </div>
        }>
        {holds.isError ? <ErrorLine error={holds.error} onRetry={() => holds.refetch()} /> : (
          <Table empty={holdList.length === 0 && (holds.isLoading ? "Loading…" : "No active holds.")} head={
            <tr><th className={th}>Name</th><th className={th}>Covers</th><th className={th}>Period</th><th className={th}>Placed</th><th className={th}>Status</th><th className={th}></th></tr>
          }>
            {holdList.map((h) => (
              <tr key={h.id}>
                <td className={td}><div className="font-medium">{h.name}</div>{h.reason && <div className="text-muted-foreground">{h.reason}</div>}</td>
                <td className={td}>{assets.pathOf(h.assetId)}{h.metric ? ` · ${h.metric}` : ""}</td>
                <td className={td}>{h.fromTs ? format(new Date(h.fromTs), "PPp") : "any time"} – {h.toTs ? format(new Date(h.toTs), "PPp") : "now and later"}</td>
                <td className={td}>{h.createdBy ?? "?"}, {ago(h.createdAt)}{h.expiresAt && !h.releasedAt ? <div className="text-muted-foreground">ends {format(new Date(h.expiresAt), "PP")}</div> : null}</td>
                <td className={td}>{h.releasedAt ? <span className="text-muted-foreground">Released {ago(h.releasedAt)}{h.releasedBy ? ` by ${h.releasedBy}` : ""}</span> : <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><ShieldCheck className="w-3 h-3" /> Active</span>}</td>
                <td className={tdr}>{!h.releasedAt && canManage && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => act(() => send("POST", `/api/system/holds/${h.id}/release`), "Hold released")}>Release</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Pruning history" hint="The hourly run and every manual run, newest first. Download a run as CSV for your records.">
        {runs.isError ? <ErrorLine error={runs.error} onRetry={() => runs.refetch()} /> : (
          <Table empty={(runs.data ?? []).length === 0 && (runs.isLoading ? "Loading…" : "No runs recorded yet. The first hourly run appears within an hour of the server starting.")} head={
            <tr><th className={th}>When</th><th className={th}>Run by</th><th className={thr}>Readings deleted</th><th className={`${thr} hidden md:table-cell`}>Other records</th><th className={`${thr} hidden md:table-cell`}>Took</th><th className={th}>Result</th><th className={th}></th></tr>
          }>
            {(runs.data ?? []).slice(0, 25).map((r) => {
              const other = Object.values(r.operational ?? {}).reduce((n, v) => n + (Number(v) || 0), 0);
              const note = (r.details as Array<{ note?: string }> | undefined)?.find((d) => d.note && !("rowsDeleted" in d))?.note;
              return (
                <tr key={r.id}>
                  <td className={td} title={format(new Date(r.startedAt), "PPpp")}>{ago(r.startedAt)}</td>
                  <td className={td}>{r.trigger === "manual" ? `${r.username ?? "someone"} (manual)` : "Hourly job"}</td>
                  <td className={tdr}>{whole.format(r.telemetryDeleted)}</td>
                  <td className={`${tdr} hidden md:table-cell`} title={Object.entries(r.operational ?? {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k}: ${v}`).join(", ") || undefined}>{whole.format(other)}</td>
                  <td className={`${tdr} text-muted-foreground hidden md:table-cell`}>{r.finishedAt ? formatDistanceStrict(new Date(r.finishedAt), new Date(r.startedAt)) : "—"}</td>
                  <td className={td}>
                    {r.error ? <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400" title={r.error}><AlertTriangle className="w-3 h-3" /> Problem</span>
                      : note ? <span className="text-muted-foreground" title={note}>Skipped (window)</span>
                      : <span className="inline-flex items-center gap-1 text-muted-foreground"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> OK</span>}
                  </td>
                  <td className={tdr}><Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Download report" title="Download report (CSV)" onClick={() => download(`/api/system/retention/runs/${r.id}/report`, "pruning-run.csv").catch((e) => toast({ title: "Download failed", description: String(e), variant: "destructive" }))}><Download className="w-3.5 h-3.5" /></Button></td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>

      {decided.length > 0 && (
        <Section title="Bad-data removals and approvals" hint="Requests that were carried out, rejected or failed.">
          <Table head={<tr><th className={th}>When</th><th className={th}>What</th><th className={th}>Requested</th><th className={th}>Decided</th><th className={thr}>Deleted</th><th className={th}>Result</th></tr>}>
            {decided.map((c) => (
              <tr key={c.id}>
                <td className={td}>{ago(c.requestedAt)}</td>
                <td className={td}><div className="font-medium">{KIND_LABEL[c.kind] ?? c.kind}</div><div className="text-muted-foreground">{c.summary}</div></td>
                <td className={td}>{c.requestedBy ?? "?"}</td>
                <td className={td}>{c.decidedBy ? `${c.decidedBy}${c.decisionNote ? `: ${c.decisionNote}` : ""}` : "under the limit, no approval needed"}</td>
                <td className={tdr}>{c.rowsDeleted != null ? whole.format(c.rowsDeleted) : "—"}</td>
                <td className={td}>{c.status === "done" ? <span className="text-emerald-600 dark:text-emerald-400">Done</span> : c.status === "failed" ? <span className="text-red-500" title={c.error ?? undefined}>Failed</span> : <span className="text-muted-foreground capitalize">{c.status}</span>}</td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      <Section title="Other records" hint="Deleted by age in the same hourly run. Periods marked with an environment variable are set in the server's .env file (restart the API after a change); the others on the Settings tab.">
        <div className="rounded-lg border border-border divide-y divide-border">
          {operational.map((o) => (
            <div key={o.key} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
              <span className="font-medium">{o.label}</span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{o.days === 0 ? "Kept for ever" : `${whole.format(o.days)} days`}</span>
                <code className="text-[11px] text-muted-foreground font-mono hidden sm:inline">{o.env}</code>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <PolicyDialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null); }} initial={editing} onSave={savePolicy} />
      <BadDataDialog open={badOpen} onOpenChange={setBadOpen} onDone={refresh} />
      <HoldDialog open={holdOpen} onOpenChange={setHoldOpen} onDone={refresh} />

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => { if (!v) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the policy "{confirmDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Readings it covered fall back to the next less specific policy, or are kept for ever if there is none. Readings already deleted do not come back.</p>
                <PreviewBox preview={deletePreview.data} loading={deletePreview.isFetching} error={deletePreview.error ? (deletePreview.error as Error).message : undefined} />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => { const p = confirmDelete; setConfirmDelete(null); if (p) void act(() => send("DELETE", `/api/system/retention/${p.id}`), "Policy deleted"); }}>Delete policy</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Remove bad data ───────────────────────────────────────────────────────────
function BadDataDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const { toast } = useToast();
  const assets = useAssetPaths();
  const [assetId, setAssetId] = useState("");
  const [metric, setMetric] = useState("");
  const [from, setFrom] = useState(localInput(new Date(Date.now() - 3_600_000)));
  const [to, setTo] = useState(localInput(new Date()));
  const [reason, setReason] = useState("");
  const [includeSummaries, setIncludeSummaries] = useState(true);
  const [busy, setBusy] = useState(false);
  const metrics = useMetricChoices(assetId || undefined);
  useEffect(() => { if (open) { setReason(""); setBusy(false); } }, [open]);
  const body = assetId && from && to ? { assetId, metric: metric || null, from: new Date(from).toISOString(), to: new Date(to).toISOString(), includeSummaries, reason: reason.trim() || "preview" } : null;
  const valid = !!body && new Date(from) < new Date(to);
  const preview = useQuery({
    queryKey: ["system/changes/range-preview", body && { ...body, reason: "" }],
    queryFn: () => send<{ rows: number; heldBy: string | null; needsApproval: boolean }>("POST", "/api/system/changes/range-preview", body).then((r) => r.data),
    enabled: open && valid, retry: false,
  });
  async function submit() {
    setBusy(true);
    try {
      const r = await send<{ pendingApproval?: boolean; rowsDeleted?: number; status?: string; error?: string }>("POST", "/api/system/changes/range-delete", { ...body, reason: reason.trim() });
      if (r.status === 202) toast({ title: "Waiting for approval", description: "A second administrator must approve this removal." });
      else if (r.data.status === "failed") toast({ title: "Removal failed", description: r.data.error ?? undefined, variant: "destructive" });
      else toast({ title: "Readings removed", description: `${whole.format(r.data.rowsDeleted ?? 0)} readings deleted.` });
      onDone(); onOpenChange(false);
    } catch (err) {
      toast({ title: "Not done", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Remove bad data</DialogTitle>
          <DialogDescription>Deletes the readings of one asset (or one of its metrics) in a time range, for example from a faulty sensor or a commissioning test. This cannot be undone and is written to the activity log.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 min-w-0"><Label className="text-xs">Asset</Label>
              <Select value={assetId} onValueChange={(v) => { setAssetId(v); setMetric(""); }}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Choose an asset" /></SelectTrigger>
                <SelectContent className="max-h-72">{assets.list.map((a) => <SelectItem key={a.id} value={a.id}>{a.path}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 min-w-0"><Label className="text-xs">Metric</Label>
              <Select value={metric || ALL} onValueChange={(v) => setMetric(v === ALL ? "" : v)} disabled={!assetId}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72"><SelectItem value={ALL}>All metrics</SelectItem>{metrics.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">From</Label><Input type="datetime-local" className="h-8 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">To</Label><Input type="datetime-local" className="h-8 text-sm" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Reason (required)</Label><Textarea className="text-sm min-h-[60px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sensor TT-101 was disconnected and sent 0 °C" /></div>
          <label className="flex items-start gap-2 text-xs"><Switch checked={includeSummaries} onCheckedChange={setIncludeSummaries} className="mt-0.5" /> <span>Also remove these hours from the summaries, so long-term charts drop the bad values too. Hours that still have raw readings are recounted either way.</span></label>
          {valid && (preview.isFetching ? <p className="text-xs text-muted-foreground">Counting…</p> : preview.error ? <p className="text-xs text-red-500">{(preview.error as Error).message}</p> : preview.data && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
              <p><b className="tabular-nums">{whole.format(preview.data.rows)}</b> readings in this range.</p>
              {preview.data.heldBy && <p className="text-red-500">Part of this range is under the legal hold "{preview.data.heldBy}". Release it first.</p>}
              {preview.data.needsApproval && <p className="text-amber-600 dark:text-amber-400 font-medium">Above the approval limit: a second administrator must approve it.</p>}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" className="bg-red-600 hover:bg-red-700" disabled={!valid || busy || reason.trim().length < 3 || !preview.data || preview.data.rows === 0 || !!preview.data.heldBy} onClick={submit}>
            {busy ? "Working…" : preview.data?.needsApproval ? "Request approval" : "Delete readings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add a legal hold ──────────────────────────────────────────────────────────
function HoldDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const { toast } = useToast();
  const assets = useAssetPaths();
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [assetId, setAssetId] = useState(ALL);
  const [metric, setMetric] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const metrics = useMetricChoices(assetId === ALL ? undefined : assetId);
  useEffect(() => { if (open) { setName(""); setReason(""); setAssetId(ALL); setMetric(""); setFrom(""); setTo(""); setExpires(""); } }, [open]);
  async function submit() {
    setBusy(true);
    try {
      await send("POST", "/api/system/holds", {
        name: name.trim(), reason: reason.trim() || null, assetId: assetId === ALL ? null : assetId, metric: metric || null,
        fromTs: from ? new Date(from).toISOString() : null, toTs: to ? new Date(to).toISOString() : null, expiresAt: expires ? new Date(expires).toISOString() : null,
      });
      toast({ title: "Legal hold placed", description: "Pruning and bad-data removal now skip these readings." });
      onDone(); onOpenChange(false);
    } catch (err) {
      toast({ title: "Not done", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add a legal hold</DialogTitle><DialogDescription>Leave asset, metric or dates empty to cover everything in that dimension.</DialogDescription></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5"><Label className="text-xs">Name</Label><Input className="h-8 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Incident 2026-11 boiler trip" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Reason</Label><Textarea className="text-sm min-h-[50px]" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 min-w-0"><Label className="text-xs">Asset</Label>
              <Select value={assetId} onValueChange={(v) => { setAssetId(v); setMetric(""); }}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72"><SelectItem value={ALL}>All assets</SelectItem>{assets.list.map((a) => <SelectItem key={a.id} value={a.id}>{a.path}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 min-w-0"><Label className="text-xs">Metric</Label>
              <Select value={metric || ALL} onValueChange={(v) => setMetric(v === ALL ? "" : v)} disabled={assetId === ALL}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72"><SelectItem value={ALL}>All metrics</SelectItem>{metrics.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">From (optional)</Label><Input type="datetime-local" className="h-8 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">To (optional)</Label><Input type="datetime-local" className="h-8 text-sm" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Hold ends on its own (optional)</Label><Input type="datetime-local" className="h-8 text-sm" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!name.trim() || busy || (!!from && !!to && new Date(from) > new Date(to))} onClick={submit}>{busy ? "Saving…" : "Place hold"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
