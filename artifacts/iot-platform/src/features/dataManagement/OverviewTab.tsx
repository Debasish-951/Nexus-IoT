import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/UserContext";
import { RoleGuard } from "@/components/RoleGuard";
import { AlertTriangle, BellRing, CheckCircle2, Clock, HardDrive, Layers, Plus, RefreshCw, Rows3, Search, TrendingUp, Activity, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAssetPaths } from "./policy";
import { Bars, ErrorLine, Section, StatCard, Table, ago, fmtBytes, fmtCount, getJson, send, td, tdr, th, thr, whole } from "./shared";

export interface SystemAlert { id: string; key: string; severity: string; title: string; message: string; status: string; raisedAt: string; updatedAt: string; clearedAt: string | null; acknowledgedBy: string | null; acknowledgedAt: string | null; notifyResult: string | null }

// The storage report: the generated type plus the newer fields.
export type Storage = {
  telemetry: { totalRows: number; tableSize: string; bytesPerRow: number | null; oldestRecord: string | null; newestRecord: string | null };
  perAsset: Array<{ assetId: string; assetName: string; rows: number; metrics: number; oldest: string | null; newest: string | null; bytes: number | null; minDays: number | null; maxDays: number | null; keptForever: boolean; deleted: boolean }>;
  perProject: Array<{ projectId: string | null; projectName: string; rows: number; assets: number; rowsPerDay: number; bytes: number | null; bytesPerMonth: number | null }>;
  growth: { daily: Array<{ day: string; rows: number }>; rowsPerDay: number | null; bytesPerDay: number | null; bytesPerMonth: number | null; netBytesPerMonth: number | null };
  disk: { path: string; totalBytes: number; freeBytes: number; daysUntilFull: number | null } | null;
  rollups: { enabled: boolean; error: string | null };
  tiers: Array<{ key: string; label: string; enabled: boolean; days: number; watermark: string | null; progressPct: number; complete: boolean; summaryRows: number; oldestSummary: string | null; size: string }>;
  retention: { enabledPolicies: number; operational: Array<{ key: string; label: string; env: string; days: number }>; activeHolds: number; pruneWindow: { enabled: boolean; start: string; end: string }; approval: { enabled: boolean; thresholdRows: number }; archive: { enabled: boolean } };
};

function retentionText(a: { minDays: number | null; maxDays: number | null; keptForever: boolean }): string {
  const parts: string[] = [];
  if (a.minDays != null) parts.push(a.minDays === a.maxDays ? `${a.minDays} days` : `${a.minDays}–${a.maxDays} days`);
  if (a.keptForever) parts.push(parts.length ? "some kept for ever" : "Kept for ever");
  return parts.join(", ") || "—";
}

const SEV: Record<string, string> = { critical: "border-red-500/50 bg-red-500/5", high: "border-amber-500/50 bg-amber-500/5", medium: "border-border bg-muted/30" };

export function OverviewTab({ stats, onAddPolicy }: { stats: { data?: Storage; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void }; onAddPolicy: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { canAction } = useCurrentUser();
  const canManage = canAction("manage_assets", "reports");
  const assets = useAssetPaths();
  const [assetFilter, setAssetFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const alerts = useQuery({ queryKey: ["system/alerts"], queryFn: () => getJson<SystemAlert[]>("/api/system/alerts"), refetchInterval: 60_000, retry: 1 });
  const [checking, setChecking] = useState(false);

  async function checkNow() {
    setChecking(true);
    try {
      const r = await send<{ raised: string[]; cleared: string[] }>("POST", "/api/system/alerts/check");
      toast({ title: "Checked", description: `${r.data.raised.length} raised, ${r.data.cleared.length} cleared.` });
      qc.invalidateQueries({ queryKey: ["system/alerts"] });
    } catch (err) { toast({ title: "Check failed", description: String(err), variant: "destructive" }); }
    finally { setChecking(false); }
  }
  async function ack(id: string) {
    try { await send("POST", `/api/system/alerts/${id}/acknowledge`); qc.invalidateQueries({ queryKey: ["system/alerts"] }); }
    catch (err) { toast({ title: "Not done", description: String(err), variant: "destructive" }); }
  }

  const s = stats.data;
  const t = s?.telemetry;
  const g = s?.growth;
  const disk = s?.disk;
  const open = (alerts.data ?? []).filter((a) => a.status !== "cleared");
  const recentCleared = (alerts.data ?? []).filter((a) => a.status === "cleared").slice(0, 5);
  const noPolicy = !!s && s.retention.enabledPolicies === 0;
  const diskUsedPct = disk ? Math.round(((disk.totalBytes - disk.freeBytes) / Math.max(1, disk.totalBytes)) * 100) : null;
  const daysLeft = disk?.daysUntilFull ?? null;
  const diskTone: "bad" | "warn" | undefined = daysLeft !== null && daysLeft < 30 ? "bad" : (daysLeft !== null && daysLeft < 180) || (diskUsedPct ?? 0) >= 85 ? "warn" : undefined;
  const perAsset = (s?.perAsset ?? []).filter((a) => !assetFilter || a.assetName.toLowerCase().includes(assetFilter.toLowerCase()));
  const shown = showAll ? perAsset : perAsset.slice(0, 15);

  return (
    <div className="space-y-6">
      {stats.isError && <ErrorLine error={stats.error} onRetry={stats.refetch} />}

      <Section title={`Alerts${open.length ? ` (${open.length})` : ""}`} hint="Disk, backups, summaries, pruning, ingest and quiet assets, checked every 10 minutes. Thresholds are on the Settings tab."
        action={canManage ? <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={checking} onClick={checkNow}><RefreshCw className={cn("w-3.5 h-3.5", checking && "animate-spin")} /> Check now</Button> : undefined}>
        {alerts.isError ? <ErrorLine error={alerts.error} onRetry={() => alerts.refetch()} /> : open.length === 0 ? (
          <div className="rounded-lg border border-border p-3 text-xs flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> {alerts.isLoading ? "Loading…" : "No open alerts."}{recentCleared[0] && <span className="text-muted-foreground">Last cleared: {recentCleared[0].title}, {ago(recentCleared[0].clearedAt)}.</span>}</div>
        ) : (
          <div className="space-y-2">
            {open.map((a) => (
              <div key={a.id} className={cn("rounded-lg border px-4 py-3 flex items-start gap-3", SEV[a.severity] ?? SEV.medium)}>
                {a.severity === "critical" ? <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" /> : a.severity === "high" ? <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" /> : <BellRing className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />}
                <div className="flex-1 min-w-0 text-xs">
                  <p className="text-sm font-medium">{a.title} <span className="text-[11px] font-normal uppercase tracking-wide text-muted-foreground">{a.severity}</span></p>
                  <p className="text-muted-foreground mt-0.5">{a.message}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Raised {ago(a.raisedAt)}{a.acknowledgedBy ? ` · acknowledged by ${a.acknowledgedBy}` : ""}{a.notifyResult ? ` · webhook ${a.notifyResult}` : ""}</p>
                </div>
                {a.status === "active" && canManage && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => ack(a.id)}>Acknowledge</Button>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {noPolicy && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-medium">No retention policy: readings are never deleted</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              The database keeps growing{g?.bytesPerMonth != null && <> by about <b>{fmtBytes(g.bytesPerMonth)}</b> a month</>}
              {daysLeft !== null && <>, and the disk is full in about <b>{whole.format(daysLeft)} days</b></>}.
              Add a policy to delete raw readings after a set time; summaries keep the long-term trend.
            </p>
          </div>
          <RoleGuard permission="manage_assets" module="reports">
            <Button size="sm" className="h-7 text-xs gap-1" onClick={onAddPolicy}><Plus className="w-3.5 h-3.5" /> Add policy</Button>
          </RoleGuard>
        </div>
      )}

      <Section title="Storage" hint="Totals are estimates from the database's statistics, so they load instantly on any size of table.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={Rows3} label="Readings stored" value={stats.isLoading ? "…" : t ? `about ${fmtCount(t.totalRows)}` : "—"} sub={t?.bytesPerRow ? `about ${Math.round(t.bytesPerRow)} bytes each, with indexes` : undefined} />
          <StatCard icon={HardDrive} label="Size on disk" value={stats.isLoading ? "…" : t?.tableSize ?? "—"} sub="Raw readings and their indexes" />
          <StatCard icon={Clock} label="Oldest reading" value={stats.isLoading ? "…" : ago(t?.oldestRecord)} sub={t?.oldestRecord ? format(new Date(t.oldestRecord), "PPp") : undefined} />
          <StatCard icon={Activity} label="Newest reading" value={stats.isLoading ? "…" : ago(t?.newestRecord)} sub={t?.newestRecord ? format(new Date(t.newestRecord), "PPp") : undefined} />
        </div>
      </Section>

      <Section title="Growth" hint="Averages over the last 7 complete days. Space freed by pruning is reused for new readings; the database file itself does not shrink.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <StatCard icon={TrendingUp} label="Readings per day" value={stats.isLoading ? "…" : fmtCount(g?.rowsPerDay)} sub={g?.bytesPerDay != null ? `about ${fmtBytes(g.bytesPerDay)} a day` : undefined} />
          <StatCard icon={TrendingUp} label="New data per month" value={stats.isLoading ? "…" : fmtBytes(g?.bytesPerMonth)} sub="Before pruning" />
          <StatCard icon={Layers} label="Kept for ever, per month" value={stats.isLoading ? "…" : fmtBytes(g?.netBytesPerMonth)} tone={(g?.netBytesPerMonth ?? 0) > 0 ? "warn" : undefined}
            sub={(g?.netBytesPerMonth ?? 0) > 0 ? "Readings no policy covers; this keeps growing" : g?.netBytesPerMonth === 0 ? "Every reading has a retention period" : undefined} />
          <StatCard icon={HardDrive} label="Free disk space" tone={diskTone} value={stats.isLoading ? "…" : disk ? fmtBytes(disk.freeBytes) : "Unknown"}
            sub={disk ? `${diskUsedPct}% of ${fmtBytes(disk.totalBytes)} used${daysLeft !== null ? ` · full in about ${whole.format(daysLeft)} days` : g?.netBytesPerMonth === 0 ? " · not filling up" : ""}` : stats.isLoading ? undefined : "The server could not read the disk"} />
        </div>
        <Card><CardContent className="pt-4 pb-3">
          <Bars data={(g?.daily ?? []).map((d) => ({ t: d.day, v: d.rows }))} label={`Readings per day, last ${g?.daily.length ?? 0} days`} format={(d) => `${whole.format(d.v)} readings on ${format(new Date(d.t), "EEE d MMM")}`} />
        </CardContent></Card>
        {disk && <p className="text-[11px] text-muted-foreground mt-1.5">Disk space is measured at {disk.path} on the API server. If PostgreSQL stores its data on another disk, set STORAGE_DISK_PATH on the server to that folder.</p>}
      </Section>

      {(s?.perProject.length ?? 0) > 0 && (
        <Section title="Data per project" hint="A project is a root asset; every asset counts towards its project. Useful for sizing or charging each project.">
          <Table head={<tr><th className={th}>Project</th><th className={thr}>Assets</th><th className={thr}>Readings</th><th className={thr}>Size</th><th className={thr}>Readings / day</th><th className={thr}>Growth / month</th></tr>}>
            {s!.perProject.map((p) => (
              <tr key={p.projectId ?? "none"}>
                <td className={cn(td, "font-medium", !p.projectId && "italic text-muted-foreground")}>{p.projectName}</td>
                <td className={tdr}>{p.assets}</td><td className={tdr}>{fmtCount(p.rows)}</td><td className={tdr}>{fmtBytes(p.bytes)}</td>
                <td className={tdr}>{fmtCount(p.rowsPerDay)}</td><td className={tdr}>{fmtBytes(p.bytesPerMonth)}</td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      <Section title="Data per asset" hint="Counted from the summaries, refreshed every minute."
        action={(s?.perAsset.length ?? 0) > 0 ? <div className="relative w-56"><Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input className="h-8 text-xs pl-7" placeholder="Search assets" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} /></div> : undefined}>
        {s && !s.rollups.enabled ? <p className="text-xs text-muted-foreground">Per-asset counts need the summaries, which are switched off on the server (TELEMETRY_ROLLUPS=false).</p>
          : (s?.perAsset.length ?? 0) === 0 ? <p className="text-xs text-muted-foreground">{stats.isLoading ? "Loading…" : "No counts yet. They appear once the summaries have covered the first hours of data."}</p> : (
          <>
            <Table head={<tr><th className={th}>Asset</th><th className={thr}>Readings</th><th className={thr}>Size</th><th className={thr}>Metrics</th><th className={`${thr} hidden md:table-cell`}>Oldest</th><th className={`${thr} hidden md:table-cell`}>Newest</th><th className={th}>Kept</th></tr>}>
              {shown.map((a) => (
                <tr key={a.assetId}>
                  <td className={cn(td, "font-medium", a.deleted && "text-muted-foreground italic")}>{a.deleted ? "Deleted asset" : assets.pathOf(a.assetId) === "Deleted asset" ? a.assetName : assets.pathOf(a.assetId)}</td>
                  <td className={tdr}>{fmtCount(a.rows)}</td><td className={tdr}>{fmtBytes(a.bytes)}</td><td className={tdr}>{a.metrics}</td>
                  <td className={`${tdr} text-muted-foreground hidden md:table-cell`}>{a.oldest ? format(new Date(a.oldest), "PP") : "—"}</td>
                  <td className={`${tdr} text-muted-foreground hidden md:table-cell`}>{ago(a.newest)}</td>
                  <td className={cn(td, a.keptForever && "text-amber-600 dark:text-amber-400")}>{retentionText(a)}</td>
                </tr>
              ))}
            </Table>
            {perAsset.length > 15 && <button className="text-xs text-primary hover:underline mt-2" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show the 15 largest" : `Show all ${perAsset.length} assets`}</button>}
          </>
        )}
      </Section>

      <Section title="Summaries" hint="Every period of readings is summarised per asset and metric (count, min, average, max). Charts use them for periods whose raw readings were deleted. Pruning only deletes readings that are summarised.">
        {s && !s.rollups.enabled ? <p className="text-xs text-muted-foreground">Switched off on the server (TELEMETRY_ROLLUPS=false).</p> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(s?.tiers ?? []).map((tier) => (
              <Card key={tier.key}><CardContent className="pt-4 pb-4 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  {!tier.enabled ? <Clock className="w-4 h-4 text-muted-foreground" /> : tier.complete ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <RefreshCw className="w-4 h-4 text-primary animate-spin" />}
                  <span className="font-medium text-sm">{tier.label}</span>
                  <span className="text-muted-foreground">{!tier.enabled ? "off" : tier.complete ? "up to date" : `catching up: ${tier.progressPct}%`}</span>
                </div>
                {tier.enabled && !tier.complete && <Progress value={tier.progressPct} className="h-1.5" />}
                <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                  <span>Up to {tier.watermark ? format(new Date(tier.watermark), "PPp") : "—"}</span>
                  <span>From {tier.oldestSummary ? format(new Date(tier.oldestSummary), "PP") : "—"}</span>
                  <span>about {fmtCount(tier.summaryRows)} rows · {tier.size}</span>
                  <span>Kept {tier.days === 0 ? (tier.key === "m15" ? "— not built" : "for ever") : `${whole.format(tier.days)} days`}</span>
                </div>
              </CardContent></Card>
            ))}
          </div>
        )}
        {s?.rollups.error && <p className="text-xs text-red-500 mt-2">Last summary run failed: {s.rollups.error}</p>}
      </Section>
    </div>
  );
}
