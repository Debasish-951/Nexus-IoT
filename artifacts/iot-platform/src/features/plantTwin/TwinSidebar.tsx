import { useMemo, useState } from "react";
import { useT } from "@/i18n";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Eye, Folder, FolderOpen, FolderPlus, Box, Pencil, Search, Trash2, X } from "lucide-react";

export interface TwinListItem { id: string; name: string; sub?: string; viewOnly?: boolean; folder?: boolean; parentId?: string | null }

const DRAG = "application/x-live-twin-node";

/**
 * Left panel of Live Twin: the saved twins of the chosen type as a folder tree,
 * in the style of the Visualization dashboard panel. Folders are optional; drag
 * a twin or folder onto a folder (or onto "Top level") to move it. Kept free of
 * three.js so it loads with the page, not with the 3D chunk.
 */
export function TwinSidebar({ title, items, currentId, loading, collapsed, onCollapse, onPick, folderId, onFolder, hierarchy }: {
  title: string;
  items: TwinListItem[];
  currentId: string | null;
  loading?: boolean;
  collapsed: boolean;
  onCollapse: (c: boolean) => void;
  onPick: (id: string) => void;
  /** Selected folder: new twins are saved into it. */
  folderId: string | null;
  onFolder: (id: string | null) => void;
  /** Folder actions; absent where twins cannot be organised (image twins live in the browser). */
  hierarchy?: {
    canEdit: boolean;
    /** Live Twin Delete right; folders cannot be deleted without it. */
    canDelete?: boolean;
    create: (parentId: string | null) => void;
    rename: (id: string, name: string) => void;
    remove: (id: string) => void;
    move: (id: string, parentId: string | null) => void;
  };
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<TwinListItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const byParent = useMemo(() => {
    const ids = new Set(items.map((i) => i.id));
    const m = new Map<string | null, TwinListItem[]>();
    items.forEach((i) => {
      const p = i.parentId && ids.has(i.parentId) ? i.parentId : null;
      m.set(p, [...(m.get(p) ?? []), i]);
    });
    m.forEach((l) => l.sort((a, b) => Number(!!b.folder) - Number(!!a.folder) || a.name.localeCompare(b.name)));
    return m;
  }, [items]);
  const q = search.trim().toLowerCase();
  // While searching, show matches and the folders leading to them.
  const visible = useMemo(() => {
    if (!q) return null;
    const keep = new Set<string>(); const byId = new Map(items.map((i) => [i.id, i]));
    items.forEach((i) => { if (i.name.toLowerCase().includes(q)) { let c: TwinListItem | undefined = i; while (c) { keep.add(c.id); c = c.parentId ? byId.get(c.parentId) : undefined; } } });
    return keep;
  }, [q, items]);

  if (collapsed) {
    return (
      <div className="shrink-0 border border-border rounded-lg bg-card flex flex-col items-center py-2">
        <button onClick={() => onCollapse(false)} className="p-1.5 rounded hover:bg-muted text-muted-foreground" aria-label={t("Show twin list")} title={t("Show twin list")}>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const canDrag = !!hierarchy?.canEdit;
  const dropProps = (target: string | null) => canDrag ? {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); e.stopPropagation(); setDropTarget(target ?? "__root"); } },
    onDragLeave: () => setDropTarget(null),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(DRAG); setDropTarget(null);
      if (!id || id === target) return;
      e.preventDefault(); e.stopPropagation();
      hierarchy!.move(id, target);
      if (target) setOpen((s) => new Set(s).add(target));
    },
  } : {};

  const row = (i: TwinListItem, depth: number): React.ReactNode => {
    if (visible && !visible.has(i.id)) return null;
    const isOpen = !!visible || open.has(i.id);
    const kids = byParent.get(i.id) ?? [];
    const active = i.folder ? folderId === i.id : i.id === currentId;
    return (
      <div key={i.id}>
        <div
          draggable={canDrag}
          onDragStart={(e) => { e.dataTransfer.setData(DRAG, i.id); e.dataTransfer.effectAllowed = "move"; }}
          {...(i.folder ? dropProps(i.id) : {})}
          className={cn("group flex items-center gap-1.5 rounded-md text-sm pr-1 cursor-pointer select-none",
            active ? "bg-primary/10 text-foreground font-semibold" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            dropTarget === i.id && "ring-1 ring-primary bg-primary/10")}
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => {
            if (renaming?.id === i.id) return;
            if (i.folder) { setOpen((s) => { const n = new Set(s); n.has(i.id) ? n.delete(i.id) : n.add(i.id); return n; }); onFolder(folderId === i.id ? null : i.id); }
            else onPick(i.id);
          }}>
          {i.folder
            ? <>{isOpen ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}{isOpen ? <FolderOpen className="w-4 h-4 shrink-0 text-amber-500" /> : <Folder className="w-4 h-4 shrink-0 text-amber-500" />}</>
            : <><span className="w-3.5 shrink-0" /><Box className="w-4 h-4 shrink-0 text-primary" /></>}
          {renaming?.id === i.id ? (
            <span className="flex items-center gap-0.5 flex-1 min-w-0 py-0.5" onClick={(e) => e.stopPropagation()}>
              <Input value={renaming.name} autoFocus onChange={(e) => setRenaming({ id: i.id, name: e.target.value })} className="h-6 text-xs px-1.5" aria-label={t("Folder name")}
                onKeyDown={(e) => { if (e.key === "Enter" && renaming.name.trim()) { hierarchy?.rename(i.id, renaming.name.trim()); setRenaming(null); } if (e.key === "Escape") setRenaming(null); }} />
              <button className="p-0.5 hover:text-foreground" aria-label={t("Save name")} onClick={() => { if (renaming.name.trim()) hierarchy?.rename(i.id, renaming.name.trim()); setRenaming(null); }}><Check className="w-3.5 h-3.5" /></button>
              <button className="p-0.5 hover:text-foreground" aria-label={t("Cancel")} onClick={() => setRenaming(null)}><X className="w-3.5 h-3.5" /></button>
            </span>
          ) : (
            <span className="flex-1 min-w-0 py-1.5">
              <span className="block truncate">{i.name}</span>
              {i.sub && <span className="block text-[11px] font-normal text-muted-foreground truncate">{i.sub}</span>}
            </span>
          )}
          {i.viewOnly && !i.folder && <Eye className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-label={t("View only")} />}
          {i.folder && hierarchy?.canEdit && renaming?.id !== i.id && (
            <span className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              <button className="p-0.5 rounded hover:bg-background" title={t("New folder inside")} aria-label={t("New folder inside")} onClick={() => { hierarchy.create(i.id); setOpen((s) => new Set(s).add(i.id)); }}><FolderPlus className="w-3.5 h-3.5" /></button>
              <button className="p-0.5 rounded hover:bg-background" title={t("Rename")} aria-label={t("Rename")} onClick={() => setRenaming({ id: i.id, name: i.name })}><Pencil className="w-3.5 h-3.5" /></button>
              {hierarchy.canDelete !== false && <button className="p-0.5 rounded hover:bg-background text-red-500" title={t("Delete folder")} aria-label={t("Delete folder")} onClick={() => setConfirmDel(i)}><Trash2 className="w-3.5 h-3.5" /></button>}
            </span>
          )}
        </div>
        {i.folder && isOpen && (kids.length
          ? kids.map((k) => row(k, depth + 1))
          : !visible && <p className="text-[11px] text-muted-foreground py-1" style={{ paddingLeft: 26 + depth * 14 }}>{t("Empty. Drag twins here.")}</p>)}
      </div>
    );
  };

  const top = byParent.get(null) ?? [];
  const twinCount = items.filter((i) => !i.folder).length;
  return (
    <aside className="w-64 shrink-0 border border-border rounded-lg bg-card flex flex-col min-h-0" aria-label={title}>
      <div className="border-b border-border shrink-0">
        <div className="flex items-center gap-1 px-3 pt-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex-1 truncate">{title}</span>
          {hierarchy?.canEdit && (
            <button onClick={() => hierarchy.create(null)} className="p-1 rounded hover:bg-muted text-muted-foreground" aria-label={t("New folder")} title={t("New folder")}>
              <FolderPlus className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => onCollapse(true)} className="p-1 rounded hover:bg-muted text-muted-foreground" aria-label={t("Hide twin list")} title={t("Hide twin list")}>
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
        <div className="px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search twins…")} aria-label={t("Search twins")} className="pl-7 h-7 text-xs" />
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5" {...dropProps(null)}>
        {loading && <p className="px-2 py-3 text-xs text-muted-foreground">{t("Loading…")}</p>}
        {!loading && twinCount === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t("No saved twins yet. Build one on the right and click Save; it appears here.")}</p>
        )}
        {!loading && q && visible?.size === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">{t("No twin matches \"{q}\".", { q: search })}</p>}
        {top.map((i) => row(i, 0))}
        {canDrag && items.some((i) => i.folder) && (
          <div className={cn("mt-2 mx-1 px-2 py-1.5 rounded border border-dashed text-[11px] text-muted-foreground", dropTarget === "__root" ? "border-primary text-foreground" : "border-border")}>
            {folderId ? <>{t("New twins are saved into the selected folder.")} <button className="underline" onClick={() => onFolder(null)}>{t("Use top level")}</button></> : t("Drop here to move to the top level.")}
          </div>
        )}
      </div>

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => { if (!o) setConfirmDel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete folder \"{name}\"?", { name: confirmDel?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("Only the folder is removed. The twins and folders inside it move up one level.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => { if (confirmDel) hierarchy?.remove(confirmDel.id); if (folderId === confirmDel?.id) onFolder(null); setConfirmDel(null); }}>{t("Delete folder")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
