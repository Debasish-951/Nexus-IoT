import { lazy, Suspense, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { useCurrentUser } from "@/contexts/UserContext";
import { listPlantTwins } from "@/features/plantTwin/api";
import { MapCanvas } from "./MapCanvas";
import { SiteCard } from "./SiteCard";
import { STATUS_COLOR, useSites } from "./useSites";

/**
 * Visualization widgets, loaded lazily from the widget registry so Leaflet and
 * three.js are fetched only by dashboards that use them.
 *
 * - "sitesmap": the Live Twin map, compact and view-only.
 * - "livetwin": one saved Live Twin, view-only, in a dashboard tile.
 */
export function SitesMapWidget({ config }: { config: Record<string, any> }) {
  const t = useT();
  const only: string[] | undefined = config.siteScope === "chosen" && Array.isArray(config.projectIds) ? config.projectIds : undefined;
  const { sites, loading, error, alarmsAllowed } = useSites(only);
  const [sel, setSel] = useState<string | null>(null);
  const selected = sites.find((s) => s.projectId === sel) ?? null;
  if (error) return <div className="h-full flex items-center justify-center text-xs text-destructive text-center px-2">{t("Could not load the sites.")}</div>;
  if (!loading && config.siteScope === "chosen" && !only?.length) return <div className="h-full flex items-center justify-center text-xs text-muted-foreground text-center px-2">{t("Choose the projects to show in the Edit Widget panel.")}</div>;
  const placed = sites.filter((s) => s.placed).length;
  return (
    <div className="relative h-full w-full overflow-hidden rounded">
      <MapCanvas sites={sites} selectedId={sel} onSelect={setSel} compact={!config.showLabels} />
      <div className="absolute bottom-1.5 left-1.5 z-[500] flex gap-2 rounded bg-card/90 px-1.5 py-0.5 text-[10px] shadow">
        {(["crit", "warn", "ok", "idle"] as const).map((s) => {
          const n = sites.filter((x) => x.status === s).length;
          return n ? <span key={s} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />{n}</span> : null;
        })}
        {!loading && placed < sites.length && <span className="text-muted-foreground">{t("{n} without location", { n: sites.length - placed })}</span>}
      </div>
      {selected && (
        <div className="absolute top-1.5 right-1.5 z-[500]">
          <SiteCard site={selected} compact onClose={() => setSel(null)} alarmsAllowed={alarmsAllowed} />
        </div>
      )}
    </div>
  );
}

const ImageTwinEmbed = lazy(() => import("@/features/imageTwin/ImageTwinView").then((m) => ({ default: m.ImageTwinEmbed })));
const ProcessTwinEmbed = lazy(() => import("@/features/processTwin/ProcessTwinView").then((m) => ({ default: m.ProcessTwinEmbed })));
const PlantTwinEmbed = lazy(() => import("@/features/plantTwin/TwinEmbed"));

export function LiveTwinWidget({ config }: { config: Record<string, any> }) {
  const t = useT();
  const { canModule } = useCurrentUser();
  const allowed = canModule("live_twin");
  const listQ = useQuery({ queryKey: ["plant-twins"], queryFn: listPlantTwins, enabled: allowed && !!config.twinId, staleTime: 60_000 });
  const note = (text: string) => <div className="h-full flex items-center justify-center text-xs text-muted-foreground text-center px-2">{text}</div>;
  if (!allowed) return note(t("You do not have access to Live Twin."));
  if (!config.twinId) return note(t("Choose a saved twin in the Edit Widget panel."));
  if (listQ.isLoading) return note(t("Loading…"));
  const twin = listQ.data?.find((x) => x.id === config.twinId);
  if (!twin || twin.kind === "folder") return note(t("This twin no longer exists, or you cannot open it."));
  const kind = twin.kind ?? "plant";
  if (kind === "machine") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground text-center px-2">
        <span>{t("The detailed pump skid cannot be shown in a dashboard.")}</span>
        <Link href="/live-twin" className="text-primary underline">{t("Open in Live Twin")}</Link>
      </div>
    );
  }
  return (
    <div className="h-full w-full overflow-hidden">
      <Suspense fallback={note(t("Loading twin…"))}>
        {kind === "image" ? <ImageTwinEmbed twinId={twin.id} />
          : kind === "process" ? <ProcessTwinEmbed twinId={twin.id} />
          : <PlantTwinEmbed twinId={twin.id} />}
      </Suspense>
    </div>
  );
}
