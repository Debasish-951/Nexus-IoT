import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { History, ShieldAlert, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/auth-api";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { useCurrentUser } from "@/contexts/UserContext";

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface AuditChange { field: string; from: unknown; to: unknown }
export interface AuditEntry {
  id: string; source: "audit" | "security"; timestamp: string; action: string; category: string;
  actorName: string; actorRole: string; actorUsername: string | null; actorUserId: string | null;
  targetId: string | null; targetName: string | null; detail: string | null; changes: AuditChange[] | null; outcome: string;
  ip: string | null; userAgent: string | null; correlationId: string | null; assetId: string | null; projectId: string | null;
  hash: string | null; seq: number | null;
}
export interface AuditPage { entries: AuditEntry[]; total: number; totalCapped?: boolean }

export interface AuditFilterState {
  q?: string; from?: string; to?: string; actor?: string; action?: string; category?: string; outcome?: string;
  targetId?: string; assetId?: string; includeSecurity?: boolean;
}

/** Query string for the audit endpoints. Local datetime inputs are sent as ISO. */
export function auditQuery(f: AuditFilterState, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams();
  const iso = (v?: string) => { if (!v) return undefined; const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); };
  const set = (k: string, v?: string) => { if (v && v.trim()) p.set(k, v.trim()); };
  set("q", f.q); set("from", iso(f.from)); set("to", iso(f.to)); set("actor", f.actor); set("action", f.action);
  if (f.category && f.category !== "all") p.set("category", f.category);
  if (f.outcome && f.outcome !== "all") p.set("outcome", f.outcome);
  set("targetId", f.targetId); set("assetId", f.assetId);
  if (f.includeSecurity) p.set("includeSecurity", "true");
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
}

export async function fetchAudit(f: AuditFilterState, limit: number, offset: number): Promise<AuditPage> {
  const r = await apiFetch(`${BASE}/api/activity-log?${auditQuery(f, { limit, offset })}`);
  if (!r.ok) throw new Error(`Could not load the audit log (${r.status})`);
  return (await r.json()) as AuditPage;
}

export const CATEGORY_LABELS: Record<string, string> = {
  alarm: "Alarm", alarm_rules: "Alarm rule", asset: "Asset", attributes: "Attribute", user: "User", broker: "Broker",
  api_client: "API Client", destination: "Destination", template: "Template", visualization: "Visualization",
  system: "System", ai: "AI", export: "Export", activity_log: "Audit log", security: "Security", uploads: "Uploads", plant_twins: "Live Twin",
};

export const CATEGORY_COLORS: Record<string, string> = {
  alarm: "bg-red-500/10 text-red-600 border-red-500/30", alarm_rules: "bg-rose-500/10 text-rose-600 border-rose-500/30",
  asset: "bg-blue-500/10 text-blue-600 border-blue-500/30", attributes: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  user: "bg-purple-500/10 text-purple-600 border-purple-500/30", broker: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  api_client: "bg-cyan-500/10 text-cyan-600 border-cyan-500/30", destination: "bg-teal-500/10 text-teal-600 border-teal-500/30",
  security: "bg-amber-500/10 text-amber-600 border-amber-500/30", ai: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  export: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
};
const NEUTRAL = "bg-muted text-muted-foreground border-border";

export const OUTCOME_COLORS: Record<string, string> = {
  success: "text-emerald-600", failure: "text-red-600", denied: "text-amber-600",
};

export function CategoryBadge({ category }: { category: string }) {
  const t = useT();
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap", CATEGORY_COLORS[category] ?? NEUTRAL)}>
      {t(CATEGORY_LABELS[category] ?? category)}
    </span>
  );
}

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "string" ? v : JSON.stringify(v));

/** Before/after table of an edit. */
export function ChangesTable({ changes }: { changes: AuditChange[] }) {
  const t = useT();
  return (
    <table className="w-full text-xs border rounded">
      <thead><tr className="bg-muted/50 text-left"><th className="px-2 py-1">{t("Field")}</th><th className="px-2 py-1">{t("Before")}</th><th className="px-2 py-1">{t("After")}</th></tr></thead>
      <tbody>
        {changes.map((c, i) => (
          <tr key={i} className="border-t align-top">
            <td className="px-2 py-1 font-medium">{c.field}</td>
            <td className="px-2 py-1 font-mono break-all text-red-600/90">{show(c.from)}</td>
            <td className="px-2 py-1 font-mono break-all text-emerald-600/90">{show(c.to)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Everything recorded about one entry. */
export function AuditDetailSheet({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  const t = useT();
  const rows: [string, React.ReactNode][] = entry ? [
    [t("Time"), format(new Date(entry.timestamp), "PPpp")],
    [t("Source"), entry.source === "security" ? t("Security event") : t("Audit log")],
    [t("Action"), <span className="font-mono">{entry.action}</span>],
    [t("Category"), <CategoryBadge category={entry.category} />],
    [t("Result"), <span className={cn("font-medium", OUTCOME_COLORS[entry.outcome])}>{t(entry.outcome)}</span>],
    [t("By"), `${entry.actorName}${entry.actorUsername ? ` (${entry.actorUsername})` : ""} · ${entry.actorRole}`],
    [t("Target"), entry.targetName ? `${entry.targetName}${entry.targetId ? ` · ${entry.targetId}` : ""}` : entry.targetId ?? "—"],
    [t("Detail"), entry.detail ?? "—"],
    [t("IP address"), entry.ip ?? "—"],
    [t("Device"), entry.userAgent ?? "—"],
    [t("Request reference"), entry.correlationId ?? "—"],
    [t("Project"), entry.projectId ?? "—"],
    [t("Entry number"), entry.seq ?? "—"],
    [t("Hash"), entry.hash ? <span className="font-mono break-all text-[10px]">{entry.hash}</span> : "—"],
  ] : [];
  return (
    <Sheet open={!!entry} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("Audit entry")}</SheetTitle>
          <SheetDescription>{entry ? formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true }) : ""}</SheetDescription>
        </SheetHeader>
        {entry && (
          <div className="mt-4 space-y-4 px-4 pb-6">
            <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-sm">
              {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-muted-foreground text-xs pt-0.5">{k}</dt><dd className="break-words text-xs">{v}</dd></Fragment>))}
            </dl>
            {entry.changes && entry.changes.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">{t("What changed")}</p>
                <ChangesTable changes={entry.changes} />
                <p className="text-[11px] text-muted-foreground">{t("Passwords, tokens and keys are never stored; they show as [redacted].")}</p>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Compact timeline (per-item history). */
export function AuditTimeline({ entries, onOpen }: { entries: AuditEntry[]; onOpen: (e: AuditEntry) => void }) {
  const t = useT();
  if (!entries.length) return <p className="text-sm text-muted-foreground py-6 text-center">{t("No recorded changes yet.")}</p>;
  return (
    <ol className="relative border-l border-border ml-2 space-y-3">
      {entries.map((e) => (
        <li key={`${e.source}-${e.id}`} className="ml-4">
          <span className={cn("absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full border-2 border-background", e.outcome === "success" ? "bg-primary" : e.outcome === "denied" ? "bg-amber-500" : "bg-red-500")} />
          <button onClick={() => onOpen(e)} className="text-left w-full rounded-md px-2 py-1 hover:bg-muted/60">
            <p className="text-xs text-muted-foreground">{format(new Date(e.timestamp), "PP p")} · {e.actorName}</p>
            <p className="text-sm font-medium">{e.action}{e.outcome !== "success" && <span className={cn("ml-1 text-xs", OUTCOME_COLORS[e.outcome])}>({t(e.outcome)})</span>}</p>
            {e.changes && e.changes.length > 0 && (
              <p className="text-xs text-muted-foreground truncate">
                {e.changes.slice(0, 3).map((c) => <span key={c.field} className="mr-2">{c.field}: <span className="font-mono">{show(c.from)}</span> <ArrowRight className="inline w-3 h-3" /> <span className="font-mono">{show(c.to)}</span></span>)}
                {e.changes.length > 3 && `+${e.changes.length - 3}`}
              </p>
            )}
            {!e.changes?.length && e.detail && <p className="text-xs text-muted-foreground truncate">{e.detail}</p>}
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * "History" button: opens the change history of one item (asset, alarm rule,
 * user, dashboard, API client, broker, destination). Shown only to users who
 * may open the Audit Log. `assetId` also includes changes to things under an asset.
 */
export function HistoryButton({ targetId, targetName, assetScope, size = "sm", variant = "outline", label = true, className }: {
  targetId: string; targetName?: string | null; assetScope?: boolean;
  size?: "sm" | "icon" | "default"; variant?: "outline" | "ghost" | "default"; label?: boolean; className?: string;
}) {
  const t = useT();
  const { canModule } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AuditEntry | null>(null);
  const q = useQuery({
    queryKey: ["audit-history", targetId, assetScope],
    queryFn: () => fetchAudit(assetScope ? { assetId: targetId } : { targetId }, 100, 0),
    enabled: open,
  });
  if (!canModule("activity_log")) return null;
  return (
    <>
      <Button type="button" size={size} variant={variant} className={cn("gap-1.5", className)} onClick={(e) => { e.stopPropagation(); setOpen(true); }} title={t("Change history")}>
        <History className="w-3.5 h-3.5" />{label && size !== "icon" && t("History")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><History className="w-4 h-4" />{t("Change history")}</DialogTitle>
            <DialogDescription>{targetName ?? targetId}{q.data ? ` · ${t("{n} entries", { n: q.data.total })}` : ""}</DialogDescription>
          </DialogHeader>
          {q.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            : q.isError ? <p className="text-sm text-destructive flex items-center gap-1.5"><ShieldAlert className="w-4 h-4" />{t("Could not load the history.")}</p>
            : <AuditTimeline entries={q.data?.entries ?? []} onOpen={setDetail} />}
          {q.data && q.data.total > q.data.entries.length && <Badge variant="secondary" className="w-fit">{t("Showing the latest {n}. Open the Audit Log for the rest.", { n: q.data.entries.length })}</Badge>}
        </DialogContent>
      </Dialog>
      <AuditDetailSheet entry={detail} onClose={() => setDetail(null)} />
    </>
  );
}
