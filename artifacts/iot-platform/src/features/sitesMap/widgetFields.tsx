import { useQuery } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProject } from "@/contexts/ProjectContext";
import { useCurrentUser } from "@/contexts/UserContext";
import { listPlantTwins } from "@/features/plantTwin/api";

/**
 * Edit Widget panel fields for the "sitesmap" and "livetwin" widgets. Kept apart
 * from widgets.tsx so the panel does not load Leaflet.
 */
type Set = (patch: Record<string, any>) => void;

export function SitesMapFields({ draft, set }: { draft: Record<string, any>; set: Set }) {
  const t = useT();
  const { projects } = useProject();
  const chosen: string[] = Array.isArray(draft.projectIds) ? draft.projectIds : [];
  const scope = draft.siteScope === "chosen" ? "chosen" : "all";
  return (
    <div className="pt-2 mt-1 border-t border-border space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Sites")}</p>
      <div className="flex gap-3 text-xs">
        <label className="flex items-center gap-1.5"><input type="radio" checked={scope === "all"} onChange={() => set({ siteScope: "all" })} /> {t("All projects I may open")}</label>
        <label className="flex items-center gap-1.5"><input type="radio" checked={scope === "chosen"} onChange={() => set({ siteScope: "chosen" })} /> {t("Chosen projects")}</label>
      </div>
      {scope === "chosen" && (
        <div className="max-h-40 overflow-auto rounded-md border border-border p-1.5 space-y-0.5">
          {projects.length === 0 && <p className="text-[11px] text-muted-foreground">{t("No projects available.")}</p>}
          {projects.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={chosen.includes(p.id)}
                onChange={(e) => set({ projectIds: e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id) })} />
              <span className="truncate">{p.name}</span>
            </label>
          ))}
        </div>
      )}
      <label className="flex items-center gap-2 text-xs"><Switch checked={!!draft.showLabels} onCheckedChange={(v) => set({ showLabels: v })} /> {t("Show site names on the map")}</label>
      <p className="text-[11px] text-muted-foreground">{t("Sites are placed in Live Twin → Map view. Colours: red critical alarm, amber alarm, green reporting, grey no recent data.")}</p>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { plant: "Plant twin", asset: "Asset twin", image: "2D twin", process: "Process twin", machine: "Detailed pump skid" };

export function LiveTwinFields({ draft, set }: { draft: Record<string, any>; set: Set }) {
  const t = useT();
  const { canModule } = useCurrentUser();
  const allowed = canModule("live_twin");
  const listQ = useQuery({ queryKey: ["plant-twins"], queryFn: listPlantTwins, enabled: allowed });
  const twins = (listQ.data ?? []).filter((x) => x.kind !== "folder" && x.kind !== "machine");
  return (
    <div className="pt-2 mt-1 border-t border-border space-y-1.5">
      <Label className="text-xs">{t("Twin")}</Label>
      {!allowed ? <p className="text-[11px] text-muted-foreground">{t("You do not have access to Live Twin.")}</p> : (
        <select value={draft.twinId ?? ""} onChange={(e) => set({ twinId: e.target.value || undefined })} className="w-full h-8 rounded-md border border-border bg-background px-2 text-sm">
          <option value="">{listQ.isLoading ? t("Loading…") : t("Choose a saved twin")}</option>
          {twins.map((x) => <option key={x.id} value={x.id}>{x.name} · {t(KIND_LABEL[x.kind ?? "plant"] ?? "Plant twin")}</option>)}
        </select>
      )}
      <p className="text-[11px] text-muted-foreground">{t("Shows the twin view-only with live values. Drag the widget corner to set its height. Twins are built and linked in Live Twin.")}</p>
    </div>
  );
}
