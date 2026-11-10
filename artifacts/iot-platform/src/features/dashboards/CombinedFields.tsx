import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/auth-api";

interface TagEntry { assetId: string; assetName: string; projectId: string; projectName: string; metric: string }
interface Source { assetId: string; tag: string; label?: string }

const selectClass = "w-full h-8 rounded-md border border-border bg-background px-2 text-sm";
const leafOf = (metric: string) => metric.slice(metric.lastIndexOf(".") + 1);

/**
 * Settings for the Combined widget: one figure across many projects. Picking a tag
 * name selects every matching tag in the chosen projects, because adding each one
 * by hand across 100 projects would never get done.
 */
export function CombinedFields({ config, onChange }: {
  config: Record<string, any>;
  onChange: (patch: Record<string, any>) => void;
}) {
  const [tags, setTags] = useState<TagEntry[]>([]);
  const [leaf, setLeaf] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  const sources: Source[] = Array.isArray(config.sources) ? config.sources : [];

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/viz-tags").then((r) => (r.ok ? r.json() : [])).then((rows) => { if (!cancelled) setTags(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const projects = useMemo(() => {
    const byId = new Map(tags.map((t) => [t.projectId, t.projectName]));
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tags]);
  const leaves = useMemo(() => [...new Set(tags.map((t) => leafOf(t.metric)))].sort((a, b) => a.localeCompare(b)), [tags]);
  const matches = tags.filter((t) => leafOf(t.metric) === leaf && !excluded.includes(t.projectId));

  function addMatches() {
    const known = new Set(sources.map((s) => `${s.assetId}|${s.tag}`));
    const added = matches.filter((m) => !known.has(`${m.assetId}|${m.metric}`))
      .map((m) => ({ assetId: m.assetId, tag: m.metric, label: `${m.projectName}: ${m.metric}` }));
    onChange({ sources: [...sources, ...added] });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Combine by</Label>
          <select className={selectClass} value={config.op ?? "sum"} onChange={(e) => onChange({ op: e.target.value })}>
            <option value="sum">Sum</option><option value="avg">Average</option><option value="min">Minimum</option><option value="max">Maximum</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Unit</Label>
          <Input className="h-8" value={config.unit ?? ""} placeholder="kW" onChange={(e) => onChange({ unit: e.target.value })} />
        </div>
      </div>

      <div className="rounded-md border border-border p-2 space-y-2">
        <div className="space-y-1">
          <Label className="text-xs">Tag name</Label>
          <select className={selectClass} value={leaf} onChange={(e) => setLeaf(e.target.value)}>
            <option value="">Choose a tag…</option>
            {leaves.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        {projects.length > 1 && (
          <div className="space-y-1 max-h-28 overflow-auto">
            {projects.map(([id, name]) => (
              <label key={id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={!excluded.includes(id)}
                       onChange={(e) => setExcluded((x) => e.target.checked ? x.filter((v) => v !== id) : [...x, id])} />
                {name}
              </label>
            ))}
          </div>
        )}
        <Button type="button" size="sm" variant="outline" className="w-full h-7 text-xs" disabled={matches.length === 0} onClick={addMatches}>
          Add {matches.length} matching tag{matches.length === 1 ? "" : "s"}
        </Button>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Included ({sources.length})</Label>
          {sources.length > 0 && (
            <button type="button" className="text-[11px] text-muted-foreground hover:text-destructive" onClick={() => onChange({ sources: [] })}>Clear all</button>
          )}
        </div>
        <div className="max-h-40 overflow-auto space-y-0.5">
          {sources.map((s) => (
            <div key={`${s.assetId}|${s.tag}`} className="flex items-center gap-1 text-[11px]">
              <span className="flex-1 min-w-0 truncate" title={s.label ?? s.tag}>{s.label ?? s.tag}</span>
              <button type="button" title="Remove" className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => onChange({ sources: sources.filter((x) => x !== s) })}><X className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">Every included tag must use the same unit, or the combined figure means nothing.</p>
      </div>
    </div>
  );
}
