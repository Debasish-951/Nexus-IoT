/**
 * Drawing kit shared by the equipment widgets.
 *
 * Every equipment widget draws on a fixed 300 × 180 SVG canvas that scales with
 * the widget, so the layout stays the same at any size.
 *
 * Inputs are positional (see `roles` in ./defs.ts): input i is series key s{i}.
 * A missing input reads as NaN and prints as "—", so a half-bound widget never
 * shows a number it does not have.
 */
import { useListAssets } from "@workspace/api-client-react";
import { type ProProps, COL, lastOf, valuesOf, sample, fmtNum, clamp, scale, extent, pathOf, n } from "../common";

export const W = 300, H = 180;
export const CYAN = "#22d3ee", VIOLET = "#a78bfa";

/** Finite number or a fallback (for sizes and positions). */
export const fin = (x: number, d = 0) => (Number.isFinite(x) ? x : d);
/** Formatted number, "—" when missing. */
export const f = (x: number, dec?: number) => fmtNum(Number.isFinite(x) ? x : null, dec);
/** Colour where higher is worse. NaN stays neutral. */
export const lvl = (v: number, warn: number, bad: number) => (!Number.isFinite(v) ? COL.neutral : v >= bad ? COL.bad : v >= warn ? COL.warn : COL.ok);
/** Colour where lower is worse. */
export const lvlLow = (v: number, warn: number, bad: number) => (!Number.isFinite(v) ? COL.neutral : v <= bad ? COL.bad : v <= warn ? COL.warn : COL.ok);
/** A numeric setting, or its default. */
export const cfg = (p: ProProps, key: string, d: number) => n(p.c[key], d) as number;
/** A comma-separated list setting, as numbers (blank entries are NaN). */
export const list = (s: unknown): number[] => String(s ?? "").split(",").map((x) => (x.trim() === "" ? NaN : Number(x.trim())));

/** Latest value of each named input, or the given samples while unbound. */
export function useRoles(p: ProProps, samples: number[]): number[] {
  return samples.map((sv, i) => {
    if (!p.bound) return sv;
    const k = `s${i}`;
    if (!p.keys.includes(k)) return NaN;
    const v = lastOf(p.rows, k);
    return v == null ? NaN : v;
  });
}

/** Values of input i over the time range (sample wave while unbound). */
export function roleSeries(p: ProProps, i: number, base: number, amp: number, len = 40): number[] {
  if (!p.bound) return sample(len, i + 1, base, amp);
  const k = `s${i}`;
  return p.keys.includes(k) ? valuesOf(p.rows, k).map((x) => x.v) : [];
}

/** Values of input i with timestamps (ms). Unbound: one point per minute. */
export function roleSeriesTs(p: ProProps, i: number, base: number, amp: number, len = 40): { ts: number; v: number }[] {
  if (!p.bound) { const now = Date.now(); return sample(len, i + 1, base, amp).map((v, j) => ({ ts: now - (len - j) * 60_000, v })); }
  const k = `s${i}`;
  return p.keys.includes(k) ? valuesOf(p.rows, k).map((x) => ({ ts: x.ts, v: x.v })) : [];
}

export const unitOf = (p: ProProps, i: number, d = "") => p.meta[`s${i}`]?.unit || d;

/** Keep at most `max` points, evenly spaced, so long ranges stay quick to draw. */
export function thin<T>(a: T[], max = 160): T[] {
  if (a.length <= max) return a;
  const step = a.length / max;
  return Array.from({ length: max }, (_, i) => a[Math.floor(i * step)]);
}

/**
 * List widgets: one item per bound series, named after its asset (or its label
 * when several series share an asset). Unbound: the samples.
 */
export function useItems(p: ProProps, samples: [string, number][]): { label: string; v: number; key: string }[] {
  const { data } = useListAssets();
  const assets = (data as any[] | undefined) ?? [];
  if (!p.bound) return samples.map(([label, v], i) => ({ label, v, key: `s${i}` }));
  const counts: Record<string, number> = {};
  for (const k of p.keys) { const a = p.meta[k]?.assetId ?? ""; counts[a] = (counts[a] ?? 0) + 1; }
  return p.keys.map((k, i) => {
    const m = p.meta[k];
    const asset = assets.find((a) => a.id === m?.assetId)?.name as string | undefined;
    const label = (asset && counts[m?.assetId ?? ""] === 1 ? asset : m?.label || asset) || `Item ${i + 1}`;
    const v = lastOf(p.rows, k);
    return { label, v: v == null ? NaN : v, key: k };
  });
}

// ── SVG parts ────────────────────────────────────────────────────────────────

export function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full block" preserveAspectRatio="xMidYMid meet" role="img">
      {children}
    </svg>
  );
}

export function Txt({ x, y, children, s = 10, w, c = COL.muted, a }: {
  x: number; y: number; children: React.ReactNode; s?: number; w?: number; c?: string; a?: "start" | "middle" | "end";
}) {
  return <text x={x} y={y} fontSize={s} fontWeight={w} fill={c} textAnchor={a}>{children}</text>;
}

/** A row of big values with a small caption under each. */
export function Kpis({ y, items, x0 = 0, x1 = W }: { y: number; items: [string, string, string?][]; x0?: number; x1?: number }) {
  const cw = (x1 - x0) / items.length;
  return (
    <>
      {items.map(([v, l, c], i) => (
        <g key={i}>
          <Txt x={x0 + cw * i + cw / 2} y={y} s={14} w={700} c={c || COL.fg} a="middle">{v}</Txt>
          <Txt x={x0 + cw * i + cw / 2} y={y + 13} s={9.5} a="middle">{l}</Txt>
        </g>
      ))}
    </>
  );
}

/** Label on the left, value on the right. */
export function Row({ x0, x1, y, label, value, c }: { x0: number; x1: number; y: number; label: string; value: string; c?: string }) {
  return (
    <>
      <Txt x={x0} y={y} s={10}>{label}</Txt>
      <Txt x={x1} y={y} s={11} w={600} c={c || COL.fg} a="end">{value}</Txt>
    </>
  );
}

/** Pipe with moving flow marks. speed 0 = no flow (static, faded). */
export function Flow({ x1, y1, x2, y2, c, speed = 1 }: { x1: number; y1: number; x2: number; y2: number; c: string; speed?: number }) {
  const on = Number.isFinite(speed) && speed > 0;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={COL.track} strokeWidth={6} strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={2} strokeDasharray="5 5" opacity={on ? 1 : 0.35}
        className={on ? "pro-dash" : undefined} style={on ? ({ "--pro-dur": `${clamp(2.5 / speed, 0.4, 8)}s` } as React.CSSProperties) : undefined} />
    </g>
  );
}

export function Pill({ x, y, text, c }: { x: number; y: number; text: string; c: string }) {
  const w = text.length * 6.4 + 14;
  return (
    <g>
      <rect x={x} y={y} width={w} height={18} rx={9} fill={c} fillOpacity={0.16} />
      <Txt x={x + 7} y={y + 12.5} s={10} w={700} c={c}>{text}</Txt>
    </g>
  );
}

/** Horizontal bar with a track. frac is 0..1 (NaN draws an empty track). */
export function Bar({ x, y, w, h = 7, frac, c }: { x: number; y: number; w: number; h?: number; frac: number; c: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={COL.track} />
      <rect x={x} y={y} width={w * clamp(fin(frac), 0, 1)} height={h} rx={h / 2} fill={c} className="pro-ease" />
    </g>
  );
}

/** Half-circle gauge with coloured bands and a needle. */
export function ArcGauge({ cx, cy, r, min, max, v, bands, lw = 10 }: {
  cx: number; cy: number; r: number; min: number; max: number; v: number; bands: [number, number, string][]; lw?: number;
}) {
  const a = (x: number) => Math.PI + clamp((x - min) / (max - min || 1), 0, 1) * Math.PI;
  const P = (ang: number, rr = r) => [cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr];
  const arc = (s0: number, s1: number) => { const [x0, y0] = P(a(s0)), [x1, y1] = P(a(s1)); return `M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}`; };
  const [nx, ny] = P(a(fin(v, min)), r - 6);
  return (
    <g>
      {bands.map(([s0, s1, c], i) => <path key={i} d={arc(s0, s1)} stroke={c} strokeOpacity={0.6} strokeWidth={lw} fill="none" />)}
      {Number.isFinite(v) && <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={COL.fg} strokeWidth={3} strokeLinecap="round" />}
      <circle cx={cx} cy={cy} r={4} fill={COL.fg} />
    </g>
  );
}

/** Full ring showing a fraction, value in the middle. */
export function Ring({ cx, cy, r, frac, c, label, sub }: { cx: number; cy: number; r: number; frac: number; c: string; label: string; sub?: string }) {
  const fr = clamp(fin(frac), 0, 1), circ = 2 * Math.PI * r;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={COL.track} strokeWidth={9} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth={9} strokeLinecap="round" strokeDasharray={`${circ * fr} ${circ}`}
        transform={`rotate(-90 ${cx} ${cy})`} className="pro-ease" />
      <Txt x={cx} y={cy + 5} s={15} w={700} c={COL.fg} a="middle">{label}</Txt>
      {sub && <Txt x={cx} y={cy + r + 18} s={9} a="middle">{sub}</Txt>}
    </g>
  );
}

/** Line through values, with optional reference lines [value, colour, dashed]. */
export function Trend({ vals, x0, y0, x1, y1, c = COL.primary, lo, hi, lines = [], fill }: {
  vals: number[]; x0: number; y0: number; x1: number; y1: number; c?: string; lo?: number; hi?: number;
  lines?: [number, string, boolean?][]; fill?: boolean;
}) {
  const v = thin(vals.filter(Number.isFinite));
  if (v.length < 2) return <Txt x={(x0 + x1) / 2} y={(y0 + y1) / 2} s={9} a="middle">No history in range</Txt>;
  const [elo, ehi] = extent([...v, ...lines.map((l) => l[0]).filter(Number.isFinite)]);
  const L = lo ?? elo, Hh = hi ?? ehi;
  const sx = scale(0, v.length - 1, x0, x1), sy = scale(L, Hh, y1, y0);
  const pts = v.map((x, i) => [sx(i), sy(clamp(x, L, Hh))] as [number, number]);
  return (
    <g>
      {lines.filter((l) => Number.isFinite(l[0])).map(([val, col, dash], i) => (
        <line key={i} x1={x0} x2={x1} y1={sy(clamp(val, L, Hh))} y2={sy(clamp(val, L, Hh))} stroke={col} strokeOpacity={0.7} strokeDasharray={dash ? "3 3" : undefined} />
      ))}
      {fill && <path d={`${pathOf(pts)} L${x1},${y1} L${x0},${y1} Z`} fill={c} fillOpacity={0.15} />}
      <path d={pathOf(pts)} stroke={c} strokeWidth={1.6} fill="none" strokeLinejoin="round" />
    </g>
  );
}

/** Tile for status grids (gas detectors, leak and fire zones). */
export function Tile({ title, value, state, note }: { title: string; value: React.ReactNode; state: 0 | 1 | 2; note?: string }) {
  const c = state === 2 ? COL.bad : state === 1 ? COL.warn : COL.ok;
  return (
    <div className={`rounded-md border p-1.5 flex flex-col justify-between min-w-0 ${state === 2 ? "pro-pulse" : ""}`}
      style={{ borderColor: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}>
      <span className="text-[10px] text-muted-foreground truncate">{title}</span>
      <b className="text-sm tabular-nums truncate">{value}</b>
      {note && <span className="text-[9.5px] font-semibold truncate" style={{ color: state ? c : undefined }}>{note}</span>}
    </div>
  );
}

/** Per-row ratio of two inputs over the range (sample wave while unbound). */
export function ratioSeries(p: ProProps, a: number, b: number, base: number, amp: number): number[] {
  if (!p.bound) return sample(30, a + 2, base, amp);
  const ka = `s${a}`, kb = `s${b}`;
  return p.rows.filter((r) => r[ka] != null && r[kb] != null && Number(r[kb]) !== 0).map((r) => Number(r[ka]) / Number(r[kb]));
}
