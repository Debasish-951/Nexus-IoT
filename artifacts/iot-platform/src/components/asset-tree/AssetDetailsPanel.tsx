import { MousePointerClick, ExternalLink, Plus, LayoutTemplate, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  Asset, deriveStatus, STATUS_STYLES, siteOf, useAssetHealthMap, HealthBar, STALE_AFTER_MS,
} from "@/pages/assetShared";

function Info({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={cn("text-sm", mono && "font-mono")}>{value}</p>
    </div>
  );
}

export function AssetDetailsPanel({
  asset, allAssets, canManage, onOpenFull, onAddChild, onApplyTemplate, childCount,
}: {
  asset: Asset | null;
  allAssets: Asset[];
  canManage: boolean;
  onOpenFull: (id: string) => void;
  onAddChild: (id: string) => void;
  onApplyTemplate: (id: string) => void;
  childCount: number;
}) {
  // Hook must run unconditionally — pass [] when nothing is selected.
  const healthMap = useAssetHealthMap(asset ? [asset.id] : []);

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
        <MousePointerClick className="w-10 h-10 mb-3 opacity-20" />
        <p className="text-sm">Select an asset from the tree to view its details.</p>
      </div>
    );
  }

  const h = healthMap[asset.id] ?? null;
  const status = deriveStatus(asset, h);

  return (
    <div className="p-6 overflow-auto h-full">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-bold">{asset.name}</h2>
          <span className={cn("inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium", STATUS_STYLES[status])}>{status}</span>
        </div>
        <div className="flex items-center gap-2">
          {canManage && <Button variant="outline" size="sm" onClick={() => onAddChild(asset.id)}><Plus className="w-4 h-4 mr-1.5" /> Add Child</Button>}
          <Button size="sm" onClick={() => onOpenFull(asset.id)}><ExternalLink className="w-4 h-4 mr-1.5" /> Open full details</Button>
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold mb-3">Asset Information</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
          <Info label="Site" value={siteOf(asset, allAssets)} />
          <Info label="Sub-assets" value={String(childCount)} />
          <Info label="Status" value={status} />
          <div>
            <p className="text-xs text-muted-foreground mb-1">Availability</p>
            <HealthBar pct={(!!h?.lastSeen && (Date.now() - new Date(h.lastSeen).getTime()) <= STALE_AFTER_MS) ? 100 : 0} />
          </div>
          <Info label="Created / Installed" value={asset.createdAt ? format(new Date(asset.createdAt), "yyyy-MM-dd") : "—"} />
          <Info label="Last Updated" value={asset.updatedAt ? format(new Date(asset.updatedAt), "yyyy-MM-dd HH:mm") : "—"} />
        </div>
      </div>

      {canManage && (
        <div className="mt-4 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onApplyTemplate(asset.id)}><LayoutTemplate className="w-4 h-4 mr-1.5" /> Assign Template</Button>
          <span className="text-xs text-muted-foreground flex items-center gap-1"><Cpu className="w-3.5 h-3.5" /> Open full details for attributes, telemetry & media.</span>
        </div>
      )}
    </div>
  );
}
