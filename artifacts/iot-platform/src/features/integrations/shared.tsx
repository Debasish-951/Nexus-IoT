import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/auth-api";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { useToast } from "@/hooks/use-toast";

/**
 * Shared pieces for the Integration Hub screens (features/integrations).
 * Data comes from /api/integration/* through apiFetch (CSRF handled there).
 */

export interface Catalog {
  scopes: { id: string; label: string; kind: "read" | "write" }[];
  grantableScopes: string[];
  templates: { id: string; label: string; scopes: string[]; description: string }[];
  eventTypes: { id: string; group: string; label: string }[];
  connectorTypes: string[];
  retryScheduleSec: number[];
  accessTokenTtlSec: number;
  emptyScopesDenied: boolean;
}

export interface IntegrationAlert {
  level: "high" | "medium" | "low"; kind: string; title: string; detail: string;
  targetId: string; target: "client" | "destination" | "connector";
}

/** Read the error message out of a failed response. */
export async function errorText(r: Response): Promise<string> {
  try { const j = await r.json(); return j.error ?? j.error_description ?? `HTTP ${r.status}`; } catch { return `HTTP ${r.status}`; }
}

/** GET a JSON resource with loading / error / reload. */
export function useJson<T>(path: string | null, deps: unknown[] = []): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    apiFetch(path)
      .then(async (r) => { if (!r.ok) throw new Error(await errorText(r)); return r.json() as Promise<T>; })
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e: Error) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, loading, reload };
}

/** POST/PUT/DELETE with JSON; throws the server's message on failure. */
export async function send<T = unknown>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const r = await apiFetch(path, {
    method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(await errorText(r));
  return (r.status === 204 ? undefined : await r.json()) as T;
}

/** Tab strip shown above each Integration Hub screen. The tab is kept in the URL hash. */
export function HubTabs({ tabs, children }: { tabs: { id: string; label: string; badge?: number }[]; children: (active: string) => ReactNode }) {
  const t = useT();
  const read = () => {
    const h = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
    return tabs.some((x) => x.id === h) ? h : tabs[0]!.id;
  };
  const [active, setActive] = useState(read);
  useEffect(() => {
    const on = () => setActive(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pick = (id: string) => {
    setActive(id);
    try { history.replaceState(null, "", id === tabs[0]!.id ? window.location.pathname : `#${id}`); } catch { /* ignore */ }
  };
  return (
    <div className="flex flex-col min-h-full">
      <div className="px-6 pt-4 border-b border-border bg-background/80 sticky top-0 z-10 backdrop-blur">
        <div className="flex gap-1 overflow-x-auto" role="tablist">
          {tabs.map((tab) => (
            <button key={tab.id} role="tab" aria-selected={active === tab.id} onClick={() => pick(tab.id)}
              className={cn("px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
                active === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t(tab.label)}
              {!!tab.badge && <span className="ml-1.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 text-[10px] px-1.5 py-0.5">{tab.badge}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1">{children(active)}</div>
    </div>
  );
}

export function PageHead({ icon: Icon, title, subtitle, actions }: { icon: React.ElementType; title: string; subtitle: string; actions?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2"><Icon className="w-5 h-5 text-primary" /> {t(title)}</h1>
        <p className="text-sm text-muted-foreground">{t(subtitle)}</p>
      </div>
      {actions}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "ok" | "warn" | "bad" }) {
  const t = useT();
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t(label)}</div>
      <div className={cn("text-lg font-semibold tabular-nums",
        tone === "ok" && "text-emerald-600 dark:text-emerald-400", tone === "warn" && "text-amber-600 dark:text-amber-400", tone === "bad" && "text-red-600 dark:text-red-400")}>{value}</div>
    </div>
  );
}

export function Pill({ tone, children }: { tone: "green" | "amber" | "red" | "grey" | "blue"; children: ReactNode }) {
  const cls = {
    green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    red: "bg-red-500/10 text-red-700 dark:text-red-400", grey: "bg-muted text-muted-foreground", blue: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  }[tone];
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>{children}</span>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "ok"; children: ReactNode }) {
  const Icon = tone === "warn" ? AlertTriangle : tone === "ok" ? CheckCircle2 : Info;
  return (
    <div className={cn("flex gap-2 rounded-lg border px-3 py-2 text-sm",
      tone === "warn" ? "border-amber-500/30 bg-amber-500/5" : tone === "ok" ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-muted/30")}>
      <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "text-muted-foreground")} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ErrorLine({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  const t = useT();
  if (!error) return null;
  return (
    <Notice tone="warn">
      <span>{error}</span>
      {/push/i.test(error) || /relation .* does not exist/i.test(error)
        ? <span className="block text-xs text-muted-foreground mt-1">{t("The database is missing the Integration Hub tables. Run: pnpm --filter @workspace/db run push")}</span> : null}
      {onRetry && <Button variant="link" size="sm" className="h-auto p-0 ml-2" onClick={onRetry}><RefreshCw className="w-3 h-3 mr-1" />{t("Retry")}</Button>}
    </Notice>
  );
}

/** A secret shown once, with copy. */
export function OneTimeSecret({ label, value, note }: { label: string; value: string; note?: string }) {
  const t = useT();
  const { toast } = useToast();
  return (
    <Notice tone="ok">
      <div className="font-medium">{t(label)}</div>
      <div className="flex items-center gap-2 mt-1">
        <code className="font-mono text-xs bg-background border border-border rounded px-2 py-1 break-all">{value}</code>
        <Button size="sm" variant="outline" className="h-7" onClick={() => { void navigator.clipboard.writeText(value); toast({ title: t("Copied") }); }}>
          <Copy className="w-3 h-3" />
        </Button>
      </div>
      <div className="text-xs text-muted-foreground mt-1">{t(note ?? "Copy it now. It will not be shown again.")}</div>
    </Notice>
  );
}

export function fmtTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function ago(v: string | Date | null | undefined): string {
  if (!v) return "never";
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return `${Math.max(0, s)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Alerts list used on several tabs. */
export function AlertsPanel({ filter }: { filter?: IntegrationAlert["target"][] }) {
  const t = useT();
  const { data, error, loading, reload } = useJson<IntegrationAlert[]>("/api/integration/alerts");
  const list = (data ?? []).filter((a) => !filter || filter.includes(a.target));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("Checked when this tab opens: expiring or unused keys, full-access keys, refused requests, failing destinations and connectors.")}</p>
        <Button size="sm" variant="outline" onClick={reload} disabled={loading}><RefreshCw className={cn("w-3.5 h-3.5 mr-1", loading && "animate-spin")} />{t("Refresh")}</Button>
      </div>
      <ErrorLine error={error} onRetry={reload} />
      {!error && data && list.length === 0 && <Notice tone="ok">{t("Nothing needs attention.")}</Notice>}
      <div className="space-y-2">
        {list.map((a, i) => (
          <div key={i} className="rounded-lg border border-border bg-card px-3 py-2 flex items-start gap-3">
            <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", a.level === "high" ? "bg-red-500" : a.level === "medium" ? "bg-amber-500" : "bg-slate-400")} />
            <div className="min-w-0">
              <div className="text-sm font-medium">{a.title}</div>
              <div className="text-xs text-muted-foreground">{a.detail}</div>
            </div>
            <span className="ml-auto"><Pill tone="grey">{t(a.target === "client" ? "API client" : a.target === "destination" ? "Destination" : "Connector")}</Pill></span>
          </div>
        ))}
      </div>
    </div>
  );
}
