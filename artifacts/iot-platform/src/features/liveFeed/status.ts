/**
 * The one data-status rule of the Live Feed page. Every part of the page (header,
 * tiles, asset tree, attention list, event stream) asks this module, so they can
 * no longer disagree the way the earlier page did.
 *
 *   online   newest reading within the asset's expected interval
 *            (5 minutes, or the static attribute "Expected interval (min)")
 *   delayed  older than that, but within one hour
 *   offline  older than one hour
 *   never    no reading known at all
 *
 * "Newest reading" is the latest of: live WebSocket telemetry, the newest stored
 * reading the server reports for the asset (asset health `lastSeen`) and the
 * timestamps of its dynamic attributes. These are reading timestamps as stored
 * by ingest; the API does not keep a separate receive time, and ingest refuses
 * future-dated readings, so they cannot make an asset look fresher than it is.
 *
 * Pure functions only, no React, so the rule is easy to test and reuse.
 */

export type DataStatus = "online" | "delayed" | "offline" | "never";

export const DEFAULT_INTERVAL_MIN = 5;
export const OFFLINE_AFTER_MS = 60 * 60_000;

/** Lower-case, letters and digits only: "Expected interval (min)" -> "expectedintervalmin". */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The asset's expected reporting interval in milliseconds, from an optional
 * static attribute named "Expected interval (min)". The name is matched without
 * case, spaces or units ("expected interval", "Expected Interval min", ...);
 * the value may carry a unit ("10", "10 min"). Anything unusable gives 5 minutes.
 */
export function expectedIntervalMs(attrs: { name: string; type?: string | null; value?: unknown }[] | undefined): number {
  for (const a of attrs ?? []) {
    if (!norm(a.name).startsWith("expectedinterval")) continue;
    const raw = typeof a.value === "number" ? a.value : parseFloat(String(a.value ?? ""));
    if (Number.isFinite(raw) && raw > 0 && raw <= 24 * 60) return Math.min(raw * 60_000, OFFLINE_AFTER_MS);
  }
  return DEFAULT_INTERVAL_MIN * 60_000;
}

export function dataStatus(lastSeen: number | null | undefined, intervalMs: number, now: number): DataStatus {
  if (!lastSeen || !Number.isFinite(lastSeen)) return "never";
  const age = now - lastSeen;
  if (age <= intervalMs) return "online";
  if (age <= OFFLINE_AFTER_MS) return "delayed";
  return "offline";
}

/** Newest of several timestamps (ms), ignoring missing ones; 0 when none. */
export function newest(...ts: (number | string | Date | null | undefined)[]): number {
  let m = 0;
  for (const t of ts) {
    if (t == null) continue;
    const v = typeof t === "number" ? t : new Date(t).getTime();
    if (Number.isFinite(v) && v > m) m = v;
  }
  return m;
}

/**
 * "Unit 2.Fiber Production.Spinning.Spinning Machine.spinningEfficiency" ->
 * { path: ["Unit 2", "Fiber Production", "Spinning", "Spinning Machine"], reading: "spinningEfficiency" }.
 */
export function splitMetric(metric: string): { path: string[]; reading: string } {
  const parts = metric.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { path: [], reading: metric };
  return { path: parts.slice(0, -1), reading: parts[parts.length - 1]! };
}

/** "spinningEfficiency" -> "Spinning efficiency"; "energyConsumptionKWh" -> "Energy consumption KWh". */
export function readable(reading: string): string {
  const spaced = reading.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
  if (!spaced) return reading;
  return spaced.split(" ").map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : /^[A-Z]{2,}/.test(w) ? w : w.toLowerCase())).join(" ");
}

/**
 * Short human duration: 12 s, 4 min, 3 h, 2 d. Pass the page's `t` to get the
 * units in the interface language (keys "{n} s", "{n} min", "{n} h", "{n} d").
 */
export function fmtDuration(ms: number, t?: (text: string, vars: Record<string, number>) => string): string {
  const unit = (n: number, key: string) => (t ? t(key, { n }) : key.replace("{n}", String(n)));
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return unit(s, "{n} s");
  const m = Math.round(s / 60);
  if (m < 60) return unit(m, "{n} min");
  const h = Math.round(m / 60);
  if (h < 48) return unit(h, "{n} h");
  return unit(Math.round(h / 24), "{n} d");
}

export function fmtValue(v: number | null | undefined, decimals?: number | null): string {
  if (v == null || !Number.isFinite(v)) return "-";
  if (decimals != null && decimals >= 0) return v.toFixed(Math.min(decimals, 6));
  const a = Math.abs(v);
  return a !== 0 && a < 1 ? v.toFixed(3) : a < 100 ? v.toFixed(2) : v.toFixed(1);
}

/** Change per minute over the buffered points, or null with too little data. */
export function ratePerMin(points: { t: number; v: number }[], windowMs = 5 * 60_000): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const first = points.find((p) => last.t - p.t <= windowMs) ?? points[0]!;
  const dt = (last.t - first.t) / 60_000;
  if (dt <= 0) return null;
  return (last.v - first.v) / dt;
}

/** True when a reading has many points and all have the same value. */
export function looksStuck(points: { v: number }[], minPoints = 20): boolean {
  if (points.length < minPoints) return false;
  const v0 = points[0]!.v;
  return points.every((p) => p.v === v0);
}
