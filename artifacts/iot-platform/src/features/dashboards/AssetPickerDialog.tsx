import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Box, Search, Layers } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TreeAsset { id: string; name: string; parentId?: string | null }

/**
 * Picks a widget's data source from the asset hierarchy.
 *
 * A flat `<select>` of every asset was unusable once real projects existed: the
 * names alone ("All_machine" twice under different units) carry no context, and
 * the ordering is arbitrary. The tree is the shape the user built, so it is the
 * shape they should choose from.
 *
 * Deliberately its own small component rather than the Assets page tree: that one
 * carries context menus, drag-to-reparent and mutation handlers, none of which
 * belong in a picker.
 */
export function AssetPickerDialog({ open, assets, value, onClose, onSelect }: {
  open: boolean;
  assets: TreeAsset[];
  value?: string;
  onClose: () => void;
  onSelect: (assetId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string>(value ?? "");
  const [query, setQuery] = useState("");

  const byParent = useMemo(() => {
    const m = new Map<string, TreeAsset[]>();
    for (const a of assets) {
      const key = a.parentId ?? "__root";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [assets]);

  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    let cur = byId.get(id)?.parentId ?? null;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) { guard.add(cur); out.push(cur); cur = byId.get(cur)?.parentId ?? null; }
    return out;
  };

  // Reopening jumps to whatever is already bound, with its branch unfolded.
  useEffect(() => {
    if (!open) return;
    setPicked(value ?? "");
    setQuery("");
    setExpanded(new Set(value ? ancestorsOf(value) : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  /** Matching nodes plus every ancestor, so a deep hit stays reachable. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const keep = new Set<string>();
    for (const a of assets) {
      if (!a.name.toLowerCase().includes(q)) continue;
      keep.add(a.id);
      for (const p of ancestorsOf(a.id)) keep.add(p);
    }
    return keep;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, assets]);

  const rows = (parentKey: string, depth: number): React.ReactNode[] =>
    (byParent.get(parentKey) ?? []).flatMap((a) => {
      if (visible && !visible.has(a.id)) return [];
      const children = byParent.get(a.id) ?? [];
      const hasChildren = children.length > 0;
      const isOpen = expanded.has(a.id) || (visible !== null && hasChildren);
      const selected = picked === a.id;
      return [
        <div key={a.id}
          onClick={() => setPicked(a.id)}
          onDoubleClick={() => { onSelect(a.id); onClose(); }}
          className={cn(
            "flex items-center gap-1.5 py-1 pr-2 rounded cursor-pointer text-sm",
            selected ? "bg-primary/15 text-foreground" : "hover:bg-muted/60",
          )}
          style={{ paddingLeft: depth * 16 + 6 }}
        >
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((p) => { const n = new Set(p); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; });
              }}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : <span className="w-3.5 shrink-0" />}
          <Box className={cn("w-3.5 h-3.5 shrink-0", selected ? "text-primary" : "text-muted-foreground")} />
          <span className="truncate">{a.name}</span>
        </div>,
        ...(isOpen ? rows(a.id, depth + 1) : []),
      ];
    });

  const pickedName = picked ? byId.get(picked)?.name : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Layers className="w-4 h-4" /> Select data source</DialogTitle>
          <DialogDescription>Choose the asset this widget reads from. Its attributes become the metric list.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search assets…" className="pl-8 h-8 text-sm" />
        </div>

        <div className="rounded-md border border-border max-h-80 overflow-auto py-1">
          {/* Unbinding is a real choice — a widget with no source renders sample data. */}
          <div
            onClick={() => setPicked("")}
            className={cn("flex items-center gap-1.5 py-1 pl-2.5 pr-2 rounded cursor-pointer text-sm",
              picked === "" ? "bg-primary/15" : "hover:bg-muted/60")}
          >
            <span className="w-3.5 shrink-0" />
            <span className="text-muted-foreground">— none (sample data) —</span>
          </div>
          {rows("__root", 0)}
          {assets.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No assets yet.</p>
          )}
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-muted-foreground truncate">
            {pickedName ? <>Selected: <span className="text-foreground font-medium">{pickedName}</span></> : "Nothing selected — the widget will show sample data."}
          </span>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { onSelect(picked); onClose(); }}>Select</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
