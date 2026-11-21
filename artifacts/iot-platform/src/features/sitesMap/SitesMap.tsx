import { useMemo, useState } from "react";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCurrentUser } from "@/contexts/UserContext";
import { cn } from "@/lib/utils";
import { Focus, MapPin, MapPinOff, Search } from "lucide-react";
import { MapCanvas } from "./MapCanvas";
import { SiteCard, ago } from "./SiteCard";
import { STATUS_COLOR, STATUS_LABEL, useSites, type SiteStatus } from "./useSites";

/**
 * Live Twin → Map view: every project the user may open on one map, coloured by
 * status, with a searchable list, an "Unplaced sites" list and a details card.
 * Users with Asset write permission place sites by clicking the map or typing
 * coordinates. See features/sitesMap/useSites.ts for how status is decided.
 */
const STREET_KEY = "sites-map:street";
export function readStreet(): boolean { try { return localStorage.getItem(STREET_KEY) === "1"; } catch { return false; } }
export function writeStreet(on: boolean) { try { localStorage.setItem(STREET_KEY, on ? "1" : "0"); } catch { /* per browser only */ } }

const FILTERS: (SiteStatus | "all")[] = ["all", "crit", "warn", "ok", "idle"];

export default function SitesMapView() {
  const t = useT();
  const { canModule } = useCurrentUser();
  const { sites, loading, error, alarmsAllowed } = useSites();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<SiteStatus | "all">("all");
  const [sel, setSel] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [pending, setPending] = useState<{ lat: number; lng: number } | null>(null);
  const [street, setStreet] = useState(readStreet);
  const [streetFailed, setStreetFailed] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const canPlace = canModule("assets", "write");

  const shown = useMemo(() => sites.filter((s) => (filter === "all" || s.status === filter) && (!q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()) || (s.address ?? "").toLowerCase().includes(q.trim().toLowerCase()))), [sites, filter, q]);
  const placed = shown.filter((s) => s.placed);
  const unplaced = shown.filter((s) => !s.placed);
  const counts = useMemo(() => { const c: Record<string, number> = { all: sites.length }; for (const s of sites) c[s.status] = (c[s.status] ?? 0) + 1; return c; }, [sites]);
  const selected = sites.find((s) => s.projectId === sel) ?? null;

  const pick = (id: string | null) => { setSel(id); setPlacing(false); setPending(null); };

  return (
    <Card className="flex-1 min-h-0 overflow-hidden shadow-sm flex">
      <aside className="w-64 shrink-0 border-r border-border flex flex-col min-h-0">
        <div className="p-3 space-y-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search sites")} aria-label={t("Search sites")} className="pl-7 h-8 text-xs" />
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("Filter by status")}>
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
                className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]", filter === f ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
                {f !== "all" && <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[f] }} />}
                {f === "all" ? t("All") : t(STATUS_LABEL[f])} <span className="font-mono">{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-1.5 space-y-0.5">
          {loading && <p className="p-2 text-xs text-muted-foreground">{t("Loading sites…")}</p>}
          {error && <p className="p-2 text-xs text-destructive">{t("Could not load the sites.")} {error.message}</p>}
          {!loading && !error && sites.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">{t("No projects yet. A project is a top-level asset: create one in Asset Hub, then give it a location here.")}</p>
          )}
          {placed.map((s) => (
            <button key={s.projectId} onClick={() => pick(s.projectId)}
              className={cn("w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted", sel === s.projectId && "bg-primary/10")}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: STATUS_COLOR[s.status] }} />
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{alarmsAllowed && s.alarms.length ? t("{n} active alarm(s)", { n: s.alarms.length }) : ago(s.lastDataAt, t)}</span>
              </span>
            </button>
          ))}
          {unplaced.length > 0 && (
            <div className="pt-2">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1"><MapPinOff className="w-3 h-3" /> {t("Unplaced sites")} <span className="font-mono">{unplaced.length}</span></p>
              {unplaced.map((s) => (
                <button key={s.projectId} onClick={() => pick(s.projectId)}
                  className={cn("w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted", sel === s.projectId && "bg-primary/10")}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-dashed" style={{ borderColor: STATUS_COLOR[s.status] }} />
                  <span className="flex-1 truncate">{s.name}</span>
                  {canPlace && <span className="text-[10px] text-primary flex items-center gap-0.5"><MapPin className="w-3 h-3" />{t("Place on map")}</span>}
                </button>
              ))}
              {!canPlace && <p className="px-2 pt-1 text-[11px] text-muted-foreground">{t("Someone with Asset write access can place these sites.")}</p>}
            </div>
          )}
        </div>
      </aside>
      <div className="relative flex-1 min-w-0">
        <MapCanvas sites={shown} selectedId={sel} onSelect={pick} placing={placing}
          onPlace={(lat, lng) => { setPending({ lat, lng }); setPlacing(false); }}
          street={street && !streetFailed} fitKey={fitKey} onStreetFail={() => setStreetFailed(true)} />
        <div className="absolute top-2 right-2 z-[500] flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-card/95 px-2 py-1 text-xs shadow">
            <label className="flex items-center gap-1.5 cursor-pointer" title={t("OpenStreetMap tiles. Needs internet, and the server's Content-Security-Policy must allow https://tile.openstreetmap.org in img-src.")}>
              <Switch checked={street} onCheckedChange={(v) => { setStreet(v); writeStreet(v); setStreetFailed(false); }} aria-label={t("Street map")} /> {t("Street map")}
            </label>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFitKey((k) => k + 1)} disabled={!placed.length}><Focus className="w-3.5 h-3.5 mr-1" />{t("Fit all")}</Button>
          </div>
          {street && streetFailed && (
            <p className="max-w-xs rounded-md border border-amber-500/40 bg-card/95 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400 shadow">
              {t("Street map could not load, so the offline map is shown. It needs internet and https://tile.openstreetmap.org in the server's img-src policy.")}
            </p>
          )}
          {selected && (
            <SiteCard site={selected} onClose={() => pick(null)} placing={placing} onPlacing={(on) => { setPlacing(on); if (on) setPending(null); }} pending={pending} alarmsAllowed={alarmsAllowed} />
          )}
        </div>
        {placing && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[500] rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs shadow">
            {t("Click the map where {name} is.", { name: selected?.name ?? "" })}
          </div>
        )}
        {!loading && sites.length > 0 && !sites.some((s) => s.placed) && !selected && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[500] rounded-md border border-border bg-card/95 px-3 py-1.5 text-xs shadow max-w-md text-center">
            {canPlace ? t("No site has a location yet. Pick a site under Unplaced sites and place it on the map.") : t("No site has a location yet.")}
          </div>
        )}
      </div>
    </Card>
  );
}
