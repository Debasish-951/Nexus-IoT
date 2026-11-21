/**
 * AI Reports (AI Advisor): the facts of a report and the checks on its narrative.
 *
 * Every number in a report is computed here, in code, from database rows the
 * route has already limited to what the caller may see. The language model only
 * receives these facts and writes the narrative around them; it never queries
 * data itself, and numbers in its text that cannot be found in the facts are
 * flagged to the reader (see `unverifiedNumbers`). Pure logic, no database, so
 * it is unit-tested directly.
 *
 * A report is written for the reader's level, decided from their role
 * (REPORT_LEVEL_BY_ROLE): executive (short, business language, for a meeting),
 * manager (problem areas, response performance, team priorities) or engineer
 * (technical diagnosis per asset). The facts are the same; the part the model
 * reads, its instructions and the shape of its answer differ per level.
 */

export const REPORT_LEVELS = ["executive", "manager", "engineer"] as const;
export type ReportLevel = (typeof REPORT_LEVELS)[number];

/**
 * Which report each role gets. Executives: the people who answer for the plant
 * (owners, company administrators, project managers). Managers: those who run
 * teams or administer the system, and read-only viewers (a summary, not a
 * technical dump). Engineers: the people who work on the equipment and data.
 * A role not listed here gets the manager report.
 */
export const REPORT_LEVEL_BY_ROLE: Readonly<Record<string, ReportLevel>> = {
  super_admin: "executive",
  company_admin: "executive",
  project_manager: "executive",
  admin: "manager",
  team_lead: "manager",
  viewer: "manager",
  engineer: "engineer",
  developer: "engineer",
  operator: "engineer",
};

export function reportLevelFor(role: string | null | undefined): ReportLevel {
  return (role && REPORT_LEVEL_BY_ROLE[role]) || "manager";
}

/** Longest report period. Longer ranges scan too much raw telemetry for an on-demand report. */
export const REPORT_MAX_DAYS = 92;
/** A reporting asset whose newest reading is older than this before the range end is "stale". */
export const STALE_AFTER_MS = 60 * 60_000;
/** Number of time buckets a period is split into for trends, correlations and leading signals. */
export const REPORT_BUCKETS = 48;

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
type Severity = (typeof SEVERITIES)[number];

export interface ReportAsset { id: string; name: string; maintenanceMode?: boolean | null; maintenanceSince?: Date | string | null }
export interface MetricStatRow { assetId: string; metric: string; n: number; min: number | null; avg: number | null; max: number | null }
export interface PrevStatRow { assetId: string; metric: string; n: number; avg: number | null; min?: number | null; max?: number | null }
export interface AlarmRow {
  assetId: string; assetName: string; name: string; severity: string;
  triggeredAt: Date | string; acknowledgedAt?: Date | string | null; clearedAt?: Date | string | null;
}
export interface CoverageRow { assetId: string; hours: number }
export interface LastSeenRow { assetId: string; ts: Date | string | null }
/** Average of one metric of one asset in one time bucket (bucket start, epoch ms). */
export interface BucketRow { assetId: string; metric: string; t: number; avg: number }

export interface ReportInput {
  scope: { assetId: string | null; name: string };
  range: { from: Date; to: Date };
  level: ReportLevel;
  /** IANA time zone of the reader, for alarm time-of-day figures. */
  timeZone?: string;
  assets: ReportAsset[];
  stats: MetricStatRow[];
  prevStats: PrevStatRow[];
  alarms: AlarmRow[];
  prevAlarms?: AlarmRow[];
  coverage: CoverageRow[];
  prevCoverage?: CoverageRow[];
  lastSeen: LastSeenRow[];
  buckets?: BucketRow[];
  bucketMs?: number;
  /** False when the caller may not see alarms: alarm figures are left out, not shown as zero. */
  alarmsIncluded?: boolean;
}

export interface MetricFact {
  assetId: string; assetName: string; metric: string;
  readings: number; min: number | null; avg: number | null; max: number | null;
  prevAvg: number | null; changePct: number | null;
}
export interface EnergyFact extends MetricFact { kind: "energy" | "power"; rise: number | null }

export interface KpiCard {
  key: string; label: string; value: number | null; prev: number | null; unit: string;
  changePct: number | null;
  /** Which direction is good; null when neither is (energy use depends on production). */
  better: "higher" | "lower" | null;
  /** Verdict of the change: better, worse or about the same (within 2 %); null without a previous value. */
  trend: "better" | "worse" | "same" | null;
}
export type AssetStatus = "alarm" | "stale" | "silent" | "maintenance" | "ok" | "no_data";
export interface AssetHealthFact {
  assetId: string; assetName: string; status: AssetStatus;
  alarms: number; openAlarms: number; coveragePct: number | null; lastSeen: string | null;
}

export interface ReportFacts {
  level: ReportLevel;
  scope: { assetId: string | null; name: string; assetCount: number };
  range: { from: string; to: string; hours: number };
  previous: { from: string; to: string };
  alarmsIncluded: boolean;
  kpis: {
    assets: number; assetsReporting: number; staleAssets: number; inMaintenance: number;
    metricsTracked: number; readings: number; dataCoveragePct: number | null;
    alarms: number; alarmsBySeverity: Record<Severity, number>; stillOpen: number;
    acknowledged: number; mttaMinutes: number | null; cleared: number; mttrMinutes: number | null;
    energyUsedKwh: number | null;
  };
  previousKpis: {
    assetsReporting: number; dataCoveragePct: number | null;
    alarms: number; alarmsBySeverity: Record<Severity, number>;
    mttaMinutes: number | null; mttrMinutes: number | null; energyUsedKwh: number | null;
  };
  healthScore: {
    score: number | null; prevScore: number | null;
    parts: { availabilityPct: number | null; coveragePct: number | null; alarmBurdenPerAssetDay: number | null };
    formula: string;
  };
  kpiCards: KpiCard[];
  assetHealth: AssetHealthFact[];
  statusCounts: Record<AssetStatus, number>;
  metrics: MetricFact[];
  topMovers: MetricFact[];
  trends: { assetName: string; metric: string; points: { t: string; v: number }[] }[];
  correlations: { assetId: string; assetName: string; metricA: string; metricB: string; r: number; points: number }[];
  leadingSignals: {
    assetId: string; assetName: string; alarm: string; metric: string; alarms: number;
    direction: "rose" | "fell"; beforeAvg: number; normalAvg: number; zScore: number;
  }[];
  alarmAssets: { assetId: string; assetName: string; total: number; critical: number; high: number }[];
  topAlarms: { name: string; assetName: string; severity: string; count: number }[];
  repeatAlarms: { name: string; assetName: string; severity: string; count: number; firstAt: string; lastAt: string; medianGapMinutes: number | null }[];
  alarmTiming: {
    timeZone: string; byHour: number[]; byWeekday: number[];
    peakWindow: { startHour: number; endHour: number; alarms: number; sharePct: number } | null;
    peakWeekday: { day: string; alarms: number; sharePct: number } | null;
  };
  alarmTimeline: { assetName: string; name: string; severity: string; triggeredAt: string; ackMinutes: number | null; clearMinutes: number | null }[];
  maintenance: { assetId: string; assetName: string; since: string | null; hoursInPeriod: number | null }[];
  energy: EnergyFact[];
  dataQuality: {
    stale: { assetId: string; assetName: string; lastSeen: string | null }[];
    lowCoverage: { assetId: string; assetName: string; coveragePct: number }[];
    silent: { assetId: string; assetName: string }[];
    stuck: { assetName: string; metric: string; value: number; readings: number }[];
  };
  truncated: { metrics: boolean };
}

const MAX_METRICS = 300;
const round = (v: number, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f; };
const iso = (d: Date | string) => (d instanceof Date ? d : new Date(d)).toISOString();
const ms = (d: Date | string | null | undefined) => (d == null ? null : (d instanceof Date ? d : new Date(d)).getTime());
const zeroSev = () => Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
const sevOf = (s: string): Severity => ((SEVERITIES as readonly string[]).includes(s) ? (s as Severity) : "medium");
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** The same-length period just before `range`, compared against for "change". */
export function previousRange(range: { from: Date; to: Date }): { from: Date; to: Date } {
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: new Date(range.from.getTime()) };
}

/** Bucket width for a period: REPORT_BUCKETS buckets, at least 5 minutes, rounded to whole minutes. */
export function bucketMsFor(range: { from: Date; to: Date }): number {
  const span = range.to.getTime() - range.from.getTime();
  return Math.max(5 * 60_000, Math.ceil(span / REPORT_BUCKETS / 60_000) * 60_000);
}

/** Percent change from `prev` to `cur`; null when either is missing or `prev` is zero. */
export function changePct(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return round(((cur - prev) / Math.abs(prev)) * 100, 1);
}

/** Pearson correlation of two equally long series; null when either is flat or too short. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]!; sb += b[i]!; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { const da = a[i]! - ma, db = b[i]! - mb; cov += da * db; va += da * da; vb += db * db; }
  if (va <= 1e-12 || vb <= 1e-12) return null;
  return cov / Math.sqrt(va * vb);
}

const ENERGY_RE = /(energy|kwh|mwh|wh_total|consumption)/i;
const POWER_RE = /(^|[^a-z])(power|kw|mw|load)([^a-z]|$)/i;
/** Energy counters whose rise can be summed as kWh (MWh counters are converted). */
const KWH_RE = /kwh/i, MWH_RE = /mwh/i;

function alarmSummary(alarms: AlarmRow[]) {
  const bySeverity = zeroSev();
  let ackN = 0, ackSum = 0, clrN = 0, clrSum = 0, open = 0;
  for (const a of alarms) {
    bySeverity[sevOf(a.severity)]++;
    const t = ms(a.triggeredAt)!, ack = ms(a.acknowledgedAt), clr = ms(a.clearedAt);
    if (ack != null && ack >= t) { ackN++; ackSum += ack - t; }
    if (clr != null && clr >= t) { clrN++; clrSum += clr - t; } else open++;
  }
  return {
    total: alarms.length, bySeverity, open, ackN, clrN,
    mtta: ackN ? round(ackSum / ackN / 60_000, 1) : null,
    mttr: clrN ? round(clrSum / clrN / 60_000, 1) : null,
  };
}

function energyKwh(rows: { metric: string; min?: number | null; max?: number | null }[]): number | null {
  let sum = 0, any = false;
  for (const r of rows) {
    if (r.min == null || r.max == null) continue;
    const rise = r.max - r.min;
    if (MWH_RE.test(r.metric)) { sum += rise * 1000; any = true; } else if (KWH_RE.test(r.metric)) { sum += rise; any = true; }
  }
  return any ? round(sum, 1) : null;
}

/**
 * Plant health score, 0-100:
 *   40 x availability (share of monitored assets that sent data in the period)
 * + 30 x data coverage (average share of hours with data per reporting asset)
 * + 30 x 1 / (1 + weighted alarms per monitored asset per day)
 * with alarm weights critical 3, high 2, medium 1, low and info 0.5. Without
 * alarm access the first two parts are scaled to 100. Monitored assets are those
 * not in maintenance that have sent data at some time.
 */
export const HEALTH_FORMULA =
  "40 x availability + 30 x data coverage + 30 x 1/(1 + weighted alarms per asset per day); weights critical 3, high 2, medium 1, low/info 0.5";

export function healthScore(p: { availability: number | null; coverage: number | null; bySeverity: Record<Severity, number> | null; monitored: number; days: number }): { score: number | null; burden: number | null } {
  if (p.availability == null || p.monitored === 0) return { score: null, burden: null };
  const cov = p.coverage ?? 0;
  if (!p.bySeverity) return { score: Math.round(((40 * p.availability + 30 * cov) / 70) * 100), burden: null };
  const s = p.bySeverity;
  const weighted = s.critical * 3 + s.high * 2 + s.medium + (s.low + s.info) * 0.5;
  const burden = weighted / (p.monitored * Math.max(p.days, 1 / 24));
  return { score: Math.round(40 * p.availability + 30 * cov + 30 / (1 + burden)), burden: round(burden, 2) };
}

function card(key: string, label: string, value: number | null, prev: number | null, unit: string, better: KpiCard["better"]): KpiCard {
  const ch = changePct(value, prev);
  let trend: KpiCard["trend"] = null;
  if (value != null && prev != null) {
    const rel = prev === 0 ? (value === 0 ? 0 : 100) : ((value - prev) / Math.abs(prev)) * 100;
    if (Math.abs(rel) < 2 || better == null) trend = Math.abs(rel) < 2 ? "same" : null;
    else trend = (rel > 0) === (better === "higher") ? "better" : "worse";
  }
  return { key, label, value, prev, unit, changePct: ch, better, trend };
}

function zonedParts(timeZone: string) {
  let fmt: Intl.DateTimeFormat;
  try { fmt = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23", weekday: "short" }); }
  catch { fmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", hourCycle: "h23", weekday: "short" }); }
  return (t: number) => {
    let hour = 0, wd = 0;
    for (const p of fmt.formatToParts(new Date(t))) {
      if (p.type === "hour") hour = Number(p.value) % 24;
      else if (p.type === "weekday") wd = Math.max(0, WEEKDAYS.indexOf(p.value as (typeof WEEKDAYS)[number]));
    }
    return { hour, wd };
  };
}

export function buildFacts(input: ReportInput): ReportFacts {
  const { range, assets } = input;
  const alarmsIncluded = input.alarmsIncluded ?? true;
  const prev = previousRange(range);
  const spanMs = range.to.getTime() - range.from.getTime();
  const hours = Math.max(1, Math.round(spanMs / 3_600_000));
  const days = spanMs / 86_400_000;
  const nameOf = new Map(assets.map((a) => [a.id, a.name]));
  const inScope = (id: string) => nameOf.has(id);
  const prevBy = new Map(input.prevStats.filter((p) => inScope(p.assetId)).map((p) => [`${p.assetId}\u0000${p.metric}`, p]));

  const allMetrics: MetricFact[] = input.stats
    .filter((s) => inScope(s.assetId) && s.n > 0)
    .map((s) => {
      const p = prevBy.get(`${s.assetId}\u0000${s.metric}`);
      const prevAvg = p && p.n > 0 && p.avg != null ? round(p.avg, 3) : null;
      const avg = s.avg == null ? null : round(s.avg, 3);
      return {
        assetId: s.assetId, assetName: nameOf.get(s.assetId)!, metric: s.metric, readings: s.n,
        min: s.min == null ? null : round(s.min, 3), avg, max: s.max == null ? null : round(s.max, 3),
        prevAvg, changePct: changePct(avg, prevAvg),
      };
    })
    .sort((a, b) => a.assetName.localeCompare(b.assetName) || a.metric.localeCompare(b.metric));

  const topMovers = allMetrics
    .filter((m) => m.changePct != null && m.readings >= 3)
    .sort((a, b) => Math.abs(b.changePct!) - Math.abs(a.changePct!))
    .slice(0, 10);

  const energy: EnergyFact[] = allMetrics
    .filter((m) => ENERGY_RE.test(m.metric) || POWER_RE.test(m.metric))
    .map((m) => {
      const kind = ENERGY_RE.test(m.metric) ? "energy" as const : "power" as const;
      // Energy readings are counters: what was used in the period is the rise.
      const rise = kind === "energy" && m.min != null && m.max != null ? round(m.max - m.min, 3) : null;
      return { ...m, kind, rise };
    });
  const energyUsedKwh = energyKwh(allMetrics);
  const prevEnergyUsedKwh = energyKwh(input.prevStats.filter((p) => inScope(p.assetId) && p.n > 0));

  // ── alarms ────────────────────────────────────────────────────────────────
  const alarms = alarmsIncluded ? input.alarms.filter((a) => inScope(a.assetId)) : [];
  const prevAlarms = alarmsIncluded ? (input.prevAlarms ?? []).filter((a) => inScope(a.assetId)) : [];
  const cur = alarmSummary(alarms), old = alarmSummary(prevAlarms);
  const perAsset = new Map<string, { total: number; critical: number; high: number; open: number }>();
  const perAlarm = new Map<string, { name: string; assetName: string; severity: Severity; count: number; times: number[] }>();
  const end = range.to.getTime();
  for (const a of alarms) {
    const sev = sevOf(a.severity);
    const pa = perAsset.get(a.assetId) ?? { total: 0, critical: 0, high: 0, open: 0 };
    pa.total++; if (sev === "critical") pa.critical++; if (sev === "high") pa.high++;
    const clr = ms(a.clearedAt);
    if (clr == null || clr > end) pa.open++;
    perAsset.set(a.assetId, pa);
    const key = `${a.assetId}\u0000${a.name}`;
    const pr = perAlarm.get(key) ?? { name: a.name, assetName: nameOf.get(a.assetId)!, severity: sev, count: 0, times: [] };
    pr.count++; pr.times.push(ms(a.triggeredAt)!);
    if (SEVERITIES.indexOf(sev) < SEVERITIES.indexOf(pr.severity)) pr.severity = sev;
    perAlarm.set(key, pr);
  }
  const alarmAssets = [...perAsset.entries()]
    .map(([assetId, v]) => ({ assetId, assetName: nameOf.get(assetId)!, total: v.total, critical: v.critical, high: v.high }))
    .sort((a, b) => b.critical - a.critical || b.high - a.high || b.total - a.total || a.assetName.localeCompare(b.assetName))
    .slice(0, 10);
  const topAlarms = [...perAlarm.values()]
    .map(({ name, assetName, severity, count }) => ({ name, assetName, severity, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 10);
  const repeatAlarms = [...perAlarm.values()]
    .filter((p) => p.count >= 3)
    .map((p) => {
      const ts = [...p.times].sort((x, y) => x - y);
      const gaps = ts.slice(1).map((t, i) => t - ts[i]!).sort((x, y) => x - y);
      const mid = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : null;
      return {
        name: p.name, assetName: p.assetName, severity: p.severity, count: p.count,
        firstAt: new Date(ts[0]!).toISOString(), lastAt: new Date(ts[ts.length - 1]!).toISOString(),
        medianGapMinutes: mid == null ? null : round(mid / 60_000, 1),
      };
    })
    .sort((a, b) => b.count - a.count || SEVERITIES.indexOf(sevOf(a.severity)) - SEVERITIES.indexOf(sevOf(b.severity)))
    .slice(0, 10);

  // Alarm timing in the reader's time zone.
  const tz = input.timeZone || "UTC";
  const parts = zonedParts(tz);
  const byHour = Array.from({ length: 24 }, () => 0), byWeekday = Array.from({ length: 7 }, () => 0);
  for (const a of alarms) { const p = parts(ms(a.triggeredAt)!); byHour[p.hour]!++; byWeekday[p.wd]!++; }
  let peakWindow: ReportFacts["alarmTiming"]["peakWindow"] = null;
  if (alarms.length >= 6) {
    let best = -1, bestStart = 0;
    for (let h = 0; h < 24; h++) { const c = byHour[h]! + byHour[(h + 1) % 24]! + byHour[(h + 2) % 24]!; if (c > best) { best = c; bestStart = h; } }
    peakWindow = { startHour: bestStart, endHour: (bestStart + 3) % 24, alarms: best, sharePct: round((best / alarms.length) * 100, 1) };
  }
  let peakWeekday: ReportFacts["alarmTiming"]["peakWeekday"] = null;
  if (alarms.length >= 7 && days >= 6.5) {
    const i = byWeekday.indexOf(Math.max(...byWeekday));
    peakWeekday = { day: WEEKDAYS[i]!, alarms: byWeekday[i]!, sharePct: round((byWeekday[i]! / alarms.length) * 100, 1) };
  }
  const alarmTimeline = [...alarms]
    .sort((a, b) => ms(a.triggeredAt)! - ms(b.triggeredAt)!)
    .slice(-40)
    .map((a) => {
      const t = ms(a.triggeredAt)!, ack = ms(a.acknowledgedAt), clr = ms(a.clearedAt);
      return {
        assetName: nameOf.get(a.assetId)!, name: a.name, severity: sevOf(a.severity), triggeredAt: iso(a.triggeredAt),
        ackMinutes: ack != null && ack >= t ? round((ack - t) / 60_000, 1) : null,
        clearMinutes: clr != null && clr >= t ? round((clr - t) / 60_000, 1) : null,
      };
    });

  // ── data quality ──────────────────────────────────────────────────────────
  const reporting = new Set(allMetrics.map((m) => m.assetId));
  const prevReporting = new Set(input.prevStats.filter((p) => inScope(p.assetId) && p.n > 0).map((p) => p.assetId));
  const lastBy = new Map(input.lastSeen.map((l) => [l.assetId, ms(l.ts)]));
  const stale = assets
    .filter((a) => reporting.has(a.id) || lastBy.get(a.id) != null)
    .filter((a) => { const l = lastBy.get(a.id); return l == null || end - l > STALE_AFTER_MS; })
    .map((a) => { const l = lastBy.get(a.id); return { assetId: a.id, assetName: a.name, lastSeen: l == null ? null : new Date(l).toISOString() }; })
    .sort((a, b) => a.assetName.localeCompare(b.assetName));
  // Assets that sent data at some time but nothing in this period.
  const silent = assets.filter((a) => !reporting.has(a.id) && lastBy.get(a.id) != null)
    .map((a) => ({ assetId: a.id, assetName: a.name })).sort((a, b) => a.assetName.localeCompare(b.assetName));
  const covBy = new Map(input.coverage.filter((c) => inScope(c.assetId)).map((c) => [c.assetId, Math.min(c.hours, hours)]));
  const coverageOf = (id: string) => round(((covBy.get(id) ?? 0) / hours) * 100, 1);
  const lowCoverage = [...reporting]
    .map((id) => ({ assetId: id, assetName: nameOf.get(id)!, coveragePct: coverageOf(id) }))
    .filter((c) => c.coveragePct < 90)
    .sort((a, b) => a.coveragePct - b.coveragePct || a.assetName.localeCompare(b.assetName))
    .slice(0, 20);
  const dataCoveragePct = reporting.size ? round([...reporting].reduce((s, id) => s + coverageOf(id), 0) / reporting.size, 1) : null;
  const prevCovBy = new Map((input.prevCoverage ?? []).filter((c) => inScope(c.assetId)).map((c) => [c.assetId, Math.min(c.hours, hours)]));
  const prevCovIds = [...prevReporting].filter((id) => prevCovBy.has(id));
  const prevDataCoveragePct = prevCovIds.length ? round(prevCovIds.reduce((s, id) => s + (prevCovBy.get(id)! / hours) * 100, 0) / prevCovIds.length, 1) : null;
  // A sensor that reported the same value all period (20+ readings) may be stuck.
  const stuck = allMetrics
    .filter((m) => m.readings >= 20 && m.min != null && m.max != null && m.min === m.max)
    .slice(0, 15)
    .map((m) => ({ assetName: m.assetName, metric: m.metric, value: m.min!, readings: m.readings }));

  // ── maintenance and asset status ──────────────────────────────────────────
  const maintenance = assets.filter((a) => a.maintenanceMode).map((a) => {
    const since = ms(a.maintenanceSince ?? null);
    const startIn = since == null ? null : Math.max(since, range.from.getTime());
    return {
      assetId: a.id, assetName: a.name, since: since == null ? null : new Date(since).toISOString(),
      hoursInPeriod: startIn == null || startIn >= end ? (since != null && since >= end ? 0 : null) : round((end - startIn) / 3_600_000, 1),
    };
  }).sort((a, b) => a.assetName.localeCompare(b.assetName)).slice(0, 30);

  const STATUS_ORDER: AssetStatus[] = ["alarm", "stale", "silent", "maintenance", "ok", "no_data"];
  const staleIds = new Set(stale.map((s) => s.assetId));
  const assetHealthAll: AssetHealthFact[] = assets.map((a) => {
    const pa = perAsset.get(a.id);
    const l = lastBy.get(a.id);
    const status: AssetStatus = a.maintenanceMode ? "maintenance"
      : (pa?.open ?? 0) > 0 ? "alarm"
      : reporting.has(a.id) ? (staleIds.has(a.id) ? "stale" : "ok")
      : l != null ? "silent" : "no_data";
    return {
      assetId: a.id, assetName: a.name, status, alarms: pa?.total ?? 0, openAlarms: pa?.open ?? 0,
      coveragePct: reporting.has(a.id) ? coverageOf(a.id) : null, lastSeen: l == null ? null : new Date(l).toISOString(),
    };
  });
  const statusCounts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<AssetStatus, number>;
  for (const h of assetHealthAll) statusCounts[h.status]++;
  const assetHealth = assetHealthAll
    .filter((h) => h.status !== "no_data")
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.alarms - a.alarms || a.assetName.localeCompare(b.assetName))
    .slice(0, 50);

  // ── health score ──────────────────────────────────────────────────────────
  const monitoredIds = assets.filter((a) => !a.maintenanceMode && (reporting.has(a.id) || prevReporting.has(a.id) || lastBy.get(a.id) != null)).map((a) => a.id);
  const monitored = monitoredIds.length;
  const availability = monitored ? monitoredIds.filter((id) => reporting.has(id)).length / monitored : null;
  const prevAvailability = monitored ? monitoredIds.filter((id) => prevReporting.has(id)).length / monitored : null;
  const nowScore = healthScore({ availability, coverage: dataCoveragePct == null ? null : dataCoveragePct / 100, bySeverity: alarmsIncluded ? cur.bySeverity : null, monitored, days });
  const prevScore = prevReporting.size
    ? healthScore({ availability: prevAvailability, coverage: prevDataCoveragePct == null ? null : prevDataCoveragePct / 100, bySeverity: alarmsIncluded ? old.bySeverity : null, monitored, days }).score
    : null;

  // ── trends, correlations and leading signals (from time buckets) ─────────
  const bucketMs = input.bucketMs ?? bucketMsFor(range);
  const series = new Map<string, Map<string, Map<number, number>>>(); // asset → metric → t → avg
  for (const b of input.buckets ?? []) {
    if (!inScope(b.assetId) || !Number.isFinite(b.avg)) continue;
    let m = series.get(b.assetId); if (!m) { m = new Map(); series.set(b.assetId, m); }
    let s = m.get(b.metric); if (!s) { s = new Map(); m.set(b.metric, s); }
    s.set(b.t, b.avg);
  }
  const trends = topMovers.slice(0, 4).map((mv) => {
    const s = series.get(mv.assetId)?.get(mv.metric);
    const points = s ? [...s.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t: new Date(t).toISOString(), v: round(v, 3) })) : [];
    return { assetName: mv.assetName, metric: mv.metric, points };
  }).filter((t) => t.points.length >= 2);

  const readingsOf = new Map(allMetrics.map((m) => [`${m.assetId}\u0000${m.metric}`, m.readings]));
  const correlations: ReportFacts["correlations"] = [];
  for (const [assetId, metrics] of series) {
    const names = [...metrics.keys()].sort((a, b) => (readingsOf.get(`${assetId}\u0000${b}`) ?? 0) - (readingsOf.get(`${assetId}\u0000${a}`) ?? 0)).slice(0, 12);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const A = metrics.get(names[i]!)!, B = metrics.get(names[j]!)!;
      const xs: number[] = [], ys: number[] = [];
      for (const [t, v] of A) { const w = B.get(t); if (w != null) { xs.push(v); ys.push(w); } }
      if (xs.length < 8) continue;
      const r = pearson(xs, ys);
      if (r != null && Math.abs(r) >= 0.7) correlations.push({ assetId, assetName: nameOf.get(assetId)!, metricA: names[i]!, metricB: names[j]!, r: round(r, 2), points: xs.length });
    }
  }
  correlations.sort((a, b) => Math.abs(b.r) - Math.abs(a.r) || b.points - a.points);

  const leadingSignals: ReportFacts["leadingSignals"] = [];
  const alarmsByAsset = new Map<string, AlarmRow[]>();
  for (const a of alarms) alarmsByAsset.set(a.assetId, [...(alarmsByAsset.get(a.assetId) ?? []), a]);
  for (const [assetId, list] of alarmsByAsset) {
    const metrics = series.get(assetId);
    if (!metrics) continue;
    const byName = new Map<string, number[]>();
    for (const a of list.slice(0, 200)) byName.set(a.name, [...(byName.get(a.name) ?? []), ms(a.triggeredAt)!]);
    for (const [alarm, times] of byName) {
      let best: ReportFacts["leadingSignals"][number] | null = null;
      for (const [metric, s] of metrics) {
        const pts = [...s.entries()].sort((a, b) => a[0] - b[0]);
        if (pts.length < 8) continue;
        const vals = pts.map((p) => p[1]);
        const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
        const sd = Math.sqrt(vals.reduce((x, y) => x + (y - mean) ** 2, 0) / vals.length);
        if (sd <= 1e-9) continue;
        const before: number[] = [];
        for (const t of times) {
          // The last full bucket that ended before the alarm.
          let v: number | null = null;
          for (const [bt, bv] of pts) { if (bt + bucketMs <= t) v = bv; else break; }
          if (v != null) before.push(v);
        }
        if (!before.length) continue;
        const bAvg = before.reduce((x, y) => x + y, 0) / before.length;
        const z = (bAvg - mean) / sd;
        const strong = Math.abs(z) >= 2.5 || (before.length >= 2 && Math.abs(z) >= 1.5);
        if (strong && (!best || Math.abs(z) > Math.abs(best.zScore))) {
          best = { assetId, assetName: nameOf.get(assetId)!, alarm, metric, alarms: before.length, direction: z > 0 ? "rose" : "fell", beforeAvg: round(bAvg, 3), normalAvg: round(mean, 3), zScore: round(z, 1) };
        }
      }
      if (best) leadingSignals.push(best);
    }
  }
  leadingSignals.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

  // ── KPI cards (computed here, never by the model) ─────────────────────────
  const kpiCards: KpiCard[] = [];
  if (nowScore.score != null) kpiCards.push(card("health", "Plant health score", nowScore.score, prevScore, "/100", "higher"));
  kpiCards.push(card("coverage", "Data availability", dataCoveragePct, prevDataCoveragePct, "%", "higher"));
  if (alarmsIncluded) {
    kpiCards.push(card("severe", "Critical and high alarms", cur.bySeverity.critical + cur.bySeverity.high, input.prevAlarms ? old.bySeverity.critical + old.bySeverity.high : null, "", "lower"));
    kpiCards.push(card("alarms", "All alarms", cur.total, input.prevAlarms ? old.total : null, "", "lower"));
    kpiCards.push(card("mttr", "Mean time to clear", cur.mttr, old.mttr, "min", "lower"));
  }
  if (energyUsedKwh != null) kpiCards.push(card("energy", "Energy used", energyUsedKwh, prevEnergyUsedKwh, "kWh", null));
  if (kpiCards.length < 6 && alarmsIncluded) kpiCards.push(card("mtta", "Mean time to acknowledge", cur.mtta, old.mtta, "min", "lower"));

  return {
    level: input.level,
    scope: { assetId: input.scope.assetId, name: input.scope.name, assetCount: assets.length },
    range: { from: iso(range.from), to: iso(range.to), hours },
    previous: { from: iso(prev.from), to: iso(prev.to) },
    alarmsIncluded,
    kpis: {
      assets: assets.length,
      assetsReporting: reporting.size,
      staleAssets: stale.length,
      inMaintenance: assets.filter((a) => a.maintenanceMode).length,
      metricsTracked: allMetrics.length,
      readings: allMetrics.reduce((s, m) => s + m.readings, 0),
      dataCoveragePct,
      alarms: cur.total,
      alarmsBySeverity: cur.bySeverity,
      stillOpen: cur.open,
      acknowledged: cur.ackN,
      mttaMinutes: cur.mtta,
      cleared: cur.clrN,
      mttrMinutes: cur.mttr,
      energyUsedKwh,
    },
    previousKpis: {
      assetsReporting: prevReporting.size, dataCoveragePct: prevDataCoveragePct,
      alarms: old.total, alarmsBySeverity: old.bySeverity, mttaMinutes: old.mtta, mttrMinutes: old.mttr, energyUsedKwh: prevEnergyUsedKwh,
    },
    healthScore: {
      score: nowScore.score, prevScore,
      parts: { availabilityPct: availability == null ? null : round(availability * 100, 1), coveragePct: dataCoveragePct, alarmBurdenPerAssetDay: nowScore.burden },
      formula: HEALTH_FORMULA,
    },
    kpiCards: kpiCards.slice(0, 6),
    assetHealth,
    statusCounts,
    metrics: allMetrics.slice(0, MAX_METRICS),
    topMovers,
    trends,
    correlations: correlations.slice(0, 10),
    leadingSignals: leadingSignals.slice(0, 10),
    alarmAssets,
    topAlarms,
    repeatAlarms,
    alarmTiming: { timeZone: tz, byHour, byWeekday, peakWindow, peakWeekday },
    alarmTimeline,
    maintenance,
    energy: energy.slice(0, 60),
    dataQuality: { stale: stale.slice(0, 30), lowCoverage, silent: silent.slice(0, 30), stuck },
    truncated: { metrics: allMetrics.length > MAX_METRICS },
  };
}

// ── narrative ────────────────────────────────────────────────────────────────

export type Confidence = "low" | "medium" | "high";
export type Urgency = "immediate" | "this_week" | "planned";

export interface ExecutiveNarrative {
  level: "executive";
  headline: string;
  summary: string;
  risks: { title: string; what: string; impact: string; cause: string; decision: string }[];
  improvements: string[];
  decisions: string[];
  outlook: string;
}
export interface ManagerNarrative {
  level: "manager";
  summary: string;
  problemAreas: { area: string; issue: string; impact: string; cause: string }[];
  response: string;
  patterns: string[];
  priorities: { action: string; owner: string }[];
}
export interface EngineerNarrative {
  level: "engineer";
  summary: string;
  diagnoses: { asset: string; observation: string; correlated: string; rootCause: string; confidence: Confidence }[];
  alarmSequence: string[];
  dataIssues: string[];
  actions: { action: string; urgency: Urgency }[];
}
export type ReportNarrative = ExecutiveNarrative | ManagerNarrative | EngineerNarrative;

const slimMetric = (m: MetricFact) => ({ asset: m.assetName, metric: m.metric, min: m.min, avg: m.avg, max: m.max, prevAvg: m.prevAvg, changePct: m.changePct });
const noId = <T extends { assetId?: string }>(r: T) => { const { assetId: _id, ...rest } = r; return rest; };

/**
 * The part of the facts the model reads for a level: what that reader needs,
 * kept small so the request stays inside the provider's per-minute token limit.
 * Asset ids are never sent.
 */
export function factsForModel(f: ReportFacts): Record<string, unknown> {
  const base = {
    scope: f.scope.name, assets: f.scope.assetCount, from: f.range.from, to: f.range.to, hours: f.range.hours,
    alarmDataIncluded: f.alarmsIncluded,
  };
  const dq = {
    staleAssets: f.dataQuality.stale.length, silentAssets: f.dataQuality.silent.length,
    lowCoverage: f.dataQuality.lowCoverage.slice(0, 5).map(noId), stuckSensors: f.dataQuality.stuck.slice(0, 5),
  };
  if (f.level === "executive") {
    return {
      ...base,
      kpiCards: f.kpiCards.map(({ key: _k, ...c }) => c),
      healthScore: { score: f.healthScore.score, prevScore: f.healthScore.prevScore, parts: f.healthScore.parts },
      assetStatus: f.statusCounts,
      worstAssets: f.alarmAssets.slice(0, 5).map(noId),
      repeatAlarms: f.repeatAlarms.slice(0, 5).map(({ firstAt: _a, lastAt: _b, ...r }) => r),
      biggestChanges: f.topMovers.slice(0, 5).map(slimMetric),
      earlyWarnings: f.leadingSignals.slice(0, 3).map(noId),
      maintenance: f.maintenance.slice(0, 5).map(noId),
      dataQuality: dq,
    };
  }
  if (f.level === "manager") {
    return {
      ...base,
      kpis: f.kpis, previous: f.previousKpis,
      kpiCards: f.kpiCards.map(({ key: _k, ...c }) => c),
      problemAssets: f.assetHealth.filter((h) => h.status !== "ok").slice(0, 12).map(noId),
      alarmAssets: f.alarmAssets.map(noId),
      topAlarms: f.topAlarms.slice(0, 8),
      repeatAlarms: f.repeatAlarms.slice(0, 8).map(({ firstAt: _a, lastAt: _b, ...r }) => r),
      alarmTiming: { peakWindow: f.alarmTiming.peakWindow, peakWeekday: f.alarmTiming.peakWeekday, timeZone: f.alarmTiming.timeZone },
      biggestChanges: f.topMovers.slice(0, 6).map(slimMetric),
      maintenance: f.maintenance.slice(0, 8).map(noId),
      dataQuality: dq,
    };
  }
  return {
    ...base,
    kpis: f.kpis,
    biggestChanges: f.topMovers.map(slimMetric),
    metrics: f.metrics.filter((m) => f.topMovers.every((t) => t.assetId !== m.assetId || t.metric !== m.metric)).slice(0, 20).map(slimMetric),
    correlations: f.correlations.slice(0, 8).map(noId),
    leadingSignals: f.leadingSignals.slice(0, 8).map(noId),
    alarmTimeline: f.alarmTimeline.slice(-20),
    repeatAlarms: f.repeatAlarms.slice(0, 8),
    problemAssets: f.assetHealth.filter((h) => h.status !== "ok").slice(0, 12).map(noId),
    dataQuality: {
      stale: f.dataQuality.stale.slice(0, 10).map((s) => ({ asset: s.assetName, lastSeen: s.lastSeen })),
      silent: f.dataQuality.silent.slice(0, 10).map((s) => s.assetName),
      lowCoverage: f.dataQuality.lowCoverage.slice(0, 10).map(noId),
      stuckSensors: f.dataQuality.stuck.slice(0, 10),
    },
  };
}

const COMMON_RULES =
  "You write the narrative of an industrial operations report. You receive facts as JSON that were computed from the plant database. " +
  "Rules: use ONLY these facts. Never invent, estimate or recalculate numbers; quote a number only exactly as it appears in the facts. " +
  "Explain WHY things happened where the facts support it (correlations, early warnings before alarms, repeat alarms, alarm timing, maintenance, data gaps). " +
  "Causes are hypotheses: phrase them with 'may', 'likely' or 'could' and name the fact they rest on. If the facts do not support a statement, leave it out. " +
  "If alarmDataIncluded is false, do not discuss alarms. Plain English, no markdown, no bullet characters inside strings. " +
  "Answer with one JSON object and nothing else.";

const LEVEL_PROMPT: Record<ReportLevel, string> = {
  executive:
    "The reader is an executive (owner, company administrator or project manager) who must present this in a short meeting. " +
    "Use plain business language: impact on output, safety, cost, reliability and customers. Avoid tag names and technical jargon unless needed. Be short. " +
    'JSON shape: {"headline": string (one sentence: the state of the plant this period), "summary": string (2-4 sentences), ' +
    '"risks": [{"title": string, "what": string, "impact": string (why it matters to the business), "cause": string (likely cause), "decision": string (recommended decision)}] (at most 3, most important first), ' +
    '"improvements": string[] (0-3, what got better), "decisions": string[] (1-4, decisions or approvals needed from management), "outlook": string (1-2 sentences on the next period)}.',
  manager:
    "The reader is a manager or team lead who assigns work. Focus on problem areas ranked by impact, response performance (MTTA, MTTR) and how it changed, recurring patterns, and what the team should do first. " +
    'JSON shape: {"summary": string (3-5 sentences), "problemAreas": [{"area": string (asset or area), "issue": string, "impact": string, "cause": string}] (2-6, highest impact first), ' +
    '"response": string (2-3 sentences on acknowledgement and clearing times and their trend), "patterns": string[] (1-5: repeat alarms, time-of-day or weekday concentration, maintenance, data gaps), ' +
    '"priorities": [{"action": string, "owner": string (suggested role, e.g. maintenance engineer, operator, instrumentation, control room, data/IT)}] (3-6, in order)}.',
  engineer:
    "The reader is an engineer who works on the equipment and data. Give a technical diagnosis per asset: abnormal readings, metrics that move together, signals that changed before alarms, the likely root cause and how confident the facts make you. " +
    'JSON shape: {"summary": string (3-5 sentences), "diagnoses": [{"asset": string, "observation": string, "correlated": string (related metrics or early signals, or empty), "rootCause": string, "confidence": "low"|"medium"|"high"}] (2-6), ' +
    '"alarmSequence": string[] (0-6, what triggered which alarms and in what order), "dataIssues": string[] (0-5, sensor and data-quality problems), ' +
    '"actions": [{"action": string (specific and checkable), "urgency": "immediate"|"this_week"|"planned"}] (3-6)}.',
};

export function reportMessages(f: ReportFacts): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: `${COMMON_RULES} ${LEVEL_PROMPT[f.level]}` },
    { role: "user", content: `Report level: ${f.level}.\nFacts:\n${JSON.stringify(factsForModel(f))}` },
  ];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const str = (v: unknown, n = 600) => (typeof v === "string" ? clip(v.trim(), n) : "");
const strList = (v: unknown, max = 8) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => clip(x.trim(), 600)).slice(0, max) : []);
const objList = <T>(v: unknown, max: number, map: (o: Record<string, unknown>) => T | null): T[] =>
  (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)).map(map).filter((x): x is T => x !== null).slice(0, max) : []);

/** The model's JSON answer for a level, checked and trimmed, or null when it is not usable. */
export function parseNarrative(text: unknown, level: ReportLevel): ReportNarrative | null {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: any;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const summary = str(raw.summary, 2000);
  if (level === "executive") {
    const headline = str(raw.headline, 300);
    const risks = objList(raw.risks, 3, (o) => {
      const r = { title: str(o.title, 200), what: str(o.what), impact: str(o.impact), cause: str(o.cause), decision: str(o.decision) };
      return r.title || r.what ? r : null;
    });
    const decisions = strList(raw.decisions, 5);
    if (!headline || !summary || (!risks.length && !decisions.length)) return null;
    return { level, headline, summary, risks, improvements: strList(raw.improvements, 4), decisions, outlook: str(raw.outlook, 800) };
  }
  if (level === "manager") {
    const problemAreas = objList(raw.problemAreas, 6, (o) => {
      const r = { area: str(o.area, 200), issue: str(o.issue), impact: str(o.impact), cause: str(o.cause) };
      return r.area || r.issue ? r : null;
    });
    const priorities = objList(raw.priorities, 6, (o) => { const action = str(o.action); return action ? { action, owner: str(o.owner, 120) } : null; });
    if (!summary || (!problemAreas.length && !priorities.length)) return null;
    return { level, summary, problemAreas, response: str(raw.response, 1000), patterns: strList(raw.patterns, 5), priorities };
  }
  const conf = (v: unknown): Confidence => (v === "low" || v === "high" ? v : "medium");
  const urg = (v: unknown): Urgency => (v === "immediate" || v === "planned" ? v : "this_week");
  const diagnoses = objList(raw.diagnoses, 6, (o) => {
    const r = { asset: str(o.asset, 200), observation: str(o.observation), correlated: str(o.correlated), rootCause: str(o.rootCause), confidence: conf(o.confidence) };
    return r.asset || r.observation ? r : null;
  });
  const actions = objList(raw.actions, 6, (o) => { const action = str(o.action); return action ? { action, urgency: urg(o.urgency) } : null; });
  if (!summary || (!diagnoses.length && !actions.length)) return null;
  return { level: "engineer", summary, diagnoses, alarmSequence: strList(raw.alarmSequence, 6), dataIssues: strList(raw.dataIssues, 5), actions };
}

/** Every free-text string of a narrative (not its enum fields), for the number check and exports. */
export function narrativeTexts(n: ReportNarrative): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key?: string) => {
    if (typeof v === "string") { if (key !== "level" && key !== "confidence" && key !== "urgency") out.push(v); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => walk(x, k));
  };
  walk(n);
  return out;
}

/** Every number in the facts, for checking the narrative against them. */
function factNumbers(f: ReportFacts): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(f);
  return out;
}

/**
 * Numbers in the narrative that do not appear in the facts (allowing rounding),
 * shown to the reader as "check these". Small counts (0-10) and years are not
 * checked: "three assets", "top 5" and dates are not claims about plant data.
 */
export function unverifiedNumbers(n: ReportNarrative, f: ReportFacts): string[] {
  const known = factNumbers(f);
  const text = narrativeTexts(n).join(" \n ")
    // Dates and clock times are not plant figures.
    .replace(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/gi, " ")
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/gi, " ")
    // Identifiers such as "TT-101" or "Pump 3B" name things; they are not figures.
    .replace(/\b[A-Za-z]+[-_ ]?\d+[A-Za-z]?\b/g, (m) => (/^[A-Za-z]{1,5}[-_]?\d/.test(m) && !/^\d/.test(m) ? " " : m));
  const found = new Set<string>();
  for (const m of text.matchAll(/-?\d+(?:[.,]\d+)?/g)) {
    const s = m[0].replace(",", ".");
    const v = Number(s);
    if (!Number.isFinite(v)) continue;
    if (Number.isInteger(v) && Math.abs(v) <= 10) continue;
    if (Number.isInteger(v) && v >= 1990 && v <= 2100) continue;
    const decimals = (s.split(".")[1] ?? "").length;
    const tol = 0.5 * 10 ** -decimals + 1e-9;
    const ok = known.some((k) => Math.abs(Math.abs(k) - Math.abs(v)) <= tol);
    if (!ok) found.add(m[0]);
  }
  return [...found].slice(0, 20);
}

/** Request body checks; returns an error message or the parsed values. `focus` from older links is ignored. */
export function parseReportRequest(body: any, now = new Date()): string | { assetId: string | null; range: { from: Date; to: Date }; timeZone: string } {
  const assetId = body?.assetId == null || body.assetId === "" ? null : body.assetId;
  if (assetId !== null && (typeof assetId !== "string" || !/^[0-9a-f-]{36}$/i.test(assetId))) return "The asset id is not valid.";
  const from = new Date(body?.range?.from), to = new Date(body?.range?.to);
  if (typeof body?.range?.from !== "string" || typeof body?.range?.to !== "string" || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return "Select a start and end time for the report.";
  }
  if (from >= to) return "The start time must be earlier than the end time.";
  if (to.getTime() - from.getTime() > REPORT_MAX_DAYS * 86_400_000) return `A report covers at most ${REPORT_MAX_DAYS} days.`;
  if (from.getTime() > now.getTime()) return "The report period is in the future.";
  let timeZone = "UTC";
  if (typeof body?.timeZone === "string" && body.timeZone.length <= 64) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: body.timeZone }); timeZone = body.timeZone; } catch { /* fall back to UTC */ }
  }
  return { assetId, range: { from, to: to > now ? now : to }, timeZone };
}

/** Messages shown when the narrative cannot be written; the figures are complete either way. */
export const NARRATIVE_MESSAGES = {
  unavailable: "AI insights are not available right now (AI Advisor needs its licence and an internet connection). The figures below are complete.",
  unreadable: "The AI answer could not be read. The figures below are complete; try again for the written insight.",
  failed: "The AI service did not answer this time. The figures below are complete; try again for the written insight.",
} as const;
