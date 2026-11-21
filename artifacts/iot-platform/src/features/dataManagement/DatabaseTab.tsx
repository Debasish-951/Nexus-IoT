import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/UserContext";
import { Database, HardDrive, Image, Archive, Layers, Activity, Gauge, Plug, Wrench, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorLine, Section, StatCard, Table, ago, fmtBytes, fmtCount, getJson, send, td, tdr, th, thr, whole } from "./shared";

interface StorageAll {
  database: { bytes: number };
  tables: Array<{ name: string; bytes: number; estRows: number; parts: number }>;
  uploads: { path: string; bytes: number; files: number; truncated: boolean };
  archives: { path: string; files: number; bytes: number };
  backups: { lastSizeBytes: number | null; lastAt: string | null; location: string | null };
  disk: { path: string; totalBytes: number; freeBytes: number; daysUntilFull: number | null } | null;
  partitioning: {
    partitioned: boolean; command: string;
    conversion: { inProgress: boolean; startedAt?: string; step?: string; oldTable?: string | null };
    partitions: Array<{ name: string; from: string | null; to: string | null; isDefault: boolean; estRows: number; bytes: number }>;
  };
}
interface DbHealth {
  version: string | null; databaseBytes: number;
  connections: { byState: Record<string, number>; total: number; max: number; poolTotal: number; poolIdle: number; poolWaiting: number };
  longQueries: Array<{ pid: number; state: string; seconds: number; wait: string | null; query: string; app: string | null }>;
  cacheHitPct: number | null; deadlocks: number; tempBytes: number;
  tables: Array<{ schema: string; name: string; liveRows: number; deadRows: number; bytes: number; deadPct: number; wastedBytes: number; lastVacuum: string | null; lastAnalyze: string | null }>;
  wastedBytes: number; vacuumRunning: string | null;
}

export function DatabaseTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { canAction } = useCurrentUser();
  const canManage = canAction("manage_assets", "data_management");
  const [allTables, setAllTables] = useState(false);
  const all = useQuery({ queryKey: ["system/storage/all"], queryFn: () => getJson<StorageAll>("/api/system/storage/all"), retry: 1 });
  const health = useQuery({ queryKey: ["system/db-health"], queryFn: () => getJson<DbHealth>("/api/system/db-health"), refetchInterval: 30_000, retry: 1, enabled: canManage });

  async function vacuum(schema: string, table: string) {
    try {
      await send("POST", "/api/system/db-health/vacuum", { schema, table });
      toast({ title: `Maintenance started on ${table}`, description: "VACUUM (ANALYZE) runs in the background without blocking readings. On a large table it takes minutes." });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["system/db-health"] }), 3000);
    } catch (err) {
      toast({ title: "Not started", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }

  const s = all.data;
  const h = health.data;
  const p = s?.partitioning;
  const disk = s?.disk;
  const used = disk ? disk.totalBytes - disk.freeBytes : null;
  return (
    <div className="space-y-6">
      <Section title="What uses the disk" hint="Everything the installation stores, not only readings.">
        {all.isError ? <ErrorLine error={all.error} onRetry={() => all.refetch()} /> : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <StatCard icon={Database} label="Database" value={all.isLoading ? "…" : fmtBytes(s?.database.bytes)} sub="All tables and indexes" />
              <StatCard icon={Image} label="Uploads (media library)" value={all.isLoading ? "…" : fmtBytes(s?.uploads.bytes)} sub={s ? `${whole.format(s.uploads.files)}${s.uploads.truncated ? "+" : ""} files` : undefined} />
              <StatCard icon={Archive} label="Archives" value={all.isLoading ? "…" : fmtBytes(s?.archives.bytes)} sub={s ? `${whole.format(s.archives.files)} day file(s)` : undefined} />
              <StatCard icon={HardDrive} label="Disk" value={all.isLoading ? "…" : disk ? `${fmtBytes(used)} of ${fmtBytes(disk.totalBytes)}` : "Unknown"} sub={s?.backups.lastSizeBytes ? `Last backup ${fmtBytes(s.backups.lastSizeBytes)} at ${s.backups.location ?? "?"}` : "No backup size reported"} />
            </div>
            <Table head={<tr><th className={th}>Table</th><th className={thr}>Rows (estimate)</th><th className={thr}>Size</th><th className={th}>Share of database</th></tr>}>
              {(s?.tables ?? []).slice(0, allTables ? 200 : 12).map((t) => {
                const pct = s && s.database.bytes ? (t.bytes / s.database.bytes) * 100 : 0;
                return (
                  <tr key={t.name}>
                    <td className={cn(td, "font-mono")}>{t.name}{t.parts ? <span className="text-muted-foreground font-sans"> ({t.parts} partitions)</span> : null}</td>
                    <td className={tdr}>{fmtCount(t.estRows)}</td>
                    <td className={tdr}>{fmtBytes(t.bytes)}</td>
                    <td className={td}><div className="flex items-center gap-2"><div className="h-1.5 w-32 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary/70" style={{ width: `${Math.min(100, pct)}%` }} /></div><span className="tabular-nums text-muted-foreground">{pct.toFixed(1)}%</span></div></td>
                  </tr>
                );
              })}
            </Table>
            {(s?.tables.length ?? 0) > 12 && <button className="text-xs text-primary hover:underline mt-2" onClick={() => setAllTables((v) => !v)}>{allTables ? "Show the 12 largest" : `Show all ${s?.tables.length} tables`}</button>}
          </>
        )}
      </Section>

      <Section title="Monthly partitions" hint="With telemetry split into one partition per month, pruning drops a whole old month in a second and gives its disk space back at once, instead of deleting row by row.">
        {!p ? <p className="text-xs text-muted-foreground">{all.isLoading ? "Loading…" : "—"}</p> : p.conversion.inProgress ? (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs">Conversion in progress (step: {p.conversion.step ?? "?"}, started {ago(p.conversion.startedAt)}). Pruning is paused until it finishes.</div>
        ) : !p.partitioned ? (
          <div className="rounded-lg border border-border p-3 text-xs space-y-2">
            <p className="text-sm font-medium flex items-center gap-2"><Layers className="w-4 h-4 text-muted-foreground" /> Not partitioned yet</p>
            <p>The conversion copies the table while the platform keeps running, then swaps it in a few seconds. It needs free disk space about the size of the telemetry table, and the old copy is kept for rollback until you remove it. An administrator runs it on the server, after a backup:</p>
            <div className="flex items-center gap-2"><code className="font-mono bg-muted px-2 py-1 rounded">{p.command} -- --yes</code>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Copy command" onClick={() => { void navigator.clipboard?.writeText(`${p.command} -- --yes`); toast({ title: "Command copied" }); }}><Copy className="w-3.5 h-3.5" /></Button></div>
            <p className="text-muted-foreground">Without <code className="font-mono">--yes</code> it only checks and prints what it would do. <code className="font-mono">--rollback</code> undoes it; <code className="font-mono">--drop-old</code> removes the old copy. See docs/features/data-management.md.</p>
          </div>
        ) : (
          <>
            {p.conversion.oldTable && <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs mb-3">The table from before partitioning is still kept as <code className="font-mono">{p.conversion.oldTable}</code> for rollback. When you are satisfied, free its space with <code className="font-mono">{p.command} -- --drop-old</code>.</div>}
            <Table head={<tr><th className={th}>Partition</th><th className={th}>Covers</th><th className={thr}>Rows (estimate)</th><th className={thr}>Size</th></tr>}>
              {p.partitions.map((x) => (
                <tr key={x.name}>
                  <td className={cn(td, "font-mono")}>{x.name}</td>
                  <td className={td}>{x.isDefault ? "Readings outside every month" : x.from ? format(new Date(x.from), "MMMM yyyy") : "—"}</td>
                  <td className={tdr}>{fmtCount(x.estRows)}</td>
                  <td className={tdr}>{fmtBytes(x.bytes)}</td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Section>

      <Section title="Database health" hint="Refreshed every 30 seconds. Dead rows are left behind by deletes and updates; PostgreSQL's autovacuum reuses their space, and Vacuum runs it now.">
        {!canManage ? <p className="text-xs text-muted-foreground">Database health needs the Manage assets permission.</p>
          : health.isError ? <ErrorLine error={health.error} onRetry={() => health.refetch()} /> : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <StatCard icon={Plug} label="Connections" value={health.isLoading ? "…" : `${h?.connections.total ?? 0} of ${h?.connections.max ?? "?"}`} tone={h && h.connections.max && h.connections.total / h.connections.max > 0.8 ? "warn" : undefined}
                sub={h ? `${h.connections.byState.active ?? 0} active · app pool ${h.connections.poolTotal} (${h.connections.poolWaiting} waiting)` : undefined} />
              <StatCard icon={Gauge} label="Cache hit ratio" value={health.isLoading ? "…" : h?.cacheHitPct != null ? `${h.cacheHitPct}%` : "—"} tone={h?.cacheHitPct != null && h.cacheHitPct < 95 ? "warn" : "good"} sub="Below 95% means memory is short for the working set" />
              <StatCard icon={Activity} label="Slow queries now" value={health.isLoading ? "…" : whole.format(h?.longQueries.length ?? 0)} tone={(h?.longQueries.length ?? 0) > 0 ? "warn" : "good"} sub="Running longer than 10 seconds" />
              <StatCard icon={Wrench} label="Reclaimable space" value={health.isLoading ? "…" : fmtBytes(h?.wastedBytes)} sub={h?.vacuumRunning ? `Vacuum running on ${h.vacuumRunning}` : `PostgreSQL ${h?.version ?? ""}`} />
            </div>
            {(h?.longQueries.length ?? 0) > 0 && (
              <div className="mb-3"><Table head={<tr><th className={th}>Running for</th><th className={th}>State</th><th className={th}>Waiting on</th><th className={th}>Query (start)</th></tr>}>
                {h!.longQueries.map((q) => <tr key={q.pid}><td className={td}>{q.seconds} s</td><td className={td}>{q.state}</td><td className={td}>{q.wait ?? "—"}</td><td className={cn(td, "font-mono truncate max-w-[520px]")} title={q.query}>{q.query}</td></tr>)}
              </Table></div>
            )}
            <Table head={<tr><th className={th}>Table</th><th className={thr}>Live rows</th><th className={thr}>Dead rows</th><th className={thr}>Reclaimable</th><th className={th}>Last vacuum</th><th className={th}>Last analyse</th><th className={th}></th></tr>}>
              {(h?.tables ?? []).slice(0, 20).map((t) => (
                <tr key={`${t.schema}.${t.name}`}>
                  <td className={cn(td, "font-mono")}>{t.schema === "public" ? t.name : `${t.schema}.${t.name}`}</td>
                  <td className={tdr}>{fmtCount(t.liveRows)}</td>
                  <td className={cn(tdr, t.deadPct > 20 && "text-amber-600 dark:text-amber-400")}>{fmtCount(t.deadRows)} ({t.deadPct}%)</td>
                  <td className={tdr}>{fmtBytes(t.wastedBytes)}</td>
                  <td className={td}>{ago(t.lastVacuum)}</td>
                  <td className={td}>{ago(t.lastAnalyze)}</td>
                  <td className={tdr}>{t.deadRows > 0 && <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!!h?.vacuumRunning} onClick={() => vacuum(t.schema, t.name)}>Vacuum</Button>}</td>
                </tr>
              ))}
            </Table>
            <p className="text-[11px] text-muted-foreground mt-1.5">Vacuum makes dead space reusable but does not shrink the file. Giving disk space back to the operating system needs VACUUM FULL or pg_repack during a maintenance window, or monthly partitions, which free space when a month is dropped.</p>
          </>
        )}
      </Section>
    </div>
  );
}
