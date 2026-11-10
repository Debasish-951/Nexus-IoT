import { memo } from "react";
import { FolderInput, Share2,
  ChevronRight, Folder, Factory, Building2, Boxes, Cpu, MonitorCog, Tag,
  Plus, Pencil, Trash2, LayoutTemplate, LayoutDashboard,
  SquarePen, Copy, CopyPlus, CircleMinus, Star, Download, Upload, Rocket, CornerDownRight, Rows3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { Asset } from "@/pages/assetShared";
import { useAssetTree } from "./AssetTreeContext";

const INDENT = 14; // px per depth level (compact, AHI-style)

// Futuristic hexagon "chip" icon for leaf assets (Neon Caret style) — replaces
// the old lucide Boxes cluster. Takes className so it drops into styleFor as an Icon.
function HexChip({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3.2l7.6 4.4v8.8L12 20.8 4.4 16.4V7.6L12 3.2z" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      <path d="M12 3.2v4.4M12 16.4v4.4" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
    </svg>
  );
}

// Icon + color from the node's role — inferred from name / position.
function styleFor(name: string, hasChildren: boolean, depth: number): { Icon: React.ElementType; color: string } {
  const l = name.toLowerCase();
  if (/telemetry|(^|\s)tags?(\s|$)/.test(l)) return { Icon: Tag, color: "text-violet-500" };
  if (/\bplc\b|\bcpu\b|controller/.test(l)) return { Icon: Cpu, color: "text-slate-500" };
  if (/gateway|edge|opc|modbus|mqtt|sensor|device/.test(l)) return { Icon: MonitorCog, color: "text-cyan-600" };
  if (/\bunit\b/.test(l)) return { Icon: Building2, color: "text-purple-600" };   // all units → same color
  if (depth === 0) return { Icon: Factory, color: "text-[#f47b20]" };              // root → brand orange
  if (hasChildren) return { Icon: Folder, color: "text-amber-500" };
  return { Icon: HexChip, color: "text-cyan-400" };                                // leaf assets → hex chip
}

// `verticals` = passthrough guide lines for ancestor levels 0..depth-2 (true =
// that ancestor has more siblings below, so its line continues). `isLast` = this
// node is the last of its siblings (elbow terminates, no line below it).
export const TreeNode = memo(function TreeNode({ asset, depth, verticals = [], isLast = true }: {
  asset: Asset; depth: number; verticals?: boolean[]; isLast?: boolean;
}) {
  const t = useAssetTree();
  const nodeLimits = t.nodeAccess?.(asset.id);
  const canWriteNode = nodeLimits?.write ?? true;
  const canDeleteNode = nodeLimits?.delete ?? true;
  if (t.visibleIds && !t.visibleIds.has(asset.id)) return null;

  const kids = t.childrenByParent[asset.id] ?? [];
  const hasChildren = kids.length > 0;
  const expanded = t.isExpanded(asset.id);
  const selected = t.selectedId === asset.id;
  const { Icon, color } = styleFor(asset.name, hasChildren, depth);
  const elbowX = (depth - 1) * INDENT + 13; // x of this node's connector column
  // Stop the elbow tick BEFORE the toggle (so it never crosses the chevron);
  // leaves have no toggle, so run it up to just before the icon.
  const tickEnd = hasChildren ? depth * INDENT + 4 : depth * INDENT + 20;

  const row = (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
      onClick={() => t.setSelectedId(asset.id)}
      className={cn(
        "group relative flex items-center gap-1 pr-2 h-7 rounded-sm cursor-pointer text-[13px] select-none transition-colors",
        selected ? "bg-primary/10 text-primary font-medium" : "text-foreground hover:bg-muted/60",
      )}
      style={{ paddingLeft: depth * INDENT + 4 }}
      title={asset.name}
    >
      {/* ── tree connector guides (clean elbow lines, image-1 style) ── */}
      {depth > 0 && (
        <>
          {verticals.map((on, k) => on ? (
            <span key={k} aria-hidden className="absolute top-0 bottom-0 w-px bg-cyan-400/20" style={{ left: k * INDENT + 13 }} />
          ) : null)}
          {/* elbow: down from top to centre, then across to the node */}
          <span aria-hidden className="absolute w-px bg-cyan-400/25" style={{ left: elbowX, top: 0, height: 14 }} />
          {!isLast && <span aria-hidden className="absolute w-px bg-cyan-400/20" style={{ left: elbowX, top: 14, bottom: 0 }} />}
          <span aria-hidden className="absolute h-px bg-cyan-400/25" style={{ left: elbowX, top: 14, width: Math.max(0, tickEnd - elbowX) }} />
        </>
      )}
      {hasChildren ? (
        <button
          onClick={(e) => { e.stopPropagation(); t.toggle(asset.id); }}
          className="relative p-0.5 shrink-0 rounded text-muted-foreground hover:text-foreground hover:bg-cyan-400/10"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <ChevronRight className={cn("w-3.5 h-3.5 transition-transform duration-200 ease-out", expanded && "rotate-90")} />
        </button>
      ) : (
        <span className="relative w-[18px] shrink-0" />
      )}
      <Icon className={cn("relative w-4 h-4 shrink-0", color)} />
      <span className="relative truncate flex-1">{asset.name}</span>
      {t.canManage && (canWriteNode || canDeleteNode) && (
        <div
          className="flex items-center gap-0.5 ml-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {canWriteNode && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-0.5 rounded text-emerald-500 hover:bg-emerald-500/10"
                title="Create asset"
                aria-label={`Create an asset relative to ${asset.name}`}
              >
                <Plus className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Create asset</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => t.onAddChild?.(asset.id)} className="gap-2.5 py-2 cursor-pointer">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0"><CornerDownRight className="w-4 h-4" /></span>
                <span className="flex flex-col min-w-0">
                  <span className="text-sm font-medium leading-tight">Child asset</span>
                  <span className="text-[11px] text-muted-foreground leading-tight truncate">Nested under “{asset.name}”</span>
                </span>
              </DropdownMenuItem>
              {asset.parentId && (
                <DropdownMenuItem onSelect={() => t.onAddChild?.(asset.parentId!)} className="gap-2.5 py-2 cursor-pointer">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0"><Rows3 className="w-4 h-4" /></span>
                  <span className="flex flex-col min-w-0">
                    <span className="text-sm font-medium leading-tight">Sibling asset</span>
                    <span className="text-[11px] text-muted-foreground leading-tight truncate">Same level as “{asset.name}”</span>
                  </span>
                </DropdownMenuItem>
              )}
              {t.onAddRoot && (
                <DropdownMenuItem onSelect={() => t.onAddRoot!()} className="gap-2.5 py-2 cursor-pointer">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground/70 shrink-0"><Boxes className="w-4 h-4" /></span>
                  <span className="flex flex-col min-w-0">
                    <span className="text-sm font-medium leading-tight">Top-level asset</span>
                    <span className="text-[11px] text-muted-foreground leading-tight truncate">New root project or site</span>
                  </span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>}
          {canWriteNode && <button
            type="button"
            className="p-0.5 rounded text-cyan-500 hover:bg-cyan-500/10"
            title="Edit asset"
            aria-label={`Edit ${asset.name}`}
            onClick={() => t.onRename?.(asset)}
          >
            <Pencil className="w-3 h-3" />
          </button>}
          {canDeleteNode && <button
            type="button"
            className="p-0.5 rounded text-destructive hover:bg-destructive/10"
            title="Delete asset"
            aria-label={`Delete ${asset.name}`}
            onClick={() => t.onDelete?.(asset)}
          >
            <Trash2 className="w-3 h-3" />
          </button>}
        </div>
      )}
    </div>
  );

  const d = t.dashboard;
  const hasMenu = t.canManage || !!t.onOpenBuilder || !!d;
  const wrapped = hasMenu ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        {t.onOpenBuilder && (
          <ContextMenuItem onSelect={() => t.onOpenBuilder!(asset)}><LayoutDashboard className="w-4 h-4 mr-2" /> Dashboard Builder</ContextMenuItem>
        )}
        {d && <>
          {canWriteNode && <ContextMenuItem onSelect={() => d.edit(asset)}><SquarePen className="w-4 h-4 mr-2" /> Edit Dashboard</ContextMenuItem>}
          <ContextMenuItem onSelect={() => d.clone(asset)}><Copy className="w-4 h-4 mr-2" /> Clone Dashboard</ContextMenuItem>
          <ContextMenuItem onSelect={() => d.cloneWithChildren(asset)}><CopyPlus className="w-4 h-4 mr-2" /> Clone Dashboard &amp; Children</ContextMenuItem>
          <ContextMenuItem onSelect={() => d.createTemplate(asset)}><LayoutTemplate className="w-4 h-4 mr-2" /> Create Template</ContextMenuItem>
          {canWriteNode && <ContextMenuItem onSelect={() => d.remove(asset)} className="text-destructive focus:text-destructive"><CircleMinus className="w-4 h-4 mr-2" /> Delete Dashboard</ContextMenuItem>}
          <ContextMenuItem onSelect={() => d.toggleBookmark(asset)}>
            <Star className={cn("w-4 h-4 mr-2", d.isBookmarked(asset.id) && "fill-current text-amber-500")} /> {d.isBookmarked(asset.id) ? "Remove Bookmark" : "Bookmark"}
          </ContextMenuItem>
          {canWriteNode && <ContextMenuItem onSelect={() => d.importDashboard(asset)}><Download className="w-4 h-4 mr-2" /> Import Dashboard</ContextMenuItem>}
          {t.onShare && <ContextMenuItem onSelect={() => t.onShare!(asset)}><Share2 className="w-4 h-4 mr-2" /> Manage Access</ContextMenuItem>}
          {t.onAssignProject && canWriteNode && !asset.parentId && <ContextMenuItem onSelect={() => t.onAssignProject!(asset)}><FolderInput className="w-4 h-4 mr-2" /> Assign to Project</ContextMenuItem>}
          <ContextMenuItem onSelect={() => d.exportDashboard(asset)}><Upload className="w-4 h-4 mr-2" /> Export Dashboard</ContextMenuItem>
          <ContextMenuItem onSelect={() => d.futuristic(asset)}><Rocket className="w-4 h-4 mr-2" /> Futuristic Dashboard</ContextMenuItem>
        </>}
        {(t.onOpenBuilder || d) && t.canManage && t.onAssignTemplate && <ContextMenuSeparator />}
        {t.canManage && t.onAssignTemplate && (
          <ContextMenuItem onSelect={() => t.onAssignTemplate!(asset)}><LayoutTemplate className="w-4 h-4 mr-2" /> Assign Template</ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  ) : row;

  return (
    <>
      {wrapped}
      {hasChildren && expanded && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-200 ease-out" role="group">
          {kids.map((c, i) => (
            <TreeNode
              key={c.id}
              asset={c}
              depth={depth + 1}
              verticals={depth === 0 ? [] : [...verticals, !isLast]}
              isLast={i === kids.length - 1}
            />
          ))}
        </div>
      )}
    </>
  );
});
