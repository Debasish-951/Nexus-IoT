import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearch } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronDown, Database, Download, FileText, Info, Loader2, Minus, Pencil, Play, Plus, RefreshCw, Sparkles, Trash2, Check,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, LineChart, Line, CartesianGrid } from "recharts";
import { apiFetch } from "@/lib/auth-api";
import { describeApiError, formatApiError } from "@/lib/validation";
import { useProject } from "@/contexts/ProjectContext";
import { useCurrentUser } from "@/contexts/UserContext";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { AssetScopePicker } from "@/components/AssetScopePicker";
import {
  INVESTIGATION_MODE_LABEL, LEVEL_LABEL, STATUS_LABEL, TOOL_LABEL, URGENCY_LABEL,
  type AiReport, type Investigation, type EngineerNarrative, type ExecutiveNarrative, type KpiCard, type ManagerNarrative, type ReportFacts, type ReportLevel, type ReportNarrative,
} from "./types";
import { cardValue, downloadFactsCsv, downloadReportPdf } from "./exportReport";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SEV_COLORS: Record<string, string> = { critical: "#dc2626", high: "#f97316", medium: "#eab308", low: "#3b82f6", info: "#94a3b8" };
const PRESETS = [{ key: "24h", label: "Last 24 hours", hours: 24 }, { key: "7d", label: "Last 7 days", hours: 168 }, { key: "30d", label: "Last 30 days", hours: 720 }] as const;
const LINE_COLORS = ["#2563eb", "#f97316", "#16a34a", "#a855f7"];

/** What each level's report is for, shown under the page title. */
const LEVEL_ABOUT: Record<ReportLevel, string> = {
  executive: "A short, meeting-ready summary: plant health, key figures against the previous period, top risks and the decisions needed.",
  manager: "Problem areas ranked by impact, response performance, recurring patterns and the team's priorities.",
  engineer: "A technical diagnosis per asset: abnormal readings, metrics that move together, signals before alarms, likely root causes and maintenance actions.",
};
/** The same level mapping as the server (REPORT_LEVEL_BY_ROLE), to name the report before it is generated. */
const LEVEL_BY_ROLE: Record<string, ReportLevel> = {
  super_admin: "executive", company_admin: "executive", project_manager: "executive",
  admin: "manager", team_lead: "manager", viewer: "manager",
  engineer: "engineer", developer: "engineer", operator: "engineer",
};

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fmt = (v: number | null | undefined, d = 2) => (v == null ? "—" : Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: d }));
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : "—");
const roleName = (r: string | undefined) => (r ? r.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "");

/** AI Advisor → AI Reports: one report written for the reader's level, from figures computed by the server. */
export default function AiReportsPage() {
  const t = useT();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const { session } = useCurrentUser();
  const { currentProjectId } = useProject();
  const expected: ReportLevel = LEVEL_BY_ROLE[session?.role ?? ""] ?? "manager";

  const initFrom = params.get("from") ? new Date(params.get("from")!) : null;
  const initTo = params.get("to") ? new Date(params.get("to")!) : null;
  const validInit = !!(initFrom && initTo && !Number.isNaN(initFrom.getTime()) && !Number.isNaN(initTo.getTime()) && initFrom < initTo);
  const [scope, setScope] = useState<string>(params.get("assetId") || currentProjectId || "all");
  const [preset, setPreset] = useState<string>(validInit ? "custom" : "7d");
  const [from, setFrom] = useState(() => toLocalInput(validInit ? initFrom! : new Date(Date.now() - 168 * 3600_000)));
  const [to, setTo] = useState(() => toLocalInput(validInit ? initTo! : new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AiReport | null>(null);
  const [draft, setDraft] = useState<ReportNarrative | null>(null);
  const [editing, setEditing] = useState(false);
  // Seconds since Generate, shown while the report is computed and investigated.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const range = (): { from: Date; to: Date } => {
    if (preset === "custom") return { from: new Date(from), to: new Date(to) };
    const hours = PRESETS.find((p) => p.key === preset)!.hours;
    const end = new Date();
    return { from: new Date(end.getTime() - hours * 3600_000), to: end };
  };
  const r0 = range();
  const rangeError = Number.isNaN(r0.from.getTime()) || Number.isNaN(r0.to.getTime()) ? t("Set both a start and an end time.")
    : r0.from >= r0.to ? t("The start time must be earlier than the end time.")
    : r0.to.getTime() - r0.from.getTime() > 92 * 86_400_000 ? t("A report covers at most 92 days.") : null;

  async function generate() {
    if (rangeError || busy) return;
    // Clear the previous report so only the newly generated one is shown.
    setBusy(true); setError(null); setReport(null); setDraft(null); setEditing(false);
    try {
      const rg = range();
      const res = await apiFetch(`${BASE}/api/ai/report`, {
        method: "POST",
        body: JSON.stringify({
          assetId: scope === "all" ? null : scope,
          range: { from: rg.from.toISOString(), to: rg.to.toISOString() },
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!res.ok) throw new Error(formatApiError(await describeApiError(res)));
      const data = (await res.json()) as AiReport;
      // An API server built before role-based reports answers without `level`:
      // say so instead of showing an empty report whose exports cannot work.
      if (!data || !data.level || !data.facts) throw new Error(t("The API server is older than this page. Restart the API server (pnpm --filter @workspace/api-server run dev) and try again."));
      setReport(data);
      setDraft(data.narrative ? structuredClone(data.narrative) : null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const level = report?.level ?? expected;
  /** Change the narrative being edited. */
  const upd = (fn: (d: any) => void) => setDraft((d) => { if (!d) return d; const c = structuredClone(d); fn(c); return c; });
  const temporary = report && (report.narrativeStatus === "failed" || report.narrativeStatus === "rate_limited" || report.narrativeStatus === "unreadable");

  return (
    <div className="flex flex-col h-full max-w-6xl mx-auto p-4 gap-4 overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10 text-primary"><FileText className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              {t("AI Reports")}
              <Badge variant="secondary" className="gap-1 text-[11px]">{t("Report for")}: {t(LEVEL_LABEL[level])}</Badge>
            </h1>
            <p className="text-sm text-muted-foreground max-w-3xl">{t(LEVEL_ABOUT[level])}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {t("The report level comes from your role ({role}).", { role: roleName(session?.role) })}
            </p>
          </div>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[240px]">
            <Label className="text-xs">{t("Project or asset")}</Label>
            <AssetScopePicker value={scope} onChange={setScope} allLabel={t("All assets I can see")} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Period")}</Label>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} className="h-9" onClick={() => setPreset(p.key)}>{t(p.label)}</Button>
              ))}
              <Button size="sm" variant={preset === "custom" ? "default" : "outline"} className="h-9" onClick={() => setPreset("custom")}>{t("Custom")}</Button>
            </div>
          </div>
          {preset === "custom" && (
            <>
              <div className="space-y-1">
                <Label htmlFor="air-from" className="text-xs">{t("From")}</Label>
                <Input id="air-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-48 text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="air-to" className="text-xs">{t("To")}</Label>
                <Input id="air-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-48 text-xs" />
              </div>
            </>
          )}
          <Button className="h-9 gap-2" onClick={generate} disabled={busy || !!rangeError}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {busy ? t("Analysing your data…") : t("Generate")}
          </Button>
        </div>
        {rangeError && <p className="text-xs text-destructive mt-2">{rangeError}</p>}
        <p className="text-[11px] text-muted-foreground mt-2">
          {t("Every figure is computed from your platform database. The AI service then looks up more data with read-only tools, limited to this scope and period, and explains it; it cannot change anything.")}
        </p>
      </Card>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">{error}</div>}

      {busy && !report && (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground py-16 gap-2">
          <Loader2 className="w-8 h-8 animate-spin opacity-60" />
          <p className="text-sm">{elapsed < 6 ? t("Analysing your data…") : t("Investigating the database and writing the report…")} <span className="font-mono">{elapsed}s</span></p>
          <p className="text-xs">{t("This takes up to a minute.")}</p>
        </div>
      )}

      {!report && !busy && !error && (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground py-16">
          <Sparkles className="w-10 h-10 opacity-40 mb-3" />
          <p className="text-sm">{t("Pick a project or asset and a period, then press Generate.")}</p>
        </div>
      )}

      {report && (
        <div className={cn("space-y-4 pb-8", busy && "opacity-60")}>
          {/* Document header */}
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("AI Report")} · {t(LEVEL_LABEL[report.level])}</p>
                <h2 className="text-lg font-semibold">{report.facts.scope.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {when(report.facts.range.from)} – {when(report.facts.range.to)} · {t("compared with")} {when(report.facts.previous.from)} – {when(report.facts.previous.to)} · {t("{n} assets", { n: report.facts.scope.assetCount })}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("Generated")} {when(report.generatedAt)}{report.model ? ` · ${t("written sections by")} ${report.model}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {draft && (
                  <Button size="sm" variant={editing ? "default" : "outline"} className="gap-1.5" onClick={() => setEditing(!editing)}>
                    {editing ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />} {editing ? t("Done") : t("Edit text")}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadFactsCsv(report)}><Download className="w-3.5 h-3.5" /> CSV</Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void downloadReportPdf(report, draft)}><FileText className="w-3.5 h-3.5" /> PDF</Button>
              </div>
            </div>

            {report.narrativeStatus === "unavailable" && (
              <div className="mt-3 rounded-md border border-sky-500/40 bg-sky-500/10 text-sm px-3 py-2 flex gap-2">
                <Info className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
                <span>{t("AI insights are not available right now (AI Advisor needs its licence and an internet connection). The figures below are complete.")}</span>
              </div>
            )}
            {temporary && (
              <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-sm px-3 py-2 flex flex-wrap items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="flex-1 min-w-[200px]">{report.narrativeStatus === "rate_limited" ? report.narrativeError : t("The AI insight could not be written this time. The figures below are complete.")}</span>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={generate} disabled={busy}><RefreshCw className={cn("w-3.5 h-3.5", busy && "animate-spin")} /> {t("Retry")}</Button>
              </div>
            )}
            {report.unverifiedNumbers.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-xs px-3 py-2">
                {t("These numbers in the AI text were not found in the computed figures or the database lookups; check them before sharing:")} <span className="font-mono">{report.unverifiedNumbers.join(", ")}</span>
              </div>
            )}
            {report.investigation && report.investigation.mode !== "none" && <InvestigationPanel inv={report.investigation} />}
            {!report.alarmsIncluded && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-2"><Info className="w-3.5 h-3.5" />{t("Alarm figures are left out: your account has no access to Alarms.")}</p>}
            {draft && <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-2"><Sparkles className="w-3 h-3 text-primary" />{t("Sections marked AI-generated were written by AI from the figures. Check them, and edit them before exporting if needed.")}</p>}
          </Card>

          {report.level === "executive" && <ExecutiveView f={report.facts} n={draft?.level === "executive" ? draft : null} editing={editing} upd={upd} />}
          {report.level === "manager" && <ManagerView f={report.facts} n={draft?.level === "manager" ? draft : null} editing={editing} upd={upd} />}
          {report.level === "engineer" && <EngineerView f={report.facts} n={draft?.level === "engineer" ? draft : null} editing={editing} upd={upd} />}
        </div>
      )}
    </div>
  );
}

type Upd = (fn: (d: any) => void) => void;

/** "How this report was investigated": the database lookups the AI made, collapsed by default. */
function InvestigationPanel({ inv }: { inv: Investigation }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-md border text-xs">
      <button type="button" className="w-full flex items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Database className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="font-medium">{t("How this report was investigated")}</span>
        <span className="text-muted-foreground">· {t(INVESTIGATION_MODE_LABEL[inv.mode])} · {t("{n} lookups", { n: inv.toolCalls })} · {Math.round(inv.durationMs / 1000)}s</span>
        <ChevronDown className={cn("w-3.5 h-3.5 ml-auto transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t px-3 py-2">
          {inv.steps.length === 0 ? (
            <p className="text-muted-foreground">{t("The AI wrote the text from the computed figures without further lookups.")}</p>
          ) : (
            <ol className="list-decimal pl-5 space-y-1">
              {inv.steps.map((s, i) => (
                <li key={i}><span className="font-medium">{t(TOOL_LABEL[s.tool] ?? s.tool)}</span>{s.summary ? <span className="text-muted-foreground"> — {s.summary}</span> : null}</li>
              ))}
            </ol>
          )}
          <p className="text-muted-foreground mt-2">{t("Every lookup is read-only and limited to the selected project or asset, the report period and your access.")}</p>
        </div>
      )}
    </div>
  );
}

// ── building blocks ──────────────────────────────────────────────────────────

function Section({ title, ai, children, className }: { title: string; ai?: boolean; children: ReactNode; className?: string }) {
  const t = useT();
  return (
    <Card className={cn("p-4 space-y-3", ai && "border-primary/30", className)}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {ai && <Badge variant="secondary" className="gap-1 text-[10px]"><Sparkles className="w-3 h-3" />{t("AI-generated")}</Badge>}
      </div>
      {children}
    </Card>
  );
}

/** A narrative text: plain text when reading, a text box when editing. */
function Txt({ value, onChange, editing, className, rows = 2 }: { value: string; onChange: (v: string) => void; editing: boolean; className?: string; rows?: number }) {
  if (editing) return <Textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className={cn("text-sm", className)} />;
  if (!value) return null;
  return <p className={cn("text-sm leading-relaxed whitespace-pre-wrap", className)}>{value}</p>;
}

/** An editable list of sentences. */
function TxtList({ items, editing, onChange, ordered }: { items: string[]; editing: boolean; onChange: (v: string[]) => void; ordered?: boolean }) {
  const t = useT();
  if (!editing) {
    const shown = items.filter(Boolean);
    if (!shown.length) return <p className="text-xs text-muted-foreground">{t("Nothing noted.")}</p>;
    const Tag = ordered ? "ol" : "ul";
    return <Tag className={cn("text-sm space-y-1.5 pl-5", ordered ? "list-decimal" : "list-disc")}>{shown.map((s, i) => <li key={i}>{s}</li>)}</Tag>;
  }
  return (
    <div className="space-y-2">
      {items.map((s, i) => (
        <div key={i} className="flex gap-2">
          <Textarea value={s} rows={2} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} className="text-sm" />
          <Button size="icon" variant="ghost" className="shrink-0" aria-label={t("Remove")} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" className="gap-1" onClick={() => onChange([...items, ""])}><Plus className="w-3.5 h-3.5" />{t("Add")}</Button>
    </div>
  );
}

function NoInsight() {
  const t = useT();
  return <p className="text-xs text-muted-foreground italic">{t("AI insight is not available for this report; see the figures.")}</p>;
}

function Kpis({ cards }: { cards: KpiCard[] }) {
  const t = useT();
  if (!cards.length) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {cards.map((c) => {
        const Icon = c.trend === "same" ? Minus : (c.changePct ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight;
        return (
          <div key={c.key} className="rounded-lg border bg-card px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">{t(c.label)}</p>
            <p className="text-2xl font-semibold tabular-nums">{cardValue(c, c.value)}</p>
            <p className={cn("text-[11px] flex items-center gap-1", c.trend === "better" ? "text-green-600" : c.trend === "worse" ? "text-red-600" : "text-muted-foreground")}>
              {c.prev == null ? t("no previous value") : (
                <>
                  <Icon className="w-3.5 h-3.5" />
                  {c.changePct != null && `${c.changePct > 0 ? "+" : ""}${c.changePct}% · `}{t("previous")} {cardValue(c, c.prev)}
                </>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function FactTable({ title, head, rows, empty, children }: { title: string; head: string[]; rows: (string | number | ReactNode)[][]; empty?: string; children?: ReactNode }) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">{empty}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b">{head.map((h, i) => <th key={i} className={cn("py-1.5 pr-3 font-medium", i > 1 && "text-right")}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-border/50">{r.map((c, j) => <td key={j} className={cn("py-1.5 pr-3 align-top", j > 1 && "text-right tabular-nums")}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {children}
    </Card>
  );
}

function SeverityChart({ f }: { f: ReportFacts }) {
  const t = useT();
  const data = (["critical", "high", "medium", "low", "info"] as const).map((k) => ({ k: t(k), now: f.kpis.alarmsBySeverity[k], before: f.previousKpis.alarmsBySeverity[k] }));
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold mb-2">{t("Alarms by severity, against the previous period")}</h3>
      {f.kpis.alarms + f.previousKpis.alarms === 0 ? <p className="text-xs text-muted-foreground py-8 text-center">{t("No alarms in either period.")}</p> : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data}>
            <XAxis dataKey="k" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={30} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="before" name={t("Previous period")} fill="#94a3b8" />
            <Bar dataKey="now" name={t("This period")} fill="#2563eb" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function StatusChart({ f }: { f: ReportFacts }) {
  const t = useT();
  const order = ["ok", "alarm", "stale", "silent", "maintenance"] as const;
  const colors: Record<string, string> = { ok: "#22c55e", alarm: "#dc2626", stale: "#eab308", silent: "#94a3b8", maintenance: "#3b82f6" };
  const total = order.reduce((s, k) => s + f.statusCounts[k], 0);
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold mb-3">{t("Asset status at the end of the period")}</h3>
      {total === 0 ? <p className="text-xs text-muted-foreground">{t("No asset has reported data.")}</p> : (
        <>
          <div className="flex h-4 w-full overflow-hidden rounded-full">
            {order.filter((k) => f.statusCounts[k]).map((k) => <div key={k} style={{ width: `${(f.statusCounts[k] / total) * 100}%`, background: colors[k] }} title={`${t(STATUS_LABEL[k])}: ${f.statusCounts[k]}`} />)}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs">
            {order.map((k) => <span key={k} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: colors[k] }} />{t(STATUS_LABEL[k])} <b className="tabular-nums">{f.statusCounts[k]}</b></span>)}
          </div>
        </>
      )}
    </Card>
  );
}

function AttentionTable({ f, limit }: { f: ReportFacts; limit: number }) {
  const t = useT();
  const rows = f.assetHealth.filter((h) => h.status !== "ok").slice(0, limit);
  return (
    <FactTable title={t("Assets needing attention")} head={[t("Asset"), t("Status"), t("Alarms"), t("Open"), t("Data coverage")]} empty={t("Every reporting asset is healthy.")}
      rows={rows.map((h) => [h.assetName, t(STATUS_LABEL[h.status]), h.alarms, h.openAlarms, h.coveragePct == null ? "—" : `${h.coveragePct}%`])} />
  );
}

// ── executive ────────────────────────────────────────────────────────────────

function ExecutiveView({ f, n, editing, upd }: { f: ReportFacts; n: ExecutiveNarrative | null; editing: boolean; upd: Upd }) {
  const t = useT();
  return (
    <div className="space-y-4">
      <Card className="p-5 border-primary/30 space-y-2">
        <div className="flex items-center gap-2"><Badge variant="secondary" className="gap-1 text-[10px]"><Sparkles className="w-3 h-3" />{t("AI-generated")}</Badge></div>
        {n ? (
          <>
            <Txt value={n.headline} editing={editing} onChange={(v) => upd((d) => { d.headline = v; })} className="text-lg font-semibold" />
            <Txt value={n.summary} editing={editing} rows={4} onChange={(v) => upd((d) => { d.summary = v; })} className="text-muted-foreground" />
          </>
        ) : <NoInsight />}
      </Card>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("Key figures against the previous period")}</h3>
        <Kpis cards={f.kpiCards} />
        {f.healthScore.score != null && (
          <p className="text-[11px] text-muted-foreground">{t("Plant health score")}: {t("availability {a}%, data coverage {c}%", { a: fmt(f.healthScore.parts.availabilityPct, 1), c: fmt(f.healthScore.parts.coveragePct, 1) })}{f.healthScore.parts.alarmBurdenPerAssetDay != null ? `, ${t("alarm load {b} per asset per day", { b: fmt(f.healthScore.parts.alarmBurdenPerAssetDay) })}` : ""}. {t("Formula")}: {f.healthScore.formula}</p>
        )}
      </div>

      <Section title={t("Top risks")} ai>
        {!n ? <NoInsight /> : n.risks.length === 0 && !editing ? <p className="text-xs text-muted-foreground">{t("No significant risk in this period.")}</p> : (
          <div className="grid gap-3 md:grid-cols-3">
            {n.risks.map((r, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-2 bg-card">
                <div className="flex items-start gap-2">
                  <span className="w-6 h-6 rounded-full bg-red-500/15 text-red-600 text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                  <Txt value={r.title} editing={editing} onChange={(v) => upd((d) => { d.risks[i].title = v; })} className="font-semibold" />
                  {editing && <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" aria-label={t("Remove")} onClick={() => upd((d) => { d.risks.splice(i, 1); })}><Trash2 className="w-3.5 h-3.5" /></Button>}
                </div>
                <Labeled label={t("What")}><Txt value={r.what} editing={editing} onChange={(v) => upd((d) => { d.risks[i].what = v; })} /></Labeled>
                <Labeled label={t("Why it matters")}><Txt value={r.impact} editing={editing} onChange={(v) => upd((d) => { d.risks[i].impact = v; })} /></Labeled>
                <Labeled label={t("Likely cause")}><Txt value={r.cause} editing={editing} onChange={(v) => upd((d) => { d.risks[i].cause = v; })} /></Labeled>
                <Labeled label={t("Recommended decision")}><Txt value={r.decision} editing={editing} onChange={(v) => upd((d) => { d.risks[i].decision = v; })} className="font-medium" /></Labeled>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="grid md:grid-cols-2 gap-4">
        <Section title={t("Decisions needed")} ai>
          {n ? <TxtList items={n.decisions} editing={editing} ordered onChange={(v) => upd((d) => { d.decisions = v; })} /> : <NoInsight />}
        </Section>
        <Section title={t("What improved")} ai>
          {n ? <TxtList items={n.improvements} editing={editing} onChange={(v) => upd((d) => { d.improvements = v; })} /> : <NoInsight />}
        </Section>
      </div>

      <Section title={t("Outlook for the next period")} ai>
        {n ? <Txt value={n.outlook} editing={editing} rows={3} onChange={(v) => upd((d) => { d.outlook = v; })} /> : <NoInsight />}
      </Section>

      <div className="grid md:grid-cols-2 gap-4">
        <StatusChart f={f} />
        {f.alarmsIncluded && <SeverityChart f={f} />}
      </div>
      <AttentionTable f={f} limit={8} />
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return <div><p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</p>{children}</div>;
}

// ── manager ──────────────────────────────────────────────────────────────────

function ManagerView({ f, n, editing, upd }: { f: ReportFacts; n: ManagerNarrative | null; editing: boolean; upd: Upd }) {
  const t = useT();
  const hourData = f.alarmTiming.byHour.map((v, h) => ({ h: String(h).padStart(2, "0"), v }));
  return (
    <div className="space-y-4">
      <Section title={t("Summary")} ai>
        {n ? <Txt value={n.summary} editing={editing} rows={4} onChange={(v) => upd((d) => { d.summary = v; })} /> : <NoInsight />}
      </Section>
      <Kpis cards={f.kpiCards} />

      <Section title={t("Problem areas, highest impact first")} ai>
        {!n ? <NoInsight /> : (
          <div className="space-y-2">
            {n.problemAreas.map((p, i) => (
              <div key={i} className="rounded-lg border p-3 grid md:grid-cols-[minmax(140px,1fr)_2fr_2fr_2fr_auto] gap-3 bg-card">
                <Labeled label={`${i + 1}. ${t("Area")}`}><Txt value={p.area} editing={editing} onChange={(v) => upd((d) => { d.problemAreas[i].area = v; })} className="font-semibold" /></Labeled>
                <Labeled label={t("Issue")}><Txt value={p.issue} editing={editing} onChange={(v) => upd((d) => { d.problemAreas[i].issue = v; })} /></Labeled>
                <Labeled label={t("Impact")}><Txt value={p.impact} editing={editing} onChange={(v) => upd((d) => { d.problemAreas[i].impact = v; })} /></Labeled>
                <Labeled label={t("Likely cause")}><Txt value={p.cause} editing={editing} onChange={(v) => upd((d) => { d.problemAreas[i].cause = v; })} /></Labeled>
                {editing && <Button size="icon" variant="ghost" aria-label={t("Remove")} onClick={() => upd((d) => { d.problemAreas.splice(i, 1); })}><Trash2 className="w-4 h-4" /></Button>}
              </div>
            ))}
            {n.problemAreas.length === 0 && !editing && <p className="text-xs text-muted-foreground">{t("No significant problem area in this period.")}</p>}
          </div>
        )}
      </Section>

      {f.alarmsIncluded && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-2">{t("Assets with most alarms")}</h3>
            {f.alarmAssets.length === 0 ? <p className="text-xs text-muted-foreground py-8 text-center">{t("No alarms in this period.")}</p> : (
              <ResponsiveContainer width="100%" height={Math.max(160, f.alarmAssets.length * 26)}>
                <BarChart data={f.alarmAssets.map((a) => ({ k: a.assetName, critical: a.critical, high: a.high, other: a.total - a.critical - a.high }))} layout="vertical" margin={{ left: 8 }}>
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="k" width={120} tick={{ fontSize: 10 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="critical" name={t("critical")} stackId="a" fill={SEV_COLORS.critical} />
                  <Bar dataKey="high" name={t("high")} stackId="a" fill={SEV_COLORS.high} />
                  <Bar dataKey="other" name={t("other")} stackId="a" fill="#94a3b8" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-2">{t("Alarms by hour of day")} <span className="font-normal text-muted-foreground text-xs">({f.alarmTiming.timeZone})</span></h3>
            {f.kpis.alarms === 0 ? <p className="text-xs text-muted-foreground py-8 text-center">{t("No alarms in this period.")}</p> : (
              <>
                <ResponsiveContainer width="100%" height={170}>
                  <BarChart data={hourData}><XAxis dataKey="h" tick={{ fontSize: 9 }} interval={2} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={26} /><Tooltip /><Bar dataKey="v" name={t("Alarms")} fill="#2563eb" /></BarChart>
                </ResponsiveContainer>
                {f.alarmTiming.peakWindow && (
                  <p className="text-xs text-muted-foreground">{t("{share}% of alarms fell between {from}:00 and {to}:00.", { share: f.alarmTiming.peakWindow.sharePct, from: String(f.alarmTiming.peakWindow.startHour).padStart(2, "0"), to: String(f.alarmTiming.peakWindow.endHour).padStart(2, "0") })}</p>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {f.alarmsIncluded && (
        <Section title={t("Response performance")} ai={!!n}>
          {n && <Txt value={n.response} editing={editing} rows={3} onChange={(v) => upd((d) => { d.response = v; })} />}
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div />
            <p className="text-xs text-muted-foreground text-right">{t("This period")}</p>
            <p className="text-xs text-muted-foreground text-right">{t("Previous period")}</p>
            <p>{t("Alarms")}</p><p className="text-right tabular-nums">{fmt(f.kpis.alarms)}</p><p className="text-right tabular-nums">{fmt(f.previousKpis.alarms)}</p>
            <p>{t("Mean time to acknowledge")}</p><p className="text-right tabular-nums">{f.kpis.mttaMinutes == null ? "—" : `${fmt(f.kpis.mttaMinutes, 1)} min`}</p><p className="text-right tabular-nums">{f.previousKpis.mttaMinutes == null ? "—" : `${fmt(f.previousKpis.mttaMinutes, 1)} min`}</p>
            <p>{t("Mean time to clear")}</p><p className="text-right tabular-nums">{f.kpis.mttrMinutes == null ? "—" : `${fmt(f.kpis.mttrMinutes, 1)} min`}</p><p className="text-right tabular-nums">{f.previousKpis.mttrMinutes == null ? "—" : `${fmt(f.previousKpis.mttrMinutes, 1)} min`}</p>
            <p>{t("Still open")}</p><p className="text-right tabular-nums">{fmt(f.kpis.stillOpen)}</p><p />
          </div>
        </Section>
      )}

      <Section title={t("Patterns")} ai>
        {n ? <TxtList items={n.patterns} editing={editing} onChange={(v) => upd((d) => { d.patterns = v; })} /> : <NoInsight />}
      </Section>
      {f.alarmsIncluded && f.repeatAlarms.length > 0 && (
        <FactTable title={t("Repeat alarms (3 or more times)")} head={[t("Alarm"), t("Asset"), t("Count"), t("Median gap")]}
          rows={f.repeatAlarms.map((a) => [a.name, a.assetName, a.count, a.medianGapMinutes == null ? "—" : `${fmt(a.medianGapMinutes, 1)} min`])} />
      )}

      <Section title={t("Team priorities")} ai>
        {!n ? <NoInsight /> : (
          <ol className="space-y-2">
            {n.priorities.map((p, i) => (
              <li key={i} className="flex items-start gap-3 rounded-lg border p-2.5 bg-card">
                <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                <div className="flex-1 space-y-1">
                  <Txt value={p.action} editing={editing} onChange={(v) => upd((d) => { d.priorities[i].action = v; })} />
                  {editing ? <Input value={p.owner} onChange={(e) => upd((d) => { d.priorities[i].owner = e.target.value; })} className="h-8 text-xs" aria-label={t("Owner")} />
                    : p.owner && <Badge variant="outline" className="text-[10px]">{t("Owner")}: {p.owner}</Badge>}
                </div>
                {editing && <Button size="icon" variant="ghost" aria-label={t("Remove")} onClick={() => upd((d) => { d.priorities.splice(i, 1); })}><Trash2 className="w-4 h-4" /></Button>}
              </li>
            ))}
            {editing && <Button size="sm" variant="ghost" className="gap-1" onClick={() => upd((d) => { d.priorities.push({ action: "", owner: "" }); })}><Plus className="w-3.5 h-3.5" />{t("Add")}</Button>}
          </ol>
        )}
      </Section>

      <AttentionTable f={f} limit={15} />
      {f.maintenance.length > 0 && (
        <FactTable title={t("Assets in maintenance")} head={[t("Asset"), t("Since"), t("Hours in this period")]}
          rows={f.maintenance.map((m) => [m.assetName, when(m.since), m.hoursInPeriod == null ? "—" : fmt(m.hoursInPeriod, 1)])} />
      )}
    </div>
  );
}

// ── engineer ─────────────────────────────────────────────────────────────────

function EngineerView({ f, n, editing, upd }: { f: ReportFacts; n: EngineerNarrative | null; editing: boolean; upd: Upd }) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const CONF: Record<string, string> = { high: "bg-green-500/15 text-green-700 dark:text-green-400", medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400", low: "bg-slate-500/15 text-slate-600 dark:text-slate-300" };
  const URG: Record<string, string> = { immediate: "bg-red-500/15 text-red-600", this_week: "bg-amber-500/15 text-amber-700 dark:text-amber-400", planned: "bg-blue-500/15 text-blue-600" };
  return (
    <div className="space-y-4">
      <Section title={t("Summary")} ai>
        {n ? <Txt value={n.summary} editing={editing} rows={4} onChange={(v) => upd((d) => { d.summary = v; })} /> : <NoInsight />}
      </Section>
      <Kpis cards={f.kpiCards} />

      <Section title={t("Diagnosis per asset")} ai>
        {!n ? <NoInsight /> : (
          <div className="grid gap-3 md:grid-cols-2">
            {n.diagnoses.map((d0, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-2 bg-card">
                <div className="flex items-start gap-2">
                  <Txt value={d0.asset} editing={editing} onChange={(v) => upd((d) => { d.diagnoses[i].asset = v; })} className="font-semibold flex-1" />
                  {editing ? (
                    <Select value={d0.confidence} onValueChange={(v) => upd((d) => { d.diagnoses[i].confidence = v; })}>
                      <SelectTrigger className="h-8 w-28 text-xs" aria-label={t("Confidence")}><SelectValue /></SelectTrigger>
                      <SelectContent>{["low", "medium", "high"].map((c) => <SelectItem key={c} value={c}>{t(c)}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", CONF[d0.confidence])}>{t("Confidence")}: {t(d0.confidence)}</span>}
                  {editing && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("Remove")} onClick={() => upd((d) => { d.diagnoses.splice(i, 1); })}><Trash2 className="w-3.5 h-3.5" /></Button>}
                </div>
                <Labeled label={t("Observed")}><Txt value={d0.observation} editing={editing} onChange={(v) => upd((d) => { d.diagnoses[i].observation = v; })} /></Labeled>
                {(d0.correlated || editing) && <Labeled label={t("Related signals")}><Txt value={d0.correlated} editing={editing} onChange={(v) => upd((d) => { d.diagnoses[i].correlated = v; })} /></Labeled>}
                <Labeled label={t("Likely root cause")}><Txt value={d0.rootCause} editing={editing} onChange={(v) => upd((d) => { d.diagnoses[i].rootCause = v; })} className="font-medium" /></Labeled>
              </div>
            ))}
            {n.diagnoses.length === 0 && !editing && <p className="text-xs text-muted-foreground">{t("No abnormal behaviour found in this period.")}</p>}
          </div>
        )}
      </Section>

      {f.trends.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2">{t("Trends of the biggest changes")}</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {f.trends.map((tr, i) => (
              <div key={i}>
                <p className="text-xs text-muted-foreground mb-1">{tr.assetName} · {tr.metric}</p>
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={tr.points.map((p) => ({ t: new Date(p.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" }), v: p.v }))}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} /><XAxis dataKey="t" tick={{ fontSize: 9 }} minTickGap={30} /><YAxis tick={{ fontSize: 10 }} width={42} domain={["auto", "auto"]} /><Tooltip />
                    <Line type="monotone" dataKey="v" name={tr.metric} stroke={LINE_COLORS[i % LINE_COLORS.length]} dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <FactTable title={t("Signals that changed before alarms")} head={[t("Asset"), t("Alarm"), t("Metric"), t("Before alarm"), t("Normal")]} empty={t("No reading stood out just before the alarms.")}
          rows={f.leadingSignals.map((s) => [s.assetName, s.alarm, `${s.metric} ${s.direction === "rose" ? "↑" : "↓"}`, fmt(s.beforeAvg), fmt(s.normalAvg)])} />
        <FactTable title={t("Metrics that moved together")} head={[t("Asset"), t("Metrics"), t("Correlation"), t("Points")]} empty={t("No strongly related metrics found.")}
          rows={f.correlations.map((c) => [c.assetName, `${c.metricA} ↔ ${c.metricB}`, c.r, c.points])} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Section title={t("Alarm sequence")} ai>
          {n ? <TxtList items={n.alarmSequence} editing={editing} onChange={(v) => upd((d) => { d.alarmSequence = v; })} /> : <NoInsight />}
        </Section>
        <Section title={t("Sensor and data issues")} ai>
          {n ? <TxtList items={n.dataIssues} editing={editing} onChange={(v) => upd((d) => { d.dataIssues = v; })} /> : <NoInsight />}
        </Section>
      </div>

      <Section title={t("Maintenance actions")} ai>
        {!n ? <NoInsight /> : (
          <ol className="space-y-2">
            {n.actions.map((a, i) => (
              <li key={i} className="flex items-start gap-3 rounded-lg border p-2.5 bg-card">
                {editing ? (
                  <Select value={a.urgency} onValueChange={(v) => upd((d) => { d.actions[i].urgency = v; })}>
                    <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("Urgency")}><SelectValue /></SelectTrigger>
                    <SelectContent>{(["immediate", "this_week", "planned"] as const).map((u) => <SelectItem key={u} value={u}>{t(URGENCY_LABEL[u])}</SelectItem>)}</SelectContent>
                  </Select>
                ) : <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 mt-0.5", URG[a.urgency])}>{t(URGENCY_LABEL[a.urgency])}</span>}
                <div className="flex-1"><Txt value={a.action} editing={editing} onChange={(v) => upd((d) => { d.actions[i].action = v; })} /></div>
                {editing && <Button size="icon" variant="ghost" aria-label={t("Remove")} onClick={() => upd((d) => { d.actions.splice(i, 1); })}><Trash2 className="w-4 h-4" /></Button>}
              </li>
            ))}
            {editing && <Button size="sm" variant="ghost" className="gap-1" onClick={() => upd((d) => { d.actions.push({ action: "", urgency: "this_week" }); })}><Plus className="w-3.5 h-3.5" />{t("Add")}</Button>}
          </ol>
        )}
      </Section>

      {f.alarmsIncluded && (
        <FactTable title={t("Alarm timeline (latest 40)")} head={[t("Time"), t("Asset"), t("Alarm"), t("Acknowledged after"), t("Cleared after")]} empty={t("No alarms in this period.")}
          rows={f.alarmTimeline.map((a) => [when(a.triggeredAt), a.assetName, <span key="n" className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: SEV_COLORS[a.severity] }} />{a.name}</span>, a.ackMinutes == null ? "—" : `${fmt(a.ackMinutes, 1)} min`, a.clearMinutes == null ? t("open") : `${fmt(a.clearMinutes, 1)} min`])} />
      )}

      {(f.dataQuality.stale.length > 0 || f.dataQuality.lowCoverage.length > 0 || f.dataQuality.stuck.length > 0) && (
        <div className="grid md:grid-cols-3 gap-4">
          {f.dataQuality.stale.length > 0 && <FactTable title={t("Stale assets")} head={[t("Asset"), t("Last data")]} rows={f.dataQuality.stale.map((s) => [s.assetName, s.lastSeen ? when(s.lastSeen) : t("never")])} />}
          {f.dataQuality.lowCoverage.length > 0 && <FactTable title={t("Low data coverage")} head={[t("Asset"), t("Data coverage")]} rows={f.dataQuality.lowCoverage.map((c) => [c.assetName, `${c.coveragePct}%`])} />}
          {f.dataQuality.stuck.length > 0 && <FactTable title={t("Possibly stuck sensors")} head={[t("Asset"), t("Metric"), t("Value")]} rows={f.dataQuality.stuck.map((s) => [s.assetName, s.metric, fmt(s.value)])} />}
        </div>
      )}

      <FactTable title={t("All metrics")} head={[t("Asset"), t("Metric"), t("Readings"), t("Min"), t("Average"), t("Max"), t("Previous average"), t("Change")]}
        rows={(showAll ? f.metrics : f.metrics.slice(0, 25)).map((m) => [m.assetName, m.metric, fmt(m.readings), fmt(m.min), fmt(m.avg), fmt(m.max), fmt(m.prevAvg), m.changePct == null ? "—" : `${m.changePct}%`])}
        empty={t("No numeric readings in this period.")}>
        {f.metrics.length > 25 && !showAll && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAll(true)}>{t("Show all {n} metrics", { n: f.metrics.length })}</Button>}
        {f.truncated.metrics && <p className="text-xs text-muted-foreground mt-2">{t("Only the first 300 metrics are listed.")}</p>}
      </FactTable>
    </div>
  );
}
