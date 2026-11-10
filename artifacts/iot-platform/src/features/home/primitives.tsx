import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shared pieces for the banded Home page.
 *
 * Everything here is presentation only — no fetching, no navigation. The bands
 * own their data; these own how it looks, so a change to spacing or severity
 * colour happens in one place rather than in four.
 */

// ── Severity ────────────────────────────────────────────────────────────────
//
// Tailwind cannot see class names built at runtime, so every severity maps to
// complete literal class strings. `bg-${severity}-500` would compile away to
// nothing in production and the colours would silently vanish.

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITY: Record<Severity, {
  label: string; text: string; bar: string; chip: string; hex: string;
}> = {
  critical: { label: "Critical", text: "text-red-500",    bar: "bg-red-500",    chip: "bg-red-500/15 text-red-500",       hex: "#ef4444" },
  high:     { label: "High",     text: "text-orange-500", bar: "bg-orange-500", chip: "bg-orange-500/15 text-orange-500", hex: "#f97316" },
  medium:   { label: "Medium",   text: "text-amber-500",  bar: "bg-amber-500",  chip: "bg-amber-500/15 text-amber-500",   hex: "#f59e0b" },
  low:      { label: "Low",      text: "text-green-500",  bar: "bg-green-500",  chip: "bg-green-500/15 text-green-500",   hex: "#22c55e" },
  info:     { label: "Info",     text: "text-sky-400",    bar: "bg-sky-400",    chip: "bg-sky-400/15 text-sky-400",       hex: "#60a5fa" },
};

export function severityOf(value: string | null | undefined): Severity {
  return value && value in SEVERITY ? (value as Severity) : "medium";
}

/** Green above 85, amber above 60, orange above 40, red below. */
export function scoreTone(score: number): { bar: string; text: string } {
  if (score >= 85) return { bar: "bg-green-500",  text: "text-green-500" };
  if (score >= 60) return { bar: "bg-amber-500",  text: "text-amber-500" };
  if (score >= 40) return { bar: "bg-orange-500", text: "text-orange-500" };
  return { bar: "bg-red-500", text: "text-red-500" };
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** Compact age: 42s, 8m, 3h 20m, 4d. */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Durations phrased for a KPI tile rather than a log line. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/**
 * Significant-figure formatting for sensor values.
 *
 * A reading of 0.00042 and one of 41273 come through the same tile, so a fixed
 * decimal count is wrong for one of them. Large numbers also get thousands
 * separators — 3714120 is unreadable, 3,714,120 is not.
 */
export function formatValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 10_000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(2);
  if (abs === 0) return "0";
  return value.toPrecision(3);
}

export function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

// ── Layout ──────────────────────────────────────────────────────────────────

/**
 * Band header — the numbered rule that separates the four sections.
 *
 * The question text is not decoration: it is what tells an operator they can
 * stop reading after band 2, and a manager that band 1 and band 4 are theirs.
 */
export function BandHeader({ n, title, question, context, action }: {
  n: number; title: string; question: string;
  context?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 mt-6 mb-3">
      <span className="w-5 h-5 rounded-full border border-border bg-muted text-[10px] font-bold
                       text-muted-foreground flex items-center justify-center shrink-0">{n}</span>
      <h2 className="text-[11px] font-bold tracking-[0.13em] uppercase">{title}</h2>
      <span className="text-xs text-muted-foreground italic hidden sm:inline">{question}</span>
      <div className="flex-1 h-px bg-border" />
      {context && <span className="text-xs text-muted-foreground whitespace-nowrap hidden md:inline">{context}</span>}
      {action}
    </div>
  );
}

export function Panel({ title, sub, badge, action, className, bodyClassName, children }: {
  title: string; sub?: string; badge?: React.ReactNode; action?: React.ReactNode;
  className?: string; bodyClassName?: string; children: React.ReactNode;
}) {
  return (
    <Card className={cn("shadow-sm !border-primary/40 overflow-hidden flex flex-col", className)}>
      <CardContent className="p-0 flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{title}</h3>
            {sub && <p className="text-xs text-muted-foreground truncate mt-0.5">{sub}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">{badge}{action}</div>
        </div>
        <div className={cn("flex-1 min-h-0", bodyClassName)}>{children}</div>
      </CardContent>
    </Card>
  );
}

export function Pill({ tone = "ok", children }: {
  tone?: "ok" | "warn" | "error" | "muted"; children: React.ReactNode;
}) {
  const dot = tone === "ok" ? "bg-green-500" : tone === "warn" ? "bg-amber-500"
    : tone === "error" ? "bg-red-500" : "bg-muted-foreground";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground bg-muted/60
                     border border-border rounded-full px-2.5 py-1 whitespace-nowrap">
      {tone !== "muted" && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dot)} />}
      {children}
    </span>
  );
}

/** Thin progress track. `value` is a percentage and is clamped here, not by callers. */
export function Track({ value, className, barClassName }: {
  value: number; className?: string; barClassName?: string;
}) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className={cn("h-1.5 rounded-full bg-muted overflow-hidden", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", barClassName)}
           style={{ width: `${pct}%` }} />
    </div>
  );
}

export function KpiTile({ label, value, unit, badge, icon: Icon, iconClassName, footLeft, footRight, children, className }: {
  label: string; value: React.ReactNode; unit?: string; badge?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>; iconClassName?: string;
  footLeft?: React.ReactNode; footRight?: React.ReactNode;
  children?: React.ReactNode; className?: string;
}) {
  return (
    <Card className={cn("shadow-sm !border-primary/40", className)}>
      <CardContent className="p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground truncate">
            {label}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {badge}
            {Icon && (
              <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center", iconClassName)}>
                <Icon className="w-3.5 h-3.5" />
              </span>
            )}
          </div>
        </div>
        <div className="text-[22px] font-semibold tracking-tight tabular-nums mt-1.5 leading-none">
          {value}
          {unit && <span className="text-xs text-muted-foreground font-medium ml-1">{unit}</span>}
        </div>
        {children}
        {(footLeft || footRight) && (
          <div className="flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground mt-1.5">
            <span className="truncate">{footLeft}</span>
            <span className="truncate shrink-0">{footRight}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Inline sparkline.
 *
 * Hand-drawn SVG rather than a chart component: there are up to eight of these
 * on screen refreshing on a timer, and a full charting runtime per tile is a
 * lot of machinery for a 40-point polyline with no axes, tooltip or legend.
 *
 * A flat series is the case worth getting right — when every value is identical
 * the range is zero, and dividing by it puts the line at NaN and renders
 * nothing. It is drawn down the middle instead, which is what "flat" looks like.
 */
export function Sparkline({ points, color, threshold, className, height = 26 }: {
  points: number[]; color: string; threshold?: number | null;
  className?: string; height?: number;
}) {
  const usable = points.filter((p) => Number.isFinite(p));
  if (usable.length < 2) {
    return <div className={cn("w-full", className)} style={{ height }} aria-hidden />;
  }

  const withThreshold = threshold != null && Number.isFinite(threshold)
    ? [...usable, threshold] : usable;
  const lo = Math.min(...withThreshold);
  const hi = Math.max(...withThreshold);
  const range = hi - lo;
  const y = (v: number) => (range === 0 ? 12 : 22 - ((v - lo) / range) * 20);
  const step = 100 / (usable.length - 1);
  const path = usable.map((v, i) => `${(i * step).toFixed(2)},${y(v).toFixed(2)}`).join(" ");

  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={cn("w-full", className)}
         style={{ height }} aria-hidden>
      {threshold != null && Number.isFinite(threshold) && (
        <line x1="0" y1={y(threshold)} x2="100" y2={y(threshold)}
              stroke={color} strokeWidth="0.7" strokeDasharray="2 2" opacity="0.5" />
      )}
      <polyline points={path} fill="none" stroke={color} strokeWidth="1.5"
                vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Stacked column chart for daily/hourly alarm counts. Pure CSS, no chart runtime. */
export type StackedDatum = { label: string } & Partial<Record<Severity, number>>;

export function StackedBars({ data, keys, height = 80 }: {
  data: StackedDatum[];
  keys: Severity[];
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => keys.reduce((s, k) => s + (d[k] ?? 0), 0)));
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {data.map((d, i) => {
        const total = keys.reduce((s, k) => s + (d[k] ?? 0), 0);
        return (
          <div key={i} className="flex-1 h-full flex flex-col-reverse justify-start gap-px min-w-0"
               title={`${d.label}: ${total}`}>
            {total === 0
              ? <div className="w-full rounded-[1px] bg-muted" style={{ height: 2 }} />
              : keys.map((k) => {
                  const v = d[k] ?? 0;
                  if (v === 0) return null;
                  return <div key={k} className={cn("w-full rounded-[1px]", SEVERITY[k].bar)}
                              style={{ height: `${(v / max) * 100}%` }} />;
                })}
          </div>
        );
      })}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 mt-3 text-[11px] text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <i className="w-2 h-2 rounded-[2px] inline-block" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/**
 * What a widget shows when it has nothing to show.
 *
 * Deliberately not a bare "No data": the original dashboard's problem was five
 * zeroes that read as a broken page. A sentence saying what would put something
 * here turns the same emptiness into an instruction.
 */
export function EmptyHint({ icon: Icon, title, hint, action }: {
  icon?: React.ElementType; title: string; hint?: string; action?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-8 text-center flex flex-col items-center gap-2">
      {Icon && <Icon className="w-5 h-5 text-muted-foreground/50" />}
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs text-muted-foreground max-w-[320px]">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 animate-pulse">
          <div className="w-1 h-8 rounded bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-muted rounded w-1/2" />
            <div className="h-2.5 bg-muted rounded w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
