import { statusFromLimits, type Limits, type LimitLookup } from "@/features/plantTwin/shared/alarmLimits";
import type { TwinItem } from "./types";

/** What one mapped item looks like right now. */
export interface ItemView {
  v: number | null;
  src: "live" | "demo" | "history" | "none";
  ts?: string;
  status: "ok" | "warn" | "crit" | "none";
  /** Alarm-rule limits were used (not the manual ones). */
  fromRules: boolean;
  label: string | null;
  fillColor: string | null;
  fill: number | null;      // 0..1
  hidden: boolean;
  blink: boolean;
  speed: number;            // deg/s
}

export const STATUS_COLOR = { ok: "#22c55e", warn: "#f59e0b", crit: "#ef4444", none: "#94a3b8" } as const;

export function heat(f: number): string {
  const c = Math.max(0, Math.min(1, f));
  return `rgb(${Math.round(29 + c * 210)},${Math.round(78 - c * 10)},${Math.round(216 - c * 148)})`;
}

export function formatValue(it: TwinItem, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const d = it.decimals ?? (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
  return `${v.toFixed(Math.max(0, Math.min(6, d)))}${it.unit ? ` ${it.unit}` : ""}`;
}

/** A smooth fake reading for unlinked items while demo values are on. */
export function demoValue(it: TwinItem, t: number): number {
  const lo = it.min ?? 0, hi = it.max ?? 100;
  let h = 0; for (const ch of it.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const phase = (h % 1000) / 160;
  const f = 0.55 + 0.25 * Math.sin(t / 7 + phase) + 0.08 * Math.sin(t / 1.7 + phase * 2);
  return lo + (hi - lo) * f;
}

export function evaluate(it: TwinItem, v: number | null, src: ItemView["src"], limitsOf: LimitLookup, ts?: string): ItemView {
  const rules = limitsOf(it.assetId, it.metric);
  const manual: Limits = { warn: it.warn, crit: it.crit, low: it.low, lowCrit: it.lowCrit };
  const hasManual = [manual.warn, manual.crit, manual.low, manual.lowCrit].some((x) => typeof x === "number");
  const limits = rules ?? (hasManual ? manual : undefined);
  const status = statusFromLimits(v, limits) ?? (v == null ? "none" : "ok");
  const b = new Set(it.behaviours);
  const lo = it.min ?? 0, hi = it.max ?? 100;
  const frac = v == null || hi === lo ? null : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

  let label: string | null = null;
  if (b.has("text") && it.texts?.length && v != null) {
    const rule = [...it.texts].sort((a, c) => a.v - c.v).filter((r) => v >= r.v).pop();
    label = rule ? rule.text : null;
  }
  if (label == null && b.has("value")) label = formatValue(it, v);

  let fillColor: string | null = null;
  if (b.has("scale") && frac != null) fillColor = heat(frac);
  if (b.has("status") && v != null) fillColor = STATUS_COLOR[status];

  const speed = b.has("rotate") && v != null && v > 0 ? (it.speed ?? 360) * (it.max ? Math.min(2, v / it.max) : 1) : 0;
  return {
    v, src, ts, status, fromRules: !!rules, label, fillColor,
    fill: b.has("fill") ? frac : null,
    hidden: b.has("visible") ? !(v != null && v > (it.threshold ?? 0)) : false,
    blink: b.has("blink") && status === "crit",
    speed,
  };
}
