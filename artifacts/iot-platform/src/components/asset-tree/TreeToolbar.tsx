import { Search, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Search + create, above the asset tree.
 *
 * The "Expand all" / "Collapse all" pair that used to sit on a second row was
 * removed on request. It was the first thing to break when the pane narrowed —
 * "Collapse all" clipped mid-word — and per-node chevrons already cover the
 * same ground. Search force-expands the matching paths on its own, which is the
 * case "expand all" was really being used for.
 *
 * The remaining row wraps rather than squeezing: below roughly 240px the create
 * button drops to its own line instead of crushing the search field down to its
 * magnifier icon.
 */
export function TreeToolbar({
  query, setQuery, onAdd, canManage,
}: {
  query: string;
  setQuery: (q: string) => void;
  onAdd: () => void;
  canManage: boolean;
}) {
  return (
    <div className="p-2 border-b border-border">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative flex-1 min-w-[120px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets…"
            className="pl-7 h-8 text-sm"
          />
        </div>
        {canManage && (
          <Button size="sm" className="h-8 px-2.5 shrink-0 whitespace-nowrap" onClick={onAdd} title="Create a top-level asset">
            <Plus className="w-4 h-4 mr-1" />
            Create Asset
          </Button>
        )}
      </div>
    </div>
  );
}
