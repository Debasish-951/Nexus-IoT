import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n";
import { useTelemetrySeries } from "@/features/dashboards/useWidgetData";

/** Seconds between demo samples, and how many are kept (90 s of history). */
const SAMPLE_MS = 1000;
const MAX_POINTS = 90;
/** Live readings show the last hour from the server, refreshed every 30 s. */
const LIVE_RANGE = { rangeMinutes: 60 };

/**
 * Small trend graph under a twin reading.
 *
 * - live: the linked metric's last hour of telemetry from the server, plus the
 *   newest value, so the graph is real history, not only what arrived since
 *   the page opened.
 * - demo: the simulated values since the page opened (about 90 s), sampled in
 *   the browser. Never stored.
 * - not linked: nothing.
 */
export function ReadingTrend({ value, source, status, assetId, metric }: {
  value: number | null;
  source: "live" | "demo" | "none";
  status?: string;
  assetId?: string | null;
  metric?: string | null;
}) {
  const t = useT();
  const valueRef = useRef(value); valueRef.current = value;
  const [demoPts, setDemoPts] = useState<number[]>([]);
  useEffect(() => {
    setDemoPts([]);
    if (source !== "demo") return;
    const id = setInterval(() => {
      const v = valueRef.current;
      if (v == null || !Number.isFinite(v)) return;
      setDemoPts((p) => (p.length >= MAX_POINTS ? [...p.slice(1), v] : [...p, v]));
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, [source]);

  const live = source === "live";
  const { data: series } = useTelemetrySeries(live ? assetId ?? undefined : undefined, live ? metric ?? undefined : undefined, LIVE_RANGE, 30);
  const pts = useMemo(() => {
    if (!live) return demoPts;
    const p = series.map((s) => s.v);
    if (value != null && Number.isFinite(value) && p[p.length - 1] !== value) p.push(value);
    return p;
  }, [live, series, demoPts, value]);

  if (source === "none") return null;
  const color = status === "crit" ? "#ef4444" : status === "warn" ? "#f59e0b" : "#3b82f6";
  if (pts.length < 2) {
    return <div className="h-7 flex items-center text-[10px] text-muted-foreground">{live ? t("No history in the last hour yet") : t("Collecting demo values…")}</div>;
  }
  const W = 200, H = 28, pad = 2;
  let lo = Math.min(...pts), hi = Math.max(...pts);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2);
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-7 block" role="img"
      aria-label={`${live ? t("Last hour") : t("Demo values")}: ${t("low")} ${lo.toFixed(2)}, ${t("high")} ${hi.toFixed(2)}`}>
      <title>{live ? t("Last hour of telemetry") : t("Demo values since the page opened")}</title>
      <polygon points={`0,${H} ${line} ${W},${H}`} fill={color} opacity={0.15} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
