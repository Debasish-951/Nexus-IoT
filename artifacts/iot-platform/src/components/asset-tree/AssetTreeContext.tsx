import { createContext, useContext } from "react";
import type { Asset } from "@/pages/assetShared";

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
  onAddChild: (id: string) => void;
  onRename: (a: Asset) => void;
  onDelete: (a: Asset) => void;
  onAssignTemplate: (a: Asset) => void;
  onOpenBuilder?: (a: Asset) => void;   // optional — right-click → open Dashboard Builder
}

const Ctx = createContext<AssetTreeCtx | null>(null);
export const AssetTreeProvider = Ctx.Provider;
export function useAssetTree(): AssetTreeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAssetTree must be used within <AssetTreeProvider>");
  return v;
}
