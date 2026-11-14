import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { apiFetch } from "@/lib/auth-api";
import { describeApiError, formatApiError } from "@/lib/validation";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
export const whole = new Intl.NumberFormat();

export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n >= 100_000 ? compact.format(n) : whole.format(Math.round(n));
}

export function fmtBytes(b: number | null | undefined): string {
  if (b === null || b === undefined || !Number.isFinite(b)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function ago(iso: string | Date | null | undefined): string {
  return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "—";
}

export async function getJson<T>(path: string): Promise<T> {
  const r = await apiFetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(formatApiError(await describeApiError(r)));
  return (await r.json()) as T;
}

/** POST/PUT/DELETE with JSON. Returns status and parsed body; throws with the API's message on failure. */
export async function send<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const r = await apiFetch(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(formatApiError(await describeApiError(r)));
  const text = await r.text();
  return { status: r.status, data: (text ? JSON.parse(text) : null) as T };
}

/** Download a file from the API (CSV report, archive). */
export async function download(path: string, fallbackName: string): Promise<void> {
  const r = await apiFetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(formatApiError(await describeApiError(r)));
  const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function StatCard({ icon: Icon, label, value, sub, tone }: {
  icon: React.ElementType; label: string; value: string; sub?: string; tone?: "warn" | "bad" | "good";
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className={cn("rounded-md p-2 shrink-0", tone === "bad" ? "bg-red-500/10" : tone === "warn" ? "bg-amber-500/10" : tone === "good" ? "bg-emerald-500/10" : "bg-primary/10")}>
            <Icon className={cn("w-4 h-4", tone === "bad" ? "text-red-500" : tone === "warn" ? "text-amber-500" : tone === "good" ? "text-emerald-500" : "text-primary")} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className="text-lg font-semibold leading-tight mt-0.5 truncate tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Section({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ErrorLine({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs flex items-center justify-between gap-3">
      <span className="text-red-600 dark:text-red-400">{error instanceof Error ? error.message : String(error)}</span>
      {onRetry && <button className="underline" onClick={onRetry}>Retry</button>}
    </div>
  );
}

/** A simple table shell with the page's styling. */
export function Table({ head, children, empty }: { head: React.ReactNode; children: React.ReactNode; empty?: string | false }) {
  return (
    <div className="rounded-lg border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-muted-foreground">{head}</thead>
        <tbody className="[&>tr:nth-child(even)]:bg-muted/20">{children}</tbody>
      </table>
      {empty && <p className="px-3 py-4 text-xs text-muted-foreground text-center">{empty}</p>}
    </div>
  );
}

export const th = "text-left px-3 py-2 font-medium";
export const thr = "text-right px-3 py-2 font-medium";
export const td = "px-3 py-2";
export const tdr = "px-3 py-2 text-right tabular-nums";

/** Readings per period: one series, thin bars, hover for the exact value. */
export function Bars({ data, label, format }: { data: Array<{ t: string; v: number }>; label: string; format: (d: { t: string; v: number }) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <p className="text-xs text-muted-foreground py-6 text-center">No data yet.</p>;
  const max = Math.max(...data.map((d) => d.v), 1);
  return (
    <div>
      <div className="h-5 text-xs text-muted-foreground tabular-nums">{hover !== null ? format(data[hover]) : label}</div>
      <div className="relative h-24 flex items-end gap-[2px] border-b border-border" onMouseLeave={() => setHover(null)} role="img" aria-label={label}>
        {data.map((d, i) => (
          <div key={d.t} className="flex-1 h-full flex items-end" onMouseEnter={() => setHover(i)}>
            <div className={cn("w-full rounded-t-[4px] transition-colors", hover === i ? "bg-primary" : "bg-primary/60")} style={{ height: `${d.v > 0 ? Math.max(2, (d.v / max) * 100) : 0}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
