import { useEffect, useMemo, useState } from "react";
import { subHours, subDays, format } from "date-fns";
import { MousePointerClick, RefreshCw, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";
import { PALETTE } from "./registry";
import { resolveTags } from "./assetBinding";
import type { Asset } from "@/pages/assetShared";

interface Series { tag: string; points: { t: string; v: number }[]; last: number | null; min: number; max: number; avg: number }
const RANGES = [{ v: 1, l: "1 hour" }, { v: 6, l: "6 hours" }, { v: 24, l: "24 hours" }, { v: 168, l: "7 days" }];
const COLORS = [PALETTE.primary, PALETTE.success, PALETTE.warning, PALETTE.critical, "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];

export function AssetVizPanel({ assetId, assetName, assets }: { assetId: string | null; assetName?: string; assets: Asset[] }) {
  const [rangeHours, setRangeHours] = useState(24);
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0); // manual refresh

  useEffect(() => {
    if (!assetId) { setSeries([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Resolve this asset's tags from its device-owning ancestor (machines have
        // no telemetry of their own — data lives on the root device).
        const { ownerId, tags } = await resolveTags(assetId, assets);
        if (!ownerId) { if (!cancelled) setSeries([]); return; }
        const from = (rangeHours <= 24 ? subHours(new Date(), rangeHours) : subDays(new Date(), rangeHours / 24)).toISOString();
        const chosen = tags.slice(0, 16);
        const out = await Promise.all(chosen.map(async (tag) => {
          const p = new URLSearchParams({ metric: tag, from, limit: "300" });
          const rows: any[] = await fetch(`/api/telemetry/${ownerId}?${p}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
          const points = rows.map((r) => ({ ts: new Date(r.timestamp).getTime(), t: format(new Date(r.timestamp), rangeHours <= 24 ? "HH:mm" : "MM/dd"), v: Number(r.value) }))
            .filter((r) => !isNaN(r.v)).sort((a, b) => a.ts - b.ts);
          const vals = points.map((p2) => p2.v);
          return {
            tag, points: points.map(({ t, v }) => ({ t, v })),
            last: vals.length ? vals[vals.length - 1] : null,
            min: vals.length ? Math.min(...vals) : 0, max: vals.length ? Math.max(...vals) : 0,
            avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
          } as Series;
        }));
        if (!cancelled) setSeries(out.filter((s) => s.points.length > 0));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [assetId, rangeHours, tick]);

  // Auto-poll so the panel stays live (every 8s while an asset is selected).
  useEffect(() => {
    if (!assetId) return;
    const iv = setInterval(() => setTick((t) => t + 1), 8000);
    return () => clearInterval(iv);
  }, [assetId]);

  const numeric = useMemo(() => series.filter((s) => s.last != null), [series]);

  if (!assetId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
        <MousePointerClick className="w-10 h-10 mb-3 opacity-20" />
        <p className="text-sm">Select an asset from the tree to see its visualizations.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold truncate">{assetName ?? "Asset"}</h2>
          <p className="text-xs text-muted-foreground">{numeric.length} live metric{numeric.length !== 1 ? "s" : ""}</p>
        </div>
        <Select value={String(rangeHours)} onValueChange={(v) => setRangeHours(Number(v))}>
          <SelectTrigger className="h-8 w-32 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{RANGES.map((r) => <SelectItem key={r.v} value={String(r.v)}>{r.l}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setTick((t) => t + 1)}><RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /></Button>
      </div>

      {series.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {loading ? "Loading telemetry…" : "No telemetry for this asset in the selected range."}
        </div>
      ) : (
        <>
          {/* KPI cards — latest value per metric */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-5">
            {numeric.map((s, i) => (
              <Card key={s.tag} className="p-3 border-l-4" style={{ borderLeftColor: COLORS[i % COLORS.length] }}>
                <p className="text-[11px] text-muted-foreground truncate" title={s.tag}>{s.tag.split(".").pop()}</p>
                <p className="text-xl font-bold tabular-nums" style={{ color: COLORS[i % COLORS.length] }}>{s.last!.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">avg {s.avg.toFixed(1)} · min {s.min.toFixed(1)} · max {s.max.toFixed(1)}</p>
              </Card>
            ))}
          </div>

          {/* Trend chart per metric */}
          <div className="flex items-center gap-1.5 text-sm font-semibold mb-2"><TrendingUp className="w-4 h-4 text-primary" /> Trends</div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {series.map((s, i) => (
              <Card key={s.tag} className="p-3">
                <p className="text-xs font-medium truncate mb-1" title={s.tag}>{s.tag.split(".").pop()}</p>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={s.points} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                      <XAxis dataKey="t" tick={{ fontSize: 9 }} minTickGap={24} /><YAxis tick={{ fontSize: 9 }} /><Tooltip contentStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="v" stroke={COLORS[i % COLORS.length]} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
