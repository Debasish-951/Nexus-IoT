/** Response of POST /api/ai/report (see api-server lib/ai-report.ts for how each figure is computed). */
export type ReportLevel = "executive" | "manager" | "engineer";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type AssetStatus = "alarm" | "stale" | "silent" | "maintenance" | "ok" | "no_data";

export interface MetricFact {
  assetId: string; assetName: string; metric: string;
  readings: number; min: number | null; avg: number | null; max: number | null;
  prevAvg: number | null; changePct: number | null;
}
export interface EnergyFact extends MetricFact { kind: "energy" | "power"; rise: number | null }
export interface KpiCard {
  key: string; label: string; value: number | null; prev: number | null; unit: string;
  changePct: number | null; better: "higher" | "lower" | null; trend: "better" | "worse" | "same" | null;
}
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

export type NarrativeStatus = "ok" | "unavailable" | "failed" | "rate_limited" | "unreadable";

/** How the narrative was written: investigated (the AI looked up the database), single (from the figures alone) or none. */
export interface Investigation {
  mode: "investigated" | "single" | "none";
  steps: { tool: string; summary: string }[];
  toolCalls: number;
  durationMs: number;
}

export interface AiReport {
  level: ReportLevel;
  facts: ReportFacts;
  narrative: ReportNarrative | null;
  narrativeStatus: NarrativeStatus;
  narrativeError: string | null;
  unverifiedNumbers: string[];
  /** Absent from servers older than the investigation. */
  investigation?: Investigation;
  alarmsIncluded: boolean;
  generatedAt: string;
  range: { from: string; to: string };
  scope: { assetId: string | null; name: string; assetCount: number };
  model: string | null;
}

/** Plain names of the database lookups the AI can make, for the reader. */
export const TOOL_LABEL: Record<string, string> = {
  resolve_asset: "Found assets and metrics by name",
  list_assets: "Listed the assets",
  list_metrics: "Listed an asset's metrics",
  get_latest_telemetry: "Read the latest readings",
  query_telemetry: "Read a metric's history",
  aggregate_telemetry: "Analysed a metric's statistics",
  compare_metrics: "Compared a metric across machines",
  asset_health: "Checked an asset's health",
  get_alarms: "Read the current alarms",
  get_alarm_history: "Read the alarm history",
  fleet_summary: "Read the plant summary",
  get_alarm_rules: "Read the alarm rules and limits",
  get_asset_attributes: "Read the asset's attributes",
  get_recent_changes: "Read recent configuration changes",
};
export const INVESTIGATION_MODE_LABEL: Record<Investigation["mode"], string> = {
  investigated: "The AI investigated the database before writing",
  single: "Written from the computed figures only (the investigation did not complete)",
  none: "No AI text",
};

export const LEVEL_LABEL: Record<ReportLevel, string> = { executive: "Executive", manager: "Manager", engineer: "Engineer" };
export const URGENCY_LABEL: Record<Urgency, string> = { immediate: "Immediate", this_week: "This week", planned: "Planned" };
export const STATUS_LABEL: Record<AssetStatus, string> = {
  alarm: "In alarm", stale: "Stale", silent: "No data this period", maintenance: "In maintenance", ok: "Healthy", no_data: "Never reported",
};
