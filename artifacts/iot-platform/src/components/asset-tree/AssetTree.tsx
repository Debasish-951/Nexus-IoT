import { Blocks } from "lucide-react";
import { TreeNode } from "./TreeNode";
import { useAssetTree } from "./AssetTreeContext";

// Renders the top-level roots; each recurses via TreeNode. The panel scrolls
// independently (parent gives it a fixed height).
export function AssetTree({ loading, emptyMessage }: { loading?: boolean; emptyMessage?: string }) {
  const t = useAssetTree();
  const roots = t.childrenByParent["root"] ?? [];

  if (loading) {
    return (
      <div className="p-3 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-6 rounded bg-muted/50 animate-pulse" style={{ width: `${70 - (i % 4) * 10}%` }} />
        ))}
      </div>
    );
  }

  if (roots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6 text-center">
        <Blocks className="w-8 h-8 mb-2 opacity-20" />
        <p className="text-sm">{emptyMessage ?? "No assets match."}</p>
      </div>
    );
  }

  return (
    <div className="py-1 pr-1" role="tree" aria-label="Asset hierarchy">
      {roots.map((r) => <TreeNode key={r.id} asset={r} depth={0} />)}
    </div>
  );
}
