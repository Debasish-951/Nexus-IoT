import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListAssets, type RetentionPolicy } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMetricChoices } from "@/features/dashboards/useWidgetData";
import { fmtBytes, fmtCount, send } from "./shared";

export const ALL = "__all__";

export interface Preview {
  available: boolean; rows: number; bytes: number | null; current: { rows: number; bytes: number | null };
  byAsset: Array<{ assetId: string; assetName: string; rows: number }>; complete: boolean; limited: boolean;
  heldPolicies?: number; needsApproval?: boolean;
}

export async function postPreview(body: unknown): Promise<Preview> {
  return (await send<Preview>("POST", "/api/system/retention/preview", body ?? {})).data;
}

interface AssetLite { id: string; name: string; parentId?: string | null }

/** "Plant › Line 2 › Pump 4", so repeated leaf names stay distinguishable. */
export function useAssetPaths(): { list: Array<{ id: string; path: string }>; pathOf: (id: string | null | undefined) => string } {
  const { data } = useListAssets();
  return useMemo(() => {
    const assets = ((data as AssetLite[] | undefined) ?? []);
    const byId = new Map(assets.map((a) => [a.id, a]));
    const path = (a: AssetLite) => {
      const names: string[] = [];
      let cur: AssetLite | undefined = a;
      for (let i = 0; cur && i < 12; i++) { names.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
      return names.join(" › ");
    };
    const list = assets.map((a) => ({ id: a.id, path: path(a) })).sort((x, y) => x.path.localeCompare(y.path));
    const paths = new Map(list.map((a) => [a.id, a.path]));
    return { list, pathOf: (id) => (id ? paths.get(id) ?? "Deleted asset" : "All assets") };
  }, [data]);
}

export function PreviewBox({ preview, loading, error, mode = "change" }: { preview?: Preview; loading: boolean; error?: string; mode?: "change" | "run" }) {
  if (error) return <p className="text-xs text-red-500">Could not estimate: {error}</p>;
  if (loading || !preview) return <p className="text-xs text-muted-foreground">Estimating what this would delete…</p>;
  if (!preview.available) return <p className="text-xs text-muted-foreground">No estimate: summaries are switched off on the server (TELEMETRY_ROLLUPS=false).</p>;
  const extra = preview.rows - preview.current.rows;
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5 text-xs">
      <p>
        {preview.rows > 0
          ? <>The next pruning run would delete about <b className="tabular-nums">{fmtCount(preview.rows)}</b> readings{preview.bytes != null && <> (about <b>{fmtBytes(preview.bytes)}</b>)</>}.</>
          : <>The next pruning run would delete nothing.</>}
        {mode === "change" && extra !== 0 && preview.current.rows > 0 && <> That is {fmtCount(Math.abs(extra))} {extra > 0 ? "more" : "fewer"} than now.</>}
      </p>
      {preview.byAsset.length > 0 && (
        <ul className="text-muted-foreground space-y-0.5">
          {preview.byAsset.slice(0, 5).map((a) => <li key={a.assetId} className="flex justify-between gap-3"><span className="truncate">{a.assetName}</span><span className="tabular-nums">{fmtCount(a.rows)}</span></li>)}
        </ul>
      )}
      {!!preview.heldPolicies && <p className="text-muted-foreground">Readings under {preview.heldPolicies} legal hold(s) are left out.</p>}
      {!preview.complete && <p className="text-amber-600 dark:text-amber-400">The summaries are still counting older data, so the real number can be higher.</p>}
      {preview.limited && <p className="text-muted-foreground">Readings are only deleted once summarised (and archived, if archiving is on), so part of this waits.</p>}
      {preview.needsApproval && <p className="text-amber-600 dark:text-amber-400 font-medium">Above the approval limit: a second administrator must approve this before anything is deleted.</p>}
    </div>
  );
}

export function PolicyDialog({ open, onOpenChange, initial, onSave }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: RetentionPolicy | null;
  onSave: (data: Partial<RetentionPolicy>) => Promise<boolean>;
}) {
  const assets = useAssetPaths();
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const [assetId, setAssetId] = useState<string>(ALL);
  const [metric, setMetric] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const metricChoices = useMetricChoices(assetId === ALL ? undefined : assetId);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setDays(String(initial?.retentionDays ?? 90));
    setAssetId(initial?.assetId ?? ALL);
    setMetric(initial?.metric ?? "");
    setEnabled(initial?.enabled ?? true);
  }, [open, initial]);

  const daysNum = Number(days);
  const validDays = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 3650;
  const draft = { id: initial?.id, assetId: assetId === ALL ? null : assetId, metric: metric.trim() || null, retentionDays: daysNum, enabled };
  const [debounced, setDebounced] = useState(draft);
  const draftKey = JSON.stringify(draft);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(JSON.parse(draftKey)), 400);
    return () => clearTimeout(t);
  }, [draftKey]);
  const preview = useQuery({
    queryKey: ["system/retention/preview", debounced],
    queryFn: () => postPreview({ policy: debounced }),
    enabled: open && validDays && Number.isInteger(debounced.retentionDays) && debounced.retentionDays >= 1,
    retry: false,
  });

  async function save() {
    setSaving(true);
    try {
      if (await onSave({ name: name.trim(), retentionDays: daysNum, assetId: draft.assetId, metric: draft.metric, enabled })) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit retention policy" : "New retention policy"}</DialogTitle>
          <DialogDescription>Readings older than the retention period are deleted for good by the hourly pruning run. Summaries stay, so long-term charts keep working.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input className="h-8 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Keep raw data 90 days" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Keep readings for (days)</Label>
            <div className="flex items-center gap-2 flex-wrap">
              <Input type="number" min={1} max={3650} className="h-8 text-sm w-28" value={days} onChange={(e) => setDays(e.target.value)} />
              {[30, 90, 180, 365, 730].map((d) => (
                <Button key={d} type="button" size="sm" variant={daysNum === d ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setDays(String(d))}>
                  {d < 365 ? `${d} d` : `${d / 365} yr`}
                </Button>
              ))}
            </div>
            {!validDays && <p className="text-xs text-red-500">Enter a whole number of days from 1 to 3650.</p>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 min-w-0">
              <Label className="text-xs">Asset</Label>
              <Select value={assetId} onValueChange={(v) => { setAssetId(v); setMetric(""); }}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={ALL}>All assets</SelectItem>
                  {assetId !== ALL && !assets.list.some((a) => a.id === assetId) && <SelectItem value={assetId}>Deleted asset</SelectItem>}
                  {assets.list.map((a) => <SelectItem key={a.id} value={a.id}>{a.path}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label className="text-xs">Metric</Label>
              {assetId !== ALL && metricChoices.length > 0 ? (
                <Select value={metric || ALL} onValueChange={(v) => setMetric(v === ALL ? "" : v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={ALL}>All metrics</SelectItem>
                    {metric && !metricChoices.some((m) => m.key === metric) && <SelectItem value={metric}>{metric}</SelectItem>}
                    {metricChoices.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input className="h-8 text-sm" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="All metrics, or a tag such as temperature" />
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {draft.assetId && draft.metric ? "Applies to this metric of this asset only."
              : draft.assetId ? "Applies to every metric of this asset."
              : draft.metric ? "Applies to this metric on every asset."
              : "Applies to every asset and metric that no more specific policy covers."}
            {" "}When several policies match a reading, the most specific one decides.
          </p>
          <div className="flex items-center gap-2">
            <Switch checked={enabled} onCheckedChange={setEnabled} id="policy-enabled" />
            <Label htmlFor="policy-enabled" className="text-xs">Enabled</Label>
          </div>
          {validDays && <PreviewBox preview={preview.data} loading={preview.isFetching} error={preview.error ? (preview.error as Error).message : undefined} />}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={!name.trim() || !validDays || saving}>{saving ? "Saving…" : preview.data?.needsApproval ? "Request approval" : "Save policy"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
