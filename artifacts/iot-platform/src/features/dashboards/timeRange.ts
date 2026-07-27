// ── Time range / refresh / aggregation vocabulary shared by the dashboard
// builder's global header controls and the per-widget "Time Range &
// Aggregation" popover. Values mirror src/pages/AnalyticsKpi.tsx so both
// dashboards behave identically.

export const REFRESH_INTERVALS = [
  { label: "1 s",    ms: 1_000 },
  { label: "2 s",    ms: 2_000 },
  { label: "20 s",   ms: 20_000 },
  { label: "1 min",  ms: 60_000 },
  { label: "5 min",  ms: 300_000 },
  { label: "15 min", ms: 900_000 },
  { label: "30 min", ms: 1_800_000 },
  { label: "1 hr",   ms: 3_600_000 },
  { label: "3 hr",   ms: 10_800_000 },
  { label: "6 hr",   ms: 21_600_000 },
  { label: "12 hr",  ms: 43_200_000 },
  { label: "1 day",  ms: 86_400_000 },
];

export const GRANULARITY_OPTS = [
  { label: "Auto",   value: "auto" },
  { label: "1 min",  value: "1m" },
  { label: "5 min",  value: "5m" },
  { label: "15 min", value: "15m" },
  { label: "30 min", value: "30m" },
  { label: "1 hr",   value: "1h" },
  { label: "6 hr",   value: "6h" },
  { label: "12 hr",  value: "12h" },
  { label: "1 day",  value: "1d" },
  { label: "1 wk",   value: "1w" },
];

export const AGG_TYPE_OPTS = [
  { label: "Average", value: "avg" },
  { label: "Sum",     value: "sum" },
  { label: "Min",     value: "min" },
  { label: "Max",     value: "max" },
  { label: "Count",   value: "count" },
];

export const GRANULARITY_STEP_MAP: Record<string, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "6h": "6h", "12h": "12h", "1d": "1d", "1w": "1w",
};

export const RANGES = [
  { label: "Last 1 min",    minutes: 1 },
  { label: "Last 5 min",    minutes: 5 },
  { label: "Last 15 min",   minutes: 15 },
  { label: "Last 30 min",   minutes: 30 },
  { label: "Last 1 hour",   minutes: 60 },
  { label: "Last 6 hours",  minutes: 360 },
  { label: "Last 12 hours", minutes: 720 },
  { label: "Last 24 hours", minutes: 1440 },
  { label: "Last 3 days",   minutes: 4320 },
  { label: "Last 7 days",   minutes: 10080 },
  { label: "Last 30 days",  minutes: 43200 },
  { label: "Last 3 months", minutes: 129600 },
  { label: "Last 6 months", minutes: 259200 },
  { label: "Last 9 months", minutes: 388800 },
  { label: "Last 1 year",   minutes: 525600 },
  { label: "Custom range",  minutes: -1 },
  { label: "WTD",           minutes: -2 },
  { label: "MTD",           minutes: -3 },
  { label: "YTD",           minutes: -4 },
];

export interface TimeCfg {
  rangeMinutes?: number;
  rangeHours?: number; // legacy field, still honored for widgets created before this feature
  customFrom?: string;
  customTo?: string;
  granularity?: string;
  aggType?: string;
}

// Back-compat: widgets created before this feature only had `rangeHours`.
export function effectiveRangeMinutes(cfg: TimeCfg): number {
  if (cfg.rangeMinutes != null) return cfg.rangeMinutes;
  if (cfg.rangeHours != null) return cfg.rangeHours * 60;
  return 1440; // 24h, matches the previous default
}

export function getFromTo(cfg: TimeCfg): { from: string; to: string } {
  const to = cfg.customTo ? new Date(cfg.customTo).toISOString() : new Date().toISOString();
  if (cfg.customFrom) return { from: new Date(cfg.customFrom).toISOString(), to };
  const minutes = effectiveRangeMinutes(cfg);
  if (minutes === -2) {
    // WTD — start of current week (Monday)
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return { from: new Date(d.getFullYear(), d.getMonth(), diff).toISOString(), to };
  }
  if (minutes === -3) {
    const d = new Date();
    return { from: new Date(d.getFullYear(), d.getMonth(), 1).toISOString(), to };
  }
  if (minutes === -4) {
    return { from: new Date(new Date().getFullYear(), 0, 1).toISOString(), to };
  }
  const from = new Date(Date.now() - (minutes > 0 ? minutes : 60) * 60_000).toISOString();
  return { from, to };
}

export function rangeLabelOf(cfg: TimeCfg): string {
  if (cfg.customFrom && cfg.customTo) {
    return `${new Date(cfg.customFrom).toLocaleString()} → ${new Date(cfg.customTo).toLocaleString()}`;
  }
  const minutes = effectiveRangeMinutes(cfg);
  if (minutes === -2) return "WTD";
  if (minutes === -3) return "MTD";
  if (minutes === -4) return "YTD";
  return RANGES.find((r) => r.minutes === minutes)?.label ?? `${minutes}m`;
}

const GAP_STEP_MS: Record<string, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "6h": 21_600_000, "12h": 43_200_000, "1d": 86_400_000, "1w": 604_800_000,
};

// Fill missing buckets between the first and last point with 0 so charts
// don't render misleadingly-connected long gaps.
export function gapFill(rows: { timestamp: string; value: number | null }[], bucket: string) {
  const step = GAP_STEP_MS[bucket];
  if (!step || rows.length < 2) return rows.map((r) => ({ ...r, value: r.value ?? 0 }));
  const sorted = [...rows].sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
  const map = new Map(sorted.map((r) => [Math.round(+new Date(r.timestamp) / step), r.value]));
  const first = Math.round(+new Date(sorted[0].timestamp) / step);
  const last = Math.round(+new Date(sorted[sorted.length - 1].timestamp) / step);
  const result: { timestamp: string; value: number }[] = [];
  for (let i = first; i <= last; i++) {
    const val = map.get(i);
    result.push({ timestamp: new Date(i * step).toISOString(), value: val ?? 0 });
  }
  return result;
}
