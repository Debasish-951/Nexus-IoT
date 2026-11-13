/**
 * Shared pieces for the Pro widgets: the props every renderer receives, number
 * and series helpers, sample data for unbound widgets, and small UI parts.
 */
import { useEffect, useRef, useState } from "react";
import { STATUS, SERIES } from "@/lib/chartColors";

export const COL = {
  primary: "#3B82F6",
  ok: STATUS.ok,
  warn: STATUS.warning,
  bad: STATUS.critical,
  neutral: STATUS.neutral,
  fg: "hsl(var(--foreground))",
  muted: "hsl(var(--muted-foreground))",
  track: "hsl(var(--muted))",
  border: "hsl(var(--border))",
  card: "hsl(var(--card))",
};
export const SERIES_COL = SERIES;

/** Everything a Pro renderer gets from WidgetView. */
export interface ProProps {
  type: string;
  /** The widget config. */
  c: Record<string, any>;
  /** Merged telemetry rows: { ts, t, s0, s1, … } (empty when unbound). */
  rows: Record<string, any>[];
  /** Keys of the bound series, in order (s0 = primary, s1… = overlays). */
  keys: string[];
  /** Display name, unit, colour and asset per series key. */
  meta: Record<string, { label?: string; unit?: string; color?: string; assetId?: string }>;
  /** True when at least one series is bound AND has rows. */
  bound: boolean;
  /** Time config the widget is using (range + granularity). */
  timeCfg: Record<string, any>;
  refreshSec: number;
  refreshNonce?: string | number;
}

export const n = (x: unknown, fallback: number | null = null): number | null => {
  if (x === "" || x == null) return fallback;
  const v = Number(x);
  return isNaN(v) ? fallback : v;
};
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function valuesOf(rows: Record<string, any>[], key: string): { ts: number; t: string; v: number }[] {
  const out: { ts: number; t: string; v: number }[] = [];
  for (const r of rows) { const v = r[key]; if (v != null && !isNaN(v)) out.push({ ts: r.ts, t: r.t, v: Number(v) }); }
  return out;
}
export function lastOf(rows: Record<string, any>[], key: string): number | null {
  for (let i = rows.length - 1; i >= 0; i--) { const v = rows[i]?.[key]; if (v != null && !isNaN(v)) return Number(v); }
  return null;
}
export function mean(a: number[]) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
export function std(a: number[]) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); }

/** Straight-line fit y = a + b·x. */
export function linFit(xs: number[], ys: number[]): { a: number; b: number } {
  const m = xs.length; if (m < 2) return { a: ys[0] ?? 0, b: 0 };
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < m; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const b = den ? num / den : 0;
  return { a: my - b * mx, b };
}

/** Energy used over a set of readings: rise of a meter total, or sum of per-reading values. */
export function energyUsed(vals: number[], mode: string | undefined): number {
  if (!vals.length) return 0;
  if (mode === "interval") return vals.reduce((s, v) => s + v, 0);
  // Meter total: add up the positive steps, so a meter reset does not show as a huge negative.
  let used = 0;
  for (let i = 1; i < vals.length; i++) { const d = vals[i] - vals[i - 1]; if (d > 0) used += d; }
  return used;
}

export function fmtNum(v: number | null | undefined, dec?: number): string {
  if (v == null || isNaN(v)) return "—";
  const d = dec ?? (Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
  return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function thresholdColor(v: number | null, warn: number | null, crit: number | null, base = COL.primary): string {
  if (v == null) return COL.neutral;
  if (crit != null && v >= crit) return COL.bad;
  if (warn != null && v >= warn) return COL.warn;
  return base;
}

/** Deterministic sample values so an unbound widget looks the same on every render. */
export function sample(n: number, seed = 1, base = 50, amp = 20): number[] {
  return Array.from({ length: n }, (_, i) => +(base + amp * Math.sin(i / 3.2 + seed) + amp * 0.35 * Math.sin(i * 1.7 + seed * 2)).toFixed(2));
}
export function sampleRows(n: number, keys: number, seed = 1, base = 50, amp = 20): { rows: Record<string, any>[]; keys: string[] } {
  const ks = Array.from({ length: keys }, (_, i) => `s${i}`);
  const now = Date.now();
  const cols = ks.map((_, i) => sample(n, seed + i * 1.3, base + i * 8, amp));
  const rows = Array.from({ length: n }, (_, j) => {
    const ts = now - (n - j) * 60_000;
    const r: Record<string, any> = { ts, t: new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    ks.forEach((k, i) => { r[k] = cols[i][j]; });
    return r;
  });
  return { rows, keys: ks };
}

/** Rows and keys to draw: the real ones when bound, sample ones otherwise. */
export function useData(p: ProProps, sampleKeys = 1, base = 50, amp = 20, len = 40) {
  if (p.bound) return { rows: p.rows, keys: p.keys, isSample: false };
  const s = sampleRows(len, sampleKeys, 1, base, amp);
  return { ...s, isSample: true };
}

/** Name for a series: its label, else "Series n". */
export function nameOf(p: ProProps, key: string, i: number): string {
  return p.meta[key]?.label || (p.bound ? `Series ${i + 1}` : ["Line A", "Line B", "Line C", "Line D", "Line E", "Line F"][i % 6]);
}
export function colorOf(p: ProProps, key: string, i: number): string {
  return p.meta[key]?.color || SERIES_COL[i % SERIES_COL.length];
}

/** Animates a number towards its target (count-up). Honors reduced motion. */
export function useTween(target: number | null, ms = 700): number | null {
  const [v, setV] = useState<number | null>(target);
  const from = useRef<number | null>(target);
  useEffect(() => {
    if (target == null) { setV(null); from.current = null; return; }
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current ?? target;
    if (reduce || start === target) { setV(target); from.current = target; return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const cur = start + (target - start) * e;
      setV(cur); from.current = cur;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Pixel size of an element, for SVG drawn at the widget's real size. */
export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 300, h: 160 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize((s) => (Math.abs(s.w - width) > 1 || Math.abs(s.h - height) > 1 ? { w: Math.max(40, width), h: Math.max(40, height) } : s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/**
 * Kept as no-ops: the "Sample data" label and the data-needed note are drawn
 * once, as a footer line under the widget, by ProWidgetView (pro/index.tsx).
 * Drawn inside each widget they covered its content.
 */
export function SampleChip(_props: { show: boolean }) { return null; }
export function NeedNote(_props: { text?: string }) { return null; }

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="h-full w-full flex items-center justify-center text-muted-foreground text-xs text-center px-3">{children}</div>;
}

/** Polyline path through points. */
export function pathOf(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

/** A scale from data to pixels. */
export function scale(d0: number, d1: number, r0: number, r1: number) {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

export function extent(vals: number[], pad = 0.08): [number, number] {
  if (!vals.length) return [0, 1];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

/** Parse "HH:mm" into minutes from midnight. */
export function hhmm(s: unknown, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? "").trim());
  return m ? (Number(m[1]) * 60 + Number(m[2])) : fallback;
}
