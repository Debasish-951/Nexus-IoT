import { useMemo, useState } from "react";
import {
  Search, FolderPlus, FilePlus2, Folder, FolderOpen, SquarePlus, SquareMinus,
  LayoutDashboard, Star, Clock, Pencil, Copy, Trash2, FolderInput,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { DashboardsApi } from "./useDashboards";
import type { Dashboard } from "./types";

export function DashboardExplorer({ api, currentId, onOpen }: { api: DashboardsApi; currentId: string | null; onOpen: (id: string) => void }) {
  const { dashboards, explorer, addFolder, renameFolder, deleteFolder, createDashboard, renameDashboard, cloneDashboard, deleteDashboard, moveDashboard, moveFolder, toggleFavorite } = api;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const dashById = useMemo(() => new Map(dashboards.map((d) => [d.id, d])), [dashboards]);
  const foldersByParent = useMemo(() => {
    const m: Record<string, typeof explorer.folders> = {};
    for (const f of explorer.folders) (m[f.parentId ?? "root"] ||= []).push(f);
    for (const k in m) m[k].sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [explorer.folders]);
  const dashInFolder = (folderId: string | null) =>
    dashboards.filter((d) => (explorer.assignments[d.id] ?? null) === folderId).sort((a, b) => a.name.localeCompare(b.name));

  const searching = q.trim().length > 0;
  const matches = searching ? dashboards.filter((d) => d.name.toLowerCase().includes(q.trim().toLowerCase())) : [];

  function DashRow({ d, depth }: { d: Dashboard; depth: number }) {
    const fav = explorer.favorites.includes(d.id);
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            draggable
            onDragStart={(e) => { e.dataTransfer.setData("dash-id", d.id); }}
            onClick={() => onOpen(d.id)}
            className={cn("group flex items-center gap-1.5 h-7 pr-2 rounded-sm cursor-pointer text-[13px] select-none",
              currentId === d.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60")}
            style={{ paddingLeft: depth * 14 + 22 }}
            title={d.name}
          >
            <LayoutDashboard className="w-3.5 h-3.5 shrink-0 text-slate-400" />
            <span className="truncate flex-1">{d.name}</span>
            {fav && <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onSelect={() => onOpen(d.id)}>Open</ContextMenuItem>
          <ContextMenuItem onSelect={() => { const n = prompt("Rename dashboard", d.name); if (n?.trim()) renameDashboard(d.id, n.trim()); }}><Pencil className="w-4 h-4 mr-2" /> Rename</ContextMenuItem>
          <ContextMenuItem onSelect={() => cloneDashboard(d)}><Copy className="w-4 h-4 mr-2" /> Duplicate / Clone</ContextMenuItem>
          <ContextMenuItem onSelect={() => toggleFavorite(d.id)}><Star className="w-4 h-4 mr-2" /> {fav ? "Remove favorite" : "Add favorite"}</ContextMenuItem>
          <ContextMenuItem onSelect={() => moveDashboard(d.id, null)}><FolderInput className="w-4 h-4 mr-2" /> Move to root</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => { if (confirm(`Delete "${d.name}"?`)) deleteDashboard(d.id); }}><Trash2 className="w-4 h-4 mr-2" /> Delete</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  function FolderRow({ id, depth }: { id: string; depth: number }) {
    const folder = explorer.folders.find((f) => f.id === id)!;
    const expanded = open.has(id);
    const childFolders = foldersByParent[id] ?? [];
    const childDashes = dashInFolder(id);
    return (
      <div>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              onClick={() => toggle(id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const dashId = e.dataTransfer.getData("dash-id"); const fId = e.dataTransfer.getData("folder-id"); if (dashId) moveDashboard(dashId, id); else if (fId) moveFolder(fId, id); }}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("folder-id", id)}
              className="group flex items-center gap-1 h-7 pr-2 rounded-sm cursor-pointer text-[13px] select-none hover:bg-muted/60"
              style={{ paddingLeft: depth * 14 + 4 }}
              title={folder.name}
            >
              <span className="text-muted-foreground shrink-0">{expanded ? <SquareMinus className="w-3.5 h-3.5" /> : <SquarePlus className="w-3.5 h-3.5" />}</span>
              {expanded ? <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" /> : <Folder className="w-4 h-4 text-amber-500 shrink-0" />}
              <span className="truncate flex-1 font-medium">{folder.name}</span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            <ContextMenuItem onSelect={() => { const n = prompt("New folder name"); if (n?.trim()) { addFolder(n.trim(), id); setOpen((s) => new Set(s).add(id)); } }}><FolderPlus className="w-4 h-4 mr-2" /> New Folder</ContextMenuItem>
            <ContextMenuItem onSelect={() => { const n = prompt("New dashboard name", "New Dashboard"); if (n?.trim()) createDashboard(n.trim(), id).then((did) => { if (did) onOpen(did); }); }}><FilePlus2 className="w-4 h-4 mr-2" /> New Dashboard</ContextMenuItem>
            <ContextMenuItem onSelect={() => { const n = prompt("Rename folder", folder.name); if (n?.trim()) renameFolder(id, n.trim()); }}><Pencil className="w-4 h-4 mr-2" /> Rename</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => { if (confirm(`Delete folder "${folder.name}"? Its contents move to root.`)) deleteFolder(id); }}><Trash2 className="w-4 h-4 mr-2" /> Delete Folder</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {expanded && (
          <div className="animate-in fade-in slide-in-from-top-1 duration-150">
            {childFolders.map((f) => <FolderRow key={f.id} id={f.id} depth={depth + 1} />)}
            {childDashes.map((d) => <DashRow key={d.id} d={d} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  }

  const rootFolders = foldersByParent["root"] ?? [];
  const rootDashes = dashInFolder(null);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold px-1"><LayoutDashboard className="w-4 h-4 text-primary" /> Dashboards</div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dashboards…" className="pl-7 h-8 text-sm" />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { const n = prompt("New folder name"); if (n?.trim()) addFolder(n.trim(), null); }}><FolderPlus className="w-3.5 h-3.5 mr-1" /> Folder</Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { const n = prompt("New dashboard name", "New Dashboard"); if (n?.trim()) createDashboard(n.trim(), null).then((did) => { if (did) onOpen(did); }); }}><FilePlus2 className="w-3.5 h-3.5 mr-1" /> Dashboard</Button>
        </div>
      </div>

      <div
        className="flex-1 overflow-auto py-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { const dashId = e.dataTransfer.getData("dash-id"); const fId = e.dataTransfer.getData("folder-id"); if (dashId) moveDashboard(dashId, null); else if (fId) moveFolder(fId, null); }}
      >
        {searching ? (
          matches.length ? matches.map((d) => <DashRow key={d.id} d={d} depth={0} />) : <p className="text-xs text-muted-foreground text-center py-6">No dashboards match.</p>
        ) : (
          <>
            {explorer.favorites.length > 0 && (
              <Section icon={Star} label="Favorites">
                {explorer.favorites.map((id) => dashById.get(id)).filter(Boolean).map((d) => <DashRow key={d!.id} d={d!} depth={0} />)}
              </Section>
            )}
            {explorer.recent.length > 0 && (
              <Section icon={Clock} label="Recent">
                {explorer.recent.map((id) => dashById.get(id)).filter(Boolean).slice(0, 5).map((d) => <DashRow key={"r" + d!.id} d={d!} depth={0} />)}
              </Section>
            )}
            <Section icon={Folder} label="All Dashboards">
              {rootFolders.map((f) => <FolderRow key={f.id} id={f.id} depth={0} />)}
              {rootDashes.map((d) => <DashRow key={d.id} d={d} depth={0} />)}
              {rootFolders.length === 0 && rootDashes.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No dashboards yet. Create one above.</p>}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="w-3 h-3" /> {label}</p>
      {children}
    </div>
  );
}
