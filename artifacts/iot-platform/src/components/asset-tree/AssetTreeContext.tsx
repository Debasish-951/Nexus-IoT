import { createContext, useContext } from "react";
import type { Asset } from "@/pages/assetShared";

// Dashboard-level right-click actions for an asset node. Optional — only the
// Visualization page supplies these, so other tree callers don't show them.
export interface DashboardActions {
  edit: (a: Asset) => void;
  clone: (a: Asset) => void;
  cloneWithChildren: (a: Asset) => void;
  createTemplate: (a: Asset) => void;
  remove: (a: Asset) => void;
  toggleBookmark: (a: Asset) => void;
  isBookmarked: (id: string) => boolean;
  importDashboard: (a: Asset) => void;
  exportDashboard: (a: Asset) => void;
  futuristic: (a: Asset) => void;
}

// Shared state + handlers for the recursive asset tree. Kept in context so
// deeply-nested TreeNodes don't need prop drilling (supports unlimited depth).
export interface AssetTreeCtx {
  childrenByParent: Record<string, Asset[]>; // key = parentId, or "root" for top level
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  isExpanded: (id: string) => boolean;
  toggle: (id: string) => void;
  visibleIds: Set<string> | null;            // null = no filter; else only these render
  canManage: boolean;
  // Asset-mutation handlers are OPTIONAL: a read-only consumer (e.g. the
  // Visualization page, which only *reads* the hierarchy) omits them and sets
  // canManage:false. They only render when canManage is true.
  onAddChild?: (id: string) => void;
  onAddRoot?: () => void;               // create a new top-level asset (no parent)
  onRename?: (a: Asset) => void;
  onDelete?: (a: Asset) => void;
  // Optional: only meaningful for real assets. The Visualization tree renders
  // its own hierarchy nodes, which have no asset template, so it omits this.
  onAssignTemplate?: (a: Asset) => void;
  onOpenBuilder?: (a: Asset) => void;   // optional — right-click → open Dashboard Builder
  dashboard?: DashboardActions;         // optional — right-click → dashboard actions
  // Optional per-node limits on top of canManage. Omitted means no extra limit,
  // which is what the Asset Hub tree relies on.
  nodeAccess?: (id: string) => { write: boolean; delete: boolean };
  onShare?: (a: Asset) => void;         // optional — right-click → Manage Access
  onAssignProject?: (a: Asset) => void; // optional — right-click → Assign to Project
}

const Ctx = createContext<AssetTreeCtx | null>(null);
export const AssetTreeProvider = Ctx.Provider;
export function useAssetTree(): AssetTreeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAssetTree must be used within <AssetTreeProvider>");
  return v;
}
