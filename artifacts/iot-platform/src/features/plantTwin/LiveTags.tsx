import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import type { PlantEngine } from "./engine/engine";
import { ReadingTrend } from "./ReadingTrend";

const MAX_ROWS = 12;
const STATUS_DOT: Record<string, string> = { ok: "bg-green-500", warn: "bg-amber-500", crit: "bg-red-500", off: "bg-slate-400", nolink: "bg-slate-400" };

/**
 * "Live tags" for the whole twin, shown while no machine is selected: the
 * readings of machines linked to assets first (live data), then demo readings to
 * fill the list, each with its trend graph. Clicking a row selects the machine.
 */
export function LiveTags({ engine, title = "Live tags" }: { engine: PlantEngine; title?: string }) {
  const t = useT();
  const rows: { id: string; machine: string; assetId: string | null; r: ReturnType<PlantEngine["readings"]>[number] }[] = [];
  const items = [...engine.items].sort((a, b) => Number(!!b.assetId) - Number(!!a.assetId));
  let total = 0;
  for (const it of items) {
    for (const r of engine.readings(it.id)) {
      if (r.source === "none") continue;
      total++;
      if (rows.length < MAX_ROWS) rows.push({ id: it.id, machine: it.name, assetId: it.assetId ?? null, r });
    }
  }
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">{t("No readings yet. Link machines to assets, or turn Demo values on.")}</p>}
      <div>
        {rows.map(({ id, machine, assetId, r }) => (
          <button key={id + r.k} onClick={() => { engine.select(id); engine.fitItem(id); }} className="w-full text-left py-1.5 border-b border-border/60 hover:bg-muted/50 px-1 rounded-sm">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", STATUS_DOT[r.status] ?? "bg-slate-400")} />
                <span className="font-mono text-[11px] shrink-0">{machine}</span>
                <span className="text-muted-foreground truncate">{t(r.n)}</span>
              </span>
              <span className="font-mono tabular-nums shrink-0">
                {r.value == null ? "–" : `${r.value.toFixed(r.d)} ${r.u}`}
                <span className={cn("ml-1 text-[10px] rounded px-1", r.source === "live" ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400")}>{t(r.source)}</span>
              </span>
            </div>
            <ReadingTrend value={r.value} source={r.source} status={r.status} assetId={assetId} metric={r.metric} />
          </button>
        ))}
      </div>
      {total > rows.length && <p className="text-[11px] text-muted-foreground">{t("Showing {a} of {b} readings. Click a machine for all of its readings.", { a: rows.length, b: total })}</p>}
    </div>
  );
}
