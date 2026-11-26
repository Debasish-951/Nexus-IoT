import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  Activity, ChevronLeft, ChevronRight, Download, FileText, RefreshCw, Search, Settings2, ShieldCheck, ShieldAlert, Users, AlertTriangle, XCircle, X,
} from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AssetScopePicker } from "@/components/AssetScopePicker";
import { useWsEvents } from "@/hooks/useWsEvents";
import { useCurrentUser } from "@/contexts/UserContext";
import { apiFetch } from "@/lib/auth-api";
import { FEATURES } from "@/lib/features";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import ActivityLogClassic from "./ActivityLogClassic";
import {
  BASE, CATEGORY_LABELS, OUTCOME_COLORS, CategoryBadge, AuditDetailSheet, auditQuery, fetchAudit,
  type AuditEntry, type AuditFilterState,
} from "@/features/auditLog/shared";
import { downloadAuditPdf } from "@/features/auditLog/exportPdf";

const PAGE_SIZE = 50;

interface Summary {
  perDay: { day: string; count: number }[];
  topActors: { name: string; count: number }[];
  sensitive: { count: number; byRule: Record<string, number>; recent: { action: string; actorName: string; targetName: string | null; timestamp: string; rule: string }[] };
  failures: { audit: number; security: number };
}
interface VerifyResult { ok: boolean; checked: number; verifiedAt: string; broken: { id: string; seq: number; timestamp: string; reason: string } | null; checkpoint: { seq: number; prunedAt: string; pruned: number } | null }
interface AuditSettingsView {
  retentionDays: number | null; effectiveRetentionDays: number; defaultRetentionDays: number; minimumRetentionDays: number;
  alerts: { key: string; title: string; severity: string; enabled: boolean; pendingDisable?: { requestedBy: string; requestedAt: string } | null }[];
  /** Switching an alert off needs a second administrator (server AUDIT_ALERTS_SECOND_ADMIN). */
  secondAdminRequired?: boolean;
  checkpoint: { seq: number; prunedAt: string; pruned: number } | null;
}

export default function ActivityLog() {
  if (FEATURES.classicAuditLog) return <ActivityLogClassic />;
  return <AuditLogPage />;
}

function AuditLogPage() {
  const t = useT();
  const qc = useQueryClient();
  const { can, canModule, session } = useCurrentUser();
  const isSecurityAdmin = can("manage_security") && canModule("security");
  const restricted = !!session?.restrictProjects;

  const [draft, setDraft] = useState<AuditFilterState>({ category: "all", outcome: "all" });
  const [filters, setFilters] = useState<AuditFilterState>({ category: "all", outcome: "all" });
  const [scope, setScope] = useState("all");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const effective: AuditFilterState = useMemo(() => ({ ...filters, assetId: scope === "all" ? undefined : scope }), [filters, scope]);

  const listQ = useQuery({
    queryKey: ["audit-log", effective, page],
    queryFn: () => fetchAudit(effective, PAGE_SIZE, page * PAGE_SIZE),
    placeholderData: (prev) => prev,
  });
  const summaryQ = useQuery({
    queryKey: ["audit-summary"],
    queryFn: async () => {
      const r = await apiFetch(`${BASE}/api/activity-log/summary?timeZone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`);
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as Summary;
    },
    refetchInterval: 120_000,
  });

  // New entries arrive over the WebSocket: refresh the first page and the summary.
  useWsEvents({ activity_log: () => { if (page === 0) void qc.invalidateQueries({ queryKey: ["audit-log"] }); void qc.invalidateQueries({ queryKey: ["audit-summary"] }); } });

  const apply = () => { setFilters(draft); setPage(0); };
  const clear = () => { const empty = { category: "all", outcome: "all" }; setDraft(empty); setFilters(empty); setScope("all"); setPage(0); };
  useEffect(() => { setPage(0); }, [scope]);

  const total = listQ.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const entries = listQ.data?.entries ?? [];

  const filtersText = Object.entries(effective).filter(([, v]) => v && v !== "all").map(([k, v]) => `${k}=${String(v)}`).join(", ");

  async function exportCsv() {
    setExporting("csv");
    try {
      const r = await apiFetch(`${BASE}/api/activity-log/export?${auditQuery(effective)}`);
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } finally { setExporting(null); }
  }

  async function exportPdf() {
    setExporting("pdf");
    try {
      const all: AuditEntry[] = [];
      for (let off = 0; off < 2000; off += 500) {
        const p = await fetchAudit(effective, 500, off);
        all.push(...p.entries);
        if (p.entries.length < 500) break;
      }
      await downloadAuditPdf(all, filtersText, total);
    } finally { setExporting(null); }
  }

  async function runVerify() {
    setVerifying(true);
    try {
      // POST: the check writes an audit entry, so the server refuses GET.
      const r = await apiFetch(`${BASE}/api/activity-log/verify`, { method: "POST" });
      if (r.ok) setVerify((await r.json()) as VerifyResult);
    } finally { setVerifying(false); }
  }

  const s = summaryQ.data;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 text-primary"><Activity className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl font-semibold">{t("Audit Log")}</h1>
            <p className="text-sm text-muted-foreground">{t("Every change made in the application: who, what, when, from where, and what changed.")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isSecurityAdmin && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void runVerify()} disabled={verifying}>
              <ShieldCheck className="w-4 h-4" />{verifying ? t("Checking…") : t("Verify integrity")}
            </Button>
          )}
          {isSecurityAdmin && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="w-4 h-4" />{t("Settings")}
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void exportCsv()} disabled={!!exporting}>
            <Download className="w-4 h-4" />{exporting === "csv" ? t("Exporting…") : "CSV"}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void exportPdf()} disabled={!!exporting}>
            <FileText className="w-4 h-4" />{exporting === "pdf" ? t("Exporting…") : "PDF"}
          </Button>
        </div>
      </div>

      {verify && (
        <div className={cn("rounded-lg border px-4 py-3 text-sm flex items-start gap-2", verify.ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/50 bg-red-500/5")}>
          {verify.ok ? <ShieldCheck className="w-4 h-4 mt-0.5 text-emerald-600" /> : <ShieldAlert className="w-4 h-4 mt-0.5 text-red-600" />}
          <div className="flex-1">
            {verify.ok
              ? <p>{t("Integrity verified: all {n} entries are unchanged and none is missing.", { n: verify.checked.toLocaleString() })}</p>
              : <p className="text-red-600 font-medium">{t("Integrity check failed at entry #{seq} ({reason}). An entry was changed or removed outside the application.", { seq: verify.broken?.seq ?? "?", reason: verify.broken?.reason ?? "" })}</p>}
            {verify.checkpoint && <p className="text-xs text-muted-foreground">{t("Older entries were removed by retention on {date} ({n} entries); the check starts from that point.", { date: format(new Date(verify.checkpoint.prunedAt), "PP"), n: verify.checkpoint.pruned })}</p>}
          </div>
          <button onClick={() => setVerify(null)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">{t("Changes per day (7 days)")}</p>
          {s ? (
            <>
              <p className="text-2xl font-semibold">{s.perDay.reduce((a, d) => a + d.count, 0).toLocaleString()}</p>
              <div className="h-12 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={s.perDay}><XAxis dataKey="day" hide /><Tooltip formatter={(v) => [v, t("Entries")]} labelFormatter={(l) => String(l)} /><Bar dataKey="count" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} maxBarSize={18} /></BarChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : <Skeleton className="h-16 mt-1" />}
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3.5 h-3.5" />{t("Most active users (7 days)")}</p>
          {s ? (s.topActors.length ? (
            <ul className="mt-1 space-y-0.5 text-sm">{s.topActors.slice(0, 4).map((a) => (
              <li key={a.name} className="flex justify-between gap-2"><button className="truncate hover:underline text-left" onClick={() => { const f = { ...draft, actor: a.name }; setDraft(f); setFilters(f); setPage(0); }}>{a.name}</button><span className="text-muted-foreground tabular-nums">{a.count}</span></li>
            ))}</ul>
          ) : <p className="text-sm text-muted-foreground mt-1">{t("No user activity this week.")}</p>) : <Skeleton className="h-16 mt-1" />}
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{t("Sensitive actions this week")}</p>
          {s ? (
            <>
              <p className={cn("text-2xl font-semibold", s.sensitive.count > 0 && "text-amber-600")}>{s.sensitive.count}</p>
              {s.sensitive.recent[0] && <p className="text-xs text-muted-foreground truncate">{t("Latest")}: {s.sensitive.recent[0].action} · {s.sensitive.recent[0].actorName} · {formatDistanceToNow(new Date(s.sensitive.recent[0].timestamp), { addSuffix: true })}</p>}
            </>
          ) : <Skeleton className="h-16 mt-1" />}
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><XCircle className="w-3.5 h-3.5" />{t("Failed or denied this week")}</p>
          {s ? (
            <>
              <p className={cn("text-2xl font-semibold", s.failures.audit + s.failures.security > 0 && "text-red-600")}>{(s.failures.audit + s.failures.security).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">{t("{a} actions · {b} sign-in and access events", { a: s.failures.audit, b: s.failures.security })}</p>
            </>
          ) : <Skeleton className="h-16 mt-1" />}
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-3 space-y-3">
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1 xl:col-span-2">
            <Label className="text-xs">{t("Search")}</Label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8 h-9" placeholder={t("Action, item, detail or person…")} value={draft.q ?? ""} onChange={(e) => setDraft({ ...draft, q: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("From")}</Label>
            <Input type="datetime-local" className="h-9" value={draft.from ?? ""} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("To")}</Label>
            <Input type="datetime-local" className="h-9" value={draft.to ?? ""} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("User")}</Label>
            <Input className="h-9" placeholder={t("Name or username")} value={draft.actor ?? ""} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Action")}</Label>
            <Input className="h-9" placeholder="user.updated, alarm_rule." value={draft.action ?? ""} onChange={(e) => setDraft({ ...draft, action: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") apply(); }} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Category")}</Label>
            <Select value={draft.category ?? "all"} onValueChange={(v) => setDraft({ ...draft, category: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All categories")}</SelectItem>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{t(v)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Result")}</Label>
            <Select value={draft.outcome ?? "all"} onValueChange={(v) => setDraft({ ...draft, outcome: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All results")}</SelectItem>
                <SelectItem value="success">{t("success")}</SelectItem>
                <SelectItem value="failure">{t("failure")}</SelectItem>
                <SelectItem value="denied">{t("denied")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("Project or asset")}</Label>
            <AssetScopePicker value={scope} onChange={setScope} allLabel={t("Everything")} className="h-9 w-full" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {!restricted && can("manage_security") ? (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch checked={!!draft.includeSecurity} onCheckedChange={(v) => { const f = { ...draft, includeSecurity: v }; setDraft(f); setFilters(f); setPage(0); }} />
              {t("Include security events (sign-ins, refusals, rate limits)")}
            </label>
          ) : <span />}
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={clear}>{t("Clear")}</Button>
            <Button size="sm" onClick={apply} className="gap-1.5"><Search className="w-3.5 h-3.5" />{t("Apply")}</Button>
          </div>
        </div>
      </Card>

      {/* Entries */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b text-sm">
          <span className="text-muted-foreground">{listQ.isFetching ? t("Loading…") : t("{n} entries", { n: total.toLocaleString() })}</span>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void listQ.refetch()}><RefreshCw className={cn("w-3.5 h-3.5", listQ.isFetching && "animate-spin")} />{t("Refresh")}</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{t("Time")}</th>
                <th className="px-4 py-2 font-medium">{t("Category")}</th>
                <th className="px-4 py-2 font-medium">{t("Action")}</th>
                <th className="px-4 py-2 font-medium">{t("Target")}</th>
                <th className="px-4 py-2 font-medium">{t("By")}</th>
                <th className="px-4 py-2 font-medium">{t("Result")}</th>
                <th className="px-4 py-2 font-medium">{t("Detail")}</th>
              </tr>
            </thead>
            <tbody>
              {listQ.isLoading && Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-2"><Skeleton className="h-6" /></td></tr>)}
              {!listQ.isLoading && entries.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">{t("No entries match these filters.")}</td></tr>}
              {entries.map((e) => (
                <tr key={`${e.source}-${e.id}`} className={cn("border-t hover:bg-muted/30 cursor-pointer", e.source === "security" && "bg-amber-500/[0.03]")} onClick={() => setDetail(e)}>
                  <td className="px-4 py-2 whitespace-nowrap" title={format(new Date(e.timestamp), "PPpp")}>
                    <div className="text-xs font-medium">{format(new Date(e.timestamp), "MMM d, HH:mm:ss")}</div>
                    <div className="text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(e.timestamp), { addSuffix: true })}</div>
                  </td>
                  <td className="px-4 py-2"><CategoryBadge category={e.category} /></td>
                  <td className="px-4 py-2 font-mono text-xs">{e.action}{e.source === "security" && <span className="ml-1 text-[10px] text-amber-600 font-sans">({t("security")})</span>}</td>
                  <td className="px-4 py-2 text-xs max-w-[180px] truncate">{e.targetName ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-2 text-xs"><div className="font-medium">{e.actorName}</div><div className="text-[11px] text-muted-foreground">{e.actorRole}{e.ip ? ` · ${e.ip}` : ""}</div></td>
                  <td className={cn("px-4 py-2 text-xs font-medium", OUTCOME_COLORS[e.outcome])}>{t(e.outcome)}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground max-w-[320px] truncate">
                    {e.changes?.length ? e.changes.slice(0, 2).map((c) => `${c.field}: ${fmt(c.from)} → ${fmt(c.to)}`).join(" · ") + (e.changes.length > 2 ? ` +${e.changes.length - 2}` : "") : e.detail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-t text-sm">
          <span className="text-muted-foreground">{t("Page {p} of {n}", { p: page + 1, n: pages })}</span>
          <div className="flex gap-1">
            <Button size="icon" variant="outline" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="w-4 h-4" /></Button>
            <Button size="icon" variant="outline" className="h-8 w-8" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      </Card>

      <AuditDetailSheet entry={detail} onClose={() => setDetail(null)} />
      {isSecurityAdmin && <AuditSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />}
    </div>
  );
}

const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "string" ? v : JSON.stringify(v));

function AuditSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const q = useQuery({
    queryKey: ["audit-settings"],
    queryFn: async () => { const r = await apiFetch(`${BASE}/api/activity-log/settings`); if (!r.ok) throw new Error(String(r.status)); return (await r.json()) as AuditSettingsView; },
    enabled: open,
  });
  const [days, setDays] = useState("");
  const [alerts, setAlerts] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return;
    setDays(q.data.retentionDays == null ? "" : String(q.data.retentionDays));
    setAlerts(Object.fromEntries(q.data.alerts.map((a) => [a.key, a.enabled])));
  }, [q.data]);

  async function save() {
    setSaving(true); setError(null); setNotice(null);
    try {
      const n = days.trim() === "" ? null : Number(days);
      if (n != null && (!Number.isInteger(n) || n < 0)) { setError(t("Enter a whole number of days, 0 to keep for ever, or leave empty for the default.")); return; }
      const r = await apiFetch(`${BASE}/api/activity-log/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retentionDays: n, alerts }) });
      if (!r.ok) { setError(t("The settings could not be saved.")); return; }
      const saved = (await r.json().catch(() => null)) as { waitingForSecondAdmin?: string[] } | null;
      await q.refetch();
      // Switching an alert off waits for a second administrator: say so instead of closing.
      if (saved?.waitingForSecondAdmin?.length) {
        setNotice(t("Saved. Switching an alert off takes effect only when another administrator also switches it off."));
        return;
      }
      onOpenChange(false);
    } finally { setSaving(false); }
  }

  const d = q.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Audit log settings")}</DialogTitle>
          <DialogDescription>{t("How long entries are kept, and which sensitive actions raise an alert in the notification bell.")}</DialogDescription>
        </DialogHeader>
        {!d ? <Skeleton className="h-40" /> : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>{t("Keep entries for (days)")}</Label>
              <Input type="number" min={0} placeholder={t("Default: {n}", { n: d.defaultRetentionDays })} value={days} onChange={(e) => setDays(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("At least {min} days; 0 keeps them for ever. Now kept: {cur}.", { min: d.minimumRetentionDays, cur: d.effectiveRetentionDays === 0 ? t("for ever") : `${d.effectiveRetentionDays}` })}</p>
              {d.checkpoint && <p className="text-xs text-muted-foreground">{t("Last retention run removed entries up to #{seq} on {date}.", { seq: d.checkpoint.seq, date: format(new Date(d.checkpoint.prunedAt), "PP") })}</p>}
            </div>
            <div className="space-y-2">
              <Label>{t("Alerts on sensitive actions")}</Label>
              {d.alerts.map((a) => (
                <label key={a.key} className="flex items-center justify-between gap-3 text-sm">
                  <span>{t(a.title)} <span className={cn("text-[11px] ml-1", a.severity === "critical" ? "text-red-600" : a.severity === "high" ? "text-orange-600" : "text-yellow-600")}>{t(a.severity)}</span></span>
                  <Switch checked={alerts[a.key] ?? true} onCheckedChange={(v) => setAlerts({ ...alerts, [a.key]: v })} />
                </label>
              ))}
              {d.alerts.filter((a) => a.enabled && a.pendingDisable).map((a) => (
                <p key={`p-${a.key}`} className="text-xs text-muted-foreground">
                  {t("{alert}: {name} asked to switch this off on {date}. It stays on until another administrator switches it off too.", { alert: t(a.title), name: a.pendingDisable!.requestedBy, date: format(new Date(a.pendingDisable!.requestedAt), "PP") })}
                </p>
              ))}
              {d.secondAdminRequired && <p className="text-xs text-muted-foreground">{t("Switching an alert off needs two administrators. Switching one on takes effect at once.")}</p>}
            </div>
            {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button onClick={() => void save()} disabled={saving || !d}>{saving ? t("Saving…") : t("Save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
