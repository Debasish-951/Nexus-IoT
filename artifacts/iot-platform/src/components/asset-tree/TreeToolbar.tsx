import { Search, Plus, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function TreeToolbar({
  query, setQuery, onExpandAll, onCollapseAll, onAdd, canManage,
}: {
  query: string;
  setQuery: (q: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onAdd: () => void;
  canManage: boolean;
}) {
  return (
    <div className="p-2 border-b border-border space-y-2">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets…"
            className="pl-7 h-8 text-sm"
          />
        </div>
        {canManage && (
          <Button size="sm" className="h-8 px-2.5" onClick={onAdd} title="Create asset">
            <Plus className="w-4 h-4" />
          </Button>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={onExpandAll} title="Expand all">
          <ChevronsUpDown className="w-3.5 h-3.5 mr-1" /> Expand all
        </Button>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={onCollapseAll} title="Collapse all">
          <ChevronsDownUp className="w-3.5 h-3.5 mr-1" /> Collapse all
        </Button>
      </div>
    </div>
  );
}
