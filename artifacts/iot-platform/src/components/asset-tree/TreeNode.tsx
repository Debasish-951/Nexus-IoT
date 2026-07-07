import { memo } from "react";
import {
  SquarePlus, SquareMinus, Folder, Factory, Building2, Boxes, Cpu, MonitorCog, Tag,
  Plus, Pencil, Trash2, LayoutTemplate, LayoutDashboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { Asset } from "@/pages/assetShared";
import { useAssetTree } from "./AssetTreeContext";

const INDENT = 14; // px per depth level (compact, AHI-style)

// Icon + color from the node's role — inferred from name / position.
function styleFor(name: string, hasChildren: boolean, depth: number): { Icon: React.ElementType; color: string } {
  const l = name.toLowerCase();
  if (/telemetry|(^|\s)tags?(\s|$)/.test(l)) return { Icon: Tag, color: "text-violet-500" };
  if (/\bplc\b|\bcpu\b|controller/.test(l)) return { Icon: Cpu, color: "text-slate-500" };
  if (/gateway|edge|opc|modbus|mqtt|sensor|device/.test(l)) return { Icon: MonitorCog, color: "text-cyan-600" };
  if (/\bunit\b/.test(l)) return { Icon: Building2, color: "text-purple-600" };   // all units → same color
  if (depth === 0) return { Icon: Factory, color: "text-[#f47b20]" };              // Textiles root → brand orange
  if (hasChildren) return { Icon: Folder, color: "text-amber-500" };
  return { Icon: Boxes, color: "text-blue-600" };                                  // machines → blue
}

export const TreeNode = memo(function TreeNode({ asset, depth }: { asset: Asset; depth: number }) {
  const t = useAssetTree();
  if (t.visibleIds && !t.visibleIds.has(asset.id)) return null;

  const kids = t.childrenByParent[asset.id] ?? [];
  const hasChildren = kids.length > 0;
  const expanded = t.isExpanded(asset.id);
  const selected = t.selectedId === asset.id;
  const { Icon, color } = styleFor(asset.name, hasChildren, depth);

  const row = (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
      onClick={() => t.setSelectedId(asset.id)}
      className={cn(
        "group flex items-center gap-1 pr-2 h-7 rounded-sm cursor-pointer text-[13px] select-none transition-colors",
        selected ? "bg-primary/10 text-primary font-medium" : "text-foreground hover:bg-muted/60",
      )}
      style={{ paddingLeft: depth * INDENT + 4 }}
      title={asset.name}
    >
      {hasChildren ? (
        <button
          onClick={(e) => { e.stopPropagation(); t.toggle(asset.id); }}
          className="p-0.5 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <SquareMinus className="w-3.5 h-3.5" /> : <SquarePlus className="w-3.5 h-3.5" />}
        </button>
      ) : (
        <span className="w-[18px] shrink-0" />
      )}
      <Icon className={cn("w-4 h-4 shrink-0", color)} />
      <span className="truncate flex-1">{asset.name}</span>
    </div>
  );

  const hasMenu = t.canManage || !!t.onOpenBuilder;
  const wrapped = hasMenu ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {t.onOpenBuilder && (
          <ContextMenuItem onSelect={() => t.onOpenBuilder!(asset)}><LayoutDashboard className="w-4 h-4 mr-2" /> Dashboard Builder</ContextMenuItem>
        )}
        {t.onOpenBuilder && t.canManage && <ContextMenuSeparator />}
        {t.canManage && <>
          <ContextMenuItem onSelect={() => t.onAddChild(asset.id)}><Plus className="w-4 h-4 mr-2" /> Create Child</ContextMenuItem>
          <ContextMenuItem onSelect={() => t.onRename(asset)}><Pencil className="w-4 h-4 mr-2" /> Rename</ContextMenuItem>
          <ContextMenuItem onSelect={() => t.onAssignTemplate(asset)}><LayoutTemplate className="w-4 h-4 mr-2" /> Assign Template</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => t.onDelete(asset)} className="text-destructive focus:text-destructive"><Trash2 className="w-4 h-4 mr-2" /> Delete</ContextMenuItem>
        </>}
      </ContextMenuContent>
    </ContextMenu>
  ) : row;

  return (
    <>
      {wrapped}
      {hasChildren && expanded && (
        <div className="relative animate-in fade-in slide-in-from-top-1 duration-150" role="group">
          {/* vertical connector line down this parent's children */}
          <div className="absolute top-0 bottom-1 border-l border-border/70" style={{ left: depth * INDENT + 13 }} />
          {kids.map((c) => <TreeNode key={c.id} asset={c} depth={depth + 1} />)}
        </div>
      )}
    </>
  );
});
