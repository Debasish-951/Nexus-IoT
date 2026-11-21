import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/UserContext";
import { cn } from "@/lib/utils";
import { BarChart3, Crosshair, ExternalLink, MapPin, Radio, X } from "lucide-react";
import { STATUS_COLOR, STATUS_LABEL, useSaveLocation, type SiteView } from "./useSites";

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SEV: Record<string, string> = { critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-500", low: "bg-sky-500", info: "bg-slate-400" };

/** "3 min ago", "2 h ago", "5 d ago". */
export function ago(iso: string | null | undefined, t: ReturnType<typeof useT>): string {
  if (!iso) return t("never");
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t("just now");
  if (s < 3600) return t("{n} min ago", { n: Math.round(s / 60) });
  if (s < 86400) return t("{n} h ago", { n: Math.round(s / 3600) });
  return t("{n} d ago", { n: Math.round(s / 86400) });
}

/** Opens Live Twin on a twin type other than the map, so the jump lands on the plant. */
function preferPlantTwin() {
  try { if (localStorage.getItem("live-twin:type") === "map") localStorage.setItem("live-twin:type", "plant"); } catch { /* per browser only */ }
}

/**
 * Details of one site: status, alarms, size, newest data, links into the
 * project and, with Asset write permission, its location.
 */
export function SiteCard({ site, onClose, placing, onPlacing, pending, compact, alarmsAllowed }: {
  site: SiteView;
  onClose: () => void;
  placing?: boolean;
  onPlacing?: (on: boolean) => void;
  /** Point picked on the map while placing, not saved yet. */
  pending?: { lat: number; lng: number } | null;
  compact?: boolean;
  alarmsAllowed: boolean;
}) {
  const t = useT();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { canModule } = useCurrentUser();
  const canEdit = !compact && canModule("assets", "write");
  const save = useSaveLocation();
  const [lat, setLat] = useState(""); const [lng, setLng] = useState(""); const [addr, setAddr] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLat(site.latitude != null ? String(site.latitude) : ""); setLng(site.longitude != null ? String(site.longitude) : "");
    setAddr(site.address ?? ""); setEditing(false);
  }, [site.projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (pending) { setLat(pending.lat.toFixed(6)); setLng(pending.lng.toFixed(6)); setEditing(true); } }, [pending]);

  const nLat = Number(lat), nLng = Number(lng);
  const valid = lat.trim() !== "" && lng.trim() !== "" && Number.isFinite(nLat) && Number.isFinite(nLng) && Math.abs(nLat) <= 90 && Math.abs(nLng) <= 180;
  const doSave = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await save(site, nLat, nLng, addr);
      toast({ title: t("Location saved"), description: site.name });
      setEditing(false); onPlacing?.(false);
    } catch (e: any) {
      toast({ title: t("Could not save the location"), description: e?.message ?? String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const go = (path: string) => navigate(`~${APP_BASE}/p/${site.projectId}${path}`);
  return (
    <div className={cn("rounded-lg border border-border bg-card shadow-lg p-3 space-y-2.5 text-sm", compact ? "w-60" : "w-72")}>
      <div className="flex items-start gap-2">
        <span className="mt-1 w-3 h-3 rounded-full shrink-0" style={{ background: STATUS_COLOR[site.status] }} />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate" title={site.name}>{site.name}</h3>
          {site.address && <p className="text-xs text-muted-foreground truncate" title={site.address}>{site.address}</p>}
          <p className="text-xs" style={{ color: STATUS_COLOR[site.status] }}>{t(STATUS_LABEL[site.status])}</p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground" aria-label={t("Close")}><X className="w-3.5 h-3.5" /></button>
      </div>
      <dl className="grid grid-cols-3 gap-1 text-center">
        <div className="rounded bg-muted/50 py-1"><dt className="text-[10px] text-muted-foreground">{t("Alarms")}</dt><dd className="font-mono font-semibold">{alarmsAllowed ? site.alarms.length : "–"}</dd></div>
        <div className="rounded bg-muted/50 py-1"><dt className="text-[10px] text-muted-foreground">{t("Assets")}</dt><dd className="font-mono font-semibold">{site.assetCount}</dd></div>
        <div className="rounded bg-muted/50 py-1"><dt className="text-[10px] text-muted-foreground">{t("Last data")}</dt><dd className="text-[11px] font-semibold leading-5">{ago(site.lastDataAt, t)}</dd></div>
      </dl>
      {site.maintenanceCount > 0 && <p className="text-[11px] text-muted-foreground">{t("{n} asset(s) in maintenance", { n: site.maintenanceCount })}</p>}
      {alarmsAllowed && site.alarms.length > 0 && (
        <ul className="space-y-1">
          {site.alarms.slice(0, 3).map((a) => (
            <li key={a.id} className="flex items-center gap-1.5 text-xs">
              <span className={cn("w-2 h-2 rounded-full shrink-0", SEV[a.severity] ?? "bg-slate-400")} />
              <span className="truncate flex-1">{a.name}</span>
              <span className="text-muted-foreground truncate max-w-[6rem]">{a.assetName}</span>
            </li>
          ))}
          {site.alarms.length > 3 && <li className="text-[11px] text-muted-foreground">{t("+{n} more", { n: site.alarms.length - 3 })}</li>}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" className="h-7 text-xs" onClick={() => go("")}><ExternalLink className="w-3.5 h-3.5 mr-1" />{t("Open project")}</Button>
        {canModule("live_twin") && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { preferPlantTwin(); go("/live-twin"); }}><Radio className="w-3.5 h-3.5 mr-1" />{t("Live Twin")}</Button>}
        {canModule("visualization") && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => go("/visualization")}><BarChart3 className="w-3.5 h-3.5 mr-1" />{t("Visualization")}</Button>}
      </div>
      {canEdit && (
        <div className="pt-2 border-t border-border space-y-2">
          {!editing ? (
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing(true)}><MapPin className="w-3.5 h-3.5 mr-1" />{site.placed ? t("Edit location") : t("Place on map")}</Button>
            </div>
          ) : (
            <>
              <Button size="sm" variant={placing ? "default" : "outline"} className="h-7 text-xs w-full" onClick={() => onPlacing?.(!placing)}>
                <Crosshair className="w-3.5 h-3.5 mr-1" />{placing ? t("Click the map to set the location…") : t("Set location on the map")}
              </Button>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="space-y-0.5"><Label className="text-[11px]">{t("Latitude")}</Label><Input value={lat} onChange={(e) => setLat(e.target.value)} className="h-7 text-xs font-mono" placeholder="17.385" inputMode="decimal" /></div>
                <div className="space-y-0.5"><Label className="text-[11px]">{t("Longitude")}</Label><Input value={lng} onChange={(e) => setLng(e.target.value)} className="h-7 text-xs font-mono" placeholder="78.4867" inputMode="decimal" /></div>
              </div>
              <div className="space-y-0.5"><Label className="text-[11px]">{t("Address (optional)")}</Label><Input value={addr} onChange={(e) => setAddr(e.target.value)} className="h-7 text-xs" maxLength={300} /></div>
              {!valid && (lat || lng) && <p className="text-[11px] text-destructive">{t("Latitude must be between -90 and 90, longitude between -180 and 180.")}</p>}
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditing(false); onPlacing?.(false); }}>{t("Cancel")}</Button>
                <Button size="sm" className="h-7 text-xs" disabled={!valid || busy} onClick={doSave}>{busy ? t("Saving…") : t("Save location")}</Button>
              </div>
              <p className="text-[10px] text-muted-foreground">{t("Saved as the Latitude, Longitude and Address attributes of the project asset.")}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
