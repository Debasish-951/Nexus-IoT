import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { History, Pause, Play, X } from "lucide-react";

/**
 * History playback for any twin: replay the linked readings over a past window
 * with a time slider. The twin keeps showing what it shows; while playback is on
 * it asks `valueAt(assetId, metric)` instead of the live value.
 *
 * Readings come from GET /api/telemetry/:assetId (raw rows, up to 1000 per
 * reading and window), the same endpoint the dashboard charts use for short
 * ranges. Readings with no history in the window show no value.
 */
export interface Pair { assetId: string; metric: string }
type Series = { ts: number; v: number }[];

const WINDOWS: [number, string][] = [[60, "Last 1 h"], [360, "Last 6 h"], [1440, "Last 24 h"]];
const SPEEDS = [60, 300, 900];

async function fetchRaw(p: Pair, from: Date, to: Date): Promise<Series> {
  const q = new URLSearchParams({ metric: p.metric, from: from.toISOString(), to: to.toISOString(), limit: "1000" });
  const res = await fetch(`/api/telemetry/${encodeURIComponent(p.assetId)}?${q}`).catch(() => null);
  if (!res?.ok) return [];
  const rows: any[] = await res.json().catch(() => []);
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ ts: new Date(r.timestamp).getTime(), v: Number(r.value) }))
    .filter((r) => Number.isFinite(r.v) && Number.isFinite(r.ts))
    .sort((a, b) => a.ts - b.ts);
}

export interface Playback {
  active: boolean;
  /** Current playback time (ms), or null when live. */
  at: number | null;
  /** Value of a reading at the playback time; undefined when not playing back. */
  valueAt: (assetId: string | undefined, metric: string | undefined) => number | null | undefined;
  start: () => void;
  stop: () => void;
  bar: React.ReactNode;
}

export function usePlayback(pairs: Pair[]): Playback {
  const t = useT();
  const [active, setActive] = useState(false);
  const [minutes, setMinutes] = useState(60);
  const [range, setRange] = useState<{ from: number; to: number }>(() => ({ from: Date.now() - 3600_000, to: Date.now() }));
  const [at, setAt] = useState<number>(Date.now());
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(300);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Map<string, Series>>(new Map());
  const key = useMemo(() => Array.from(new Set(pairs.filter((p) => p.assetId && p.metric).map((p) => `${p.assetId}\u0000${p.metric}`))).sort().join("|"), [pairs]);

  useEffect(() => {
    if (!active) return;
    const to = Date.now(); const from = to - minutes * 60_000;
    setRange({ from, to }); setAt(from);
    const list = key ? key.split("|").map((k) => { const [assetId, metric] = k.split("\u0000"); return { assetId, metric }; }) : [];
    let cancelled = false;
    setLoading(true);
    Promise.all(list.map((p) => fetchRaw(p, new Date(from), new Date(to)).then((s) => [`${p.assetId}\u0000${p.metric}`, s] as const)))
      .then((rows) => { if (!cancelled) setData(new Map(rows)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, minutes, key]);

  // Advance the clock while playing: `speed` seconds of history per real second.
  const atRef = useRef(at); atRef.current = at;
  useEffect(() => {
    if (!active || !playing) return;
    let raf = 0; let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      const next = atRef.current + dt * speed * 1000;
      if (next >= range.to) { setAt(range.to); setPlaying(false); return; }
      setAt(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, playing, speed, range.to]);

  const valueAt = useCallback((assetId?: string, metric?: string) => {
    if (!active) return undefined;
    if (!assetId || !metric) return null;
    const s = data.get(`${assetId}\u0000${metric}`);
    if (!s?.length) return null;
    let lo = 0, hi = s.length - 1, best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (s[mid].ts <= at) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    return best < 0 ? null : s[best].v;
  }, [active, data, at]);

  const start = useCallback(() => { setActive(true); setPlaying(false); }, []);
  const stop = useCallback(() => { setActive(false); setPlaying(false); }, []);

  const fmt = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const bar = active ? (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-xs">
      <History className="w-3.5 h-3.5 text-primary shrink-0" />
      <span className="font-semibold">{t("History playback")}</span>
      <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => { if (at >= range.to) setAt(range.from); setPlaying((p) => !p); }} aria-label={playing ? t("Pause") : t("Play")} disabled={loading}>
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      </Button>
      <Slider className="flex-1 min-w-[10rem]" min={range.from} max={range.to} step={1000} value={[at]} onValueChange={([v]) => setAt(v)} aria-label={t("Playback time")} />
      <span className={cn("font-mono tabular-nums", loading && "text-muted-foreground")}>{loading ? t("Loading history…") : fmt(at)}</span>
      <Select value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))}>
        <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{WINDOWS.map(([m, l]) => <SelectItem key={m} value={String(m)}>{t(l)}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
        <SelectTrigger className="h-7 w-20 text-xs" aria-label={t("Speed")}><SelectValue /></SelectTrigger>
        <SelectContent>{SPEEDS.map((s) => <SelectItem key={s} value={String(s)}>{s}×</SelectItem>)}</SelectContent>
      </Select>
      {!key && <span className="text-amber-600 dark:text-amber-400">{t("No linked readings to replay. Demo values are not recorded.")}</span>}
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={stop}><X className="w-3.5 h-3.5 mr-1" />{t("Back to live")}</Button>
    </div>
  ) : null;

  return { active, at: active ? at : null, valueAt, start, stop, bar };
}

/** Toolbar button that starts playback. */
export function PlaybackButton({ playback, className }: { playback: Playback; className?: string }) {
  const t = useT();
  return (
    <Button size="sm" variant={playback.active ? "default" : "outline"} className={cn("h-8", className)} onClick={() => (playback.active ? playback.stop() : playback.start())} title={t("Replay the linked readings over a past window")}>
      <History className="w-4 h-4 mr-1" /> {t("Playback")}
    </Button>
  );
}
