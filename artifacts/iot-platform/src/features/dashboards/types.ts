// ── Dashboard builder types ──
export interface Widget {
  id: string;
  type: string;                 // registry key, e.g. "kpi", "line", "gauge"
  x: number; y: number;         // grid units
  w: number; h: number;         // grid units
  locked?: boolean;
  config: Record<string, any>;  // title, assetId, tag, color, text, …
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: Widget[];
  roleAccess?: string[];
}

// Client-side (localStorage) folder organization + favorites/recent.
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}
export interface ExplorerState {
  folders: Folder[];
  assignments: Record<string, string | null>; // dashboardId -> folderId (null = root)
  favorites: string[];                          // dashboard ids
  recent: string[];                             // dashboard ids, most-recent first
}

export const GRID_COLS = 12;
export const ROW_H = 36; // px per grid row
