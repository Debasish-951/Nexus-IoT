import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2, Radio, Ban, Gauge, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Bars, ErrorLine, Section, StatCard, Table, ago, getJson, td, tdr, th, thr, whole } from "./shared";

interface Health {
  quietMinutes: number;
  assets: Array<{ assetId: string; assetName: string; newest: string | null; quiet: boolean; minutesSinceLast: number | null; coveragePct: number | null; missingHours: number; gaps: Array<{ from: string; to: string; hours: number }> }>;
  busiest: Array<{ assetId: string; assetName: string; metric: string; readingsPerDay: number; perMinute: number; everySeconds: number | null }>;
  rejections: Array<{ source: string; route: string; status: number; code: string; count: number; last_at: string; last_message: string | null; last_client: string | null }>;
  rejectionsHourly: Array<{ hour: string; count: number }>;
  rejectionsTotal: number;
}

function sinceText(min: number | null): string {
  if (min === null) return "never";
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} days`;
}

export function HealthTab() {
  const q = useQuery({ queryKey: ["system/data-health"], queryFn: () => getJson<Health>("/api/system/data-health"), refetchInterval: 60_000, retry: 1 });
  const [filter, setFilter] = useState("");
  if (q.isError) return <ErrorLine error={q.error} onRetry={() => q.refetch()} />;
  const h = q.data;
  const quiet = h?.assets.filter((a) => a.quiet) ?? [];
  const lowCoverage = h?.assets.filter((a) => (a.coveragePct ?? 100) < 95) ?? [];
  const assets = (h?.assets ?? []).filter((a) => !filter || a.assetName.toLowerCase().includes(filter.toLowerCase()));

  // Last 24 hours of refused requests, one bar per hour (zero hours included).
  const hourly: Array<{ t: string; v: number }> = [];
  if (h) {
    const map = new Map(h.rejectionsHourly.map((r) => [new Date(r.hour).getTime(), r.count]));
    const end = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    for (let t = end - 23 * 3_600_000; t <= end; t += 3_600_000) hourly.push({ t: new Date(t).toISOString(), v: map.get(t) ?? 0 });
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Radio} label="Assets sending" value={q.isLoading ? "…" : `${(h?.assets.length ?? 0) - quiet.length} of ${h?.assets.length ?? 0}`} tone={quiet.length ? "warn" : "good"} sub={quiet.length ? `${quiet.length} quiet for over ${h?.quietMinutes} min` : "All reported recently"} />
        <StatCard icon={Gauge} label="Complete hours, last 7 days" value={q.isLoading ? "…" : lowCoverage.length ? `${lowCoverage.length} asset(s) below 95%` : "All above 95%"} tone={lowCoverage.length ? "warn" : "good"} sub="Hours with at least one reading" />
        <StatCard icon={Ban} label="Refused in 24 h" value={q.isLoading ? "…" : whole.format(h?.rejectionsTotal ?? 0)} tone={(h?.rejectionsTotal ?? 0) > 0 ? "warn" : "good"} sub="Ingest requests and MQTT messages" />
        <StatCard icon={Gauge} label="Busiest metric" value={q.isLoading ? "…" : h?.busiest[0] ? `${h.busiest[0].perMinute}/min` : "—"} sub={h?.busiest[0] ? `${h.busiest[0].assetName} · ${h.busiest[0].metric}` : undefined} />
      </div>

      <Section title="Assets" hint={`Quiet means no reading for more than ${h?.quietMinutes ?? 60} minutes (change it on the Settings tab). Coverage counts hours with readings since each asset first reported in the last 7 days.`}
        action={<div className="relative w-56"><Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input className="h-8 text-xs pl-7" placeholder="Search assets" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>}>
        <Table empty={assets.length === 0 && (q.isLoading ? "Loading…" : "No assets with readings yet.")} head={
          <tr><th className={th}>Asset</th><th className={th}>Last reading</th><th className={thr}>Coverage 7 d</th><th className={thr}>Missing hours</th><th className={th}>Longest gaps</th></tr>
        }>
          {assets.map((a) => (
            <tr key={a.assetId}>
              <td className={cn(td, "font-medium")}>{a.assetName}</td>
              <td className={td}>
                {a.quiet ? <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="w-3 h-3" /> Quiet for {sinceText(a.minutesSinceLast)}</span>
                  : <span className="inline-flex items-center gap-1 text-muted-foreground"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> {ago(a.newest)}</span>}
              </td>
              <td className={cn(tdr, (a.coveragePct ?? 100) < 95 && "text-amber-600 dark:text-amber-400")}>{a.coveragePct == null ? "—" : `${a.coveragePct}%`}</td>
              <td className={tdr}>{whole.format(a.missingHours)}</td>
              <td className={cn(td, "text-muted-foreground")}>{a.gaps.length ? a.gaps.slice(0, 2).map((g) => `${format(new Date(g.from), "d MMM HH:mm")} (${g.hours} h)`).join(", ") : "none"}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Busiest metrics, last 24 hours" hint="Metrics sending far more often than the process changes fill the disk fastest. Consider a longer send interval or a deadband on the gateway.">
        <Table empty={(h?.busiest.length ?? 0) === 0 && (q.isLoading ? "Loading…" : "No data in the last 24 hours.")} head={
          <tr><th className={th}>Asset</th><th className={th}>Metric</th><th className={thr}>Readings / day</th><th className={thr}>Per minute</th><th className={thr}>About every</th></tr>
        }>
          {(h?.busiest ?? []).map((b) => (
            <tr key={`${b.assetId}|${b.metric}`}>
              <td className={td}>{b.assetName}</td><td className={cn(td, "font-mono")}>{b.metric}</td>
              <td className={tdr}>{whole.format(b.readingsPerDay)}</td><td className={tdr}>{b.perMinute}</td>
              <td className={tdr}>{b.everySeconds == null ? "—" : `${b.everySeconds} s`}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Refused ingest requests, last 24 hours" hint="Counted per error. Only the error text is kept, never the payload or tokens. Kept for 30 days.">
        <div className="rounded-lg border border-border p-3 mb-3"><Bars data={hourly} label={`${whole.format(h?.rejectionsTotal ?? 0)} refused in the last 24 hours`} format={(d) => `${whole.format(d.v)} refused at ${format(new Date(d.t), "HH:mm")}`} /></div>
        <Table empty={(h?.rejections.length ?? 0) === 0 && (q.isLoading ? "Loading…" : "Nothing refused in the last 24 hours.")} head={
          <tr><th className={th}>Source</th><th className={th}>Endpoint</th><th className={thr}>Status</th><th className={th}>Error</th><th className={thr}>Count</th><th className={th}>Last</th></tr>
        }>
          {(h?.rejections ?? []).map((r) => (
            <tr key={`${r.source}|${r.route}|${r.status}|${r.code}`}>
              <td className={td}>{r.source === "mqtt" ? "MQTT" : "HTTP"}</td>
              <td className={cn(td, "font-mono")}>{r.route}</td>
              <td className={cn(tdr, r.status >= 500 && "text-red-500")}>{r.status}</td>
              <td className={td}><div className="font-mono">{r.code}</div>{r.last_message && <div className="text-muted-foreground truncate max-w-[420px]" title={r.last_message}>{r.last_message}</div>}</td>
              <td className={tdr}>{whole.format(r.count)}</td>
              <td className={td}>{ago(r.last_at)}{r.last_client ? <div className="text-muted-foreground">{r.last_client}</div> : null}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}
