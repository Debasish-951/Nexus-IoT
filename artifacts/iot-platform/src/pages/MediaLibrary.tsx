import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Upload, Link2, Trash2, Copy, Image, ExternalLink, Plus, Search, X, CheckCircle2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const MEDIA_KEY = "ws-media-library-v1";

interface MediaItem {
  id: string;
  name: string;
  url: string;
  type: "upload" | "external";
  mimeType?: string;
  size?: number;
  uploadedAt: string;
}

function loadMedia(): MediaItem[] {
  try { return JSON.parse(localStorage.getItem(MEDIA_KEY) ?? "[]"); }
  catch { return []; }
}
function saveMedia(items: MediaItem[]) {
  localStorage.setItem(MEDIA_KEY, JSON.stringify(items));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function MediaLibrary() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [items, setItems]               = useState<MediaItem[]>(loadMedia);
  const [search, setSearch]             = useState("");
  const [addUrlOpen, setAddUrlOpen]     = useState(false);
  const [urlInput, setUrlInput]         = useState("");
  const [urlName, setUrlName]           = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MediaItem | null>(null);
  const [preview, setPreview]           = useState<MediaItem | null>(null);
  const [dragOver, setDragOver]         = useState(false);
  const [copiedId, setCopiedId]         = useState<string | null>(null);

  const persist = useCallback((next: MediaItem[]) => { setItems(next); saveMedia(next); }, []);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const readers: Promise<MediaItem>[] = Array.from(files).map(file =>
      new Promise<MediaItem>((resolve, reject) => {
        if (file.size > 5 * 1024 * 1024) {
          reject(new Error(`"${file.name}" exceeds 5 MB limit`));
          return;
        }
        const reader = new FileReader();
        reader.onload = e => resolve({
          id: crypto.randomUUID(),
          name: file.name,
          url: e.target?.result as string,
          type: "upload",
          mimeType: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString(),
        });
        reader.onerror = () => reject(new Error(`Failed to read "${file.name}"`));
        reader.readAsDataURL(file);
      })
    );
    Promise.allSettled(readers).then(results => {
      const succeeded: MediaItem[] = [];
      results.forEach(r => {
        if (r.status === "fulfilled") succeeded.push(r.value);
        else toast({ title: "Upload failed", description: (r as any).reason?.message, variant: "destructive" });
      });
      if (succeeded.length > 0) {
        const next = [...loadMedia(), ...succeeded];
        persist(next);
        toast({ title: `${succeeded.length} image${succeeded.length > 1 ? "s" : ""} uploaded` });
      }
    });
  }

  function addByUrl() {
    const url = urlInput.trim();
    if (!url) return;
    const name = urlName.trim() || url.split("/").pop() || "external-image";
    const item: MediaItem = {
      id: crypto.randomUUID(),
      name,
      url,
      type: "external",
      uploadedAt: new Date().toISOString(),
    };
    const next = [...loadMedia(), item];
    persist(next);
    setUrlInput(""); setUrlName(""); setAddUrlOpen(false);
    toast({ title: "Image added" });
  }

  function copyUrl(item: MediaItem) {
    navigator.clipboard.writeText(item.url).then(() => {
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1800);
      toast({ title: "URL copied to clipboard" });
    });
  }

  function deleteItem(item: MediaItem) {
    const next = items.filter(i => i.id !== item.id);
    persist(next);
    setDeleteTarget(null);
    toast({ title: `"${item.name}" deleted` });
  }

  const filtered = items.filter(i =>
    !search || i.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-5">
      <button onClick={() => navigate("/asset-management")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Image className="w-5 h-5 text-primary" /> Media Library
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Upload and manage images for use in dashboards and widgets. Stored locally in your browser.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAddUrlOpen(true)}>
            <Link2 className="w-3.5 h-3.5 mr-1.5" /> Add by URL
          </Button>
          <Button size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-3.5 h-3.5 mr-1.5" /> Upload Images
          </Button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} />
        </div>
      </div>

      {/* Stats bar */}
      {items.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{items.length} image{items.length !== 1 ? "s" : ""}</span>
          <span>·</span>
          <span>{items.filter(i => i.type === "upload").length} uploaded</span>
          <span>·</span>
          <span>{items.filter(i => i.type === "external").length} external</span>
          {items.some(i => i.size) && (
            <>
              <span>·</span>
              <span>{formatBytes(items.reduce((s, i) => s + (i.size ?? 0), 0))} stored</span>
            </>
          )}
        </div>
      )}

      {/* Search */}
      {items.length > 0 && (
        <div className="relative max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input className="pl-8 h-8 text-xs" placeholder="Search images…" value={search}
            onChange={e => setSearch(e.target.value)} />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:text-foreground text-muted-foreground">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Drop zone / empty state */}
      {items.length === 0 ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          className={cn(
            "flex flex-col items-center justify-center border-2 border-dashed rounded-xl py-20 transition-colors cursor-pointer",
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          )}
          onClick={() => fileInputRef.current?.click()}>
          <Image className="w-10 h-10 mb-4 text-muted-foreground opacity-40" />
          <p className="text-sm font-medium text-muted-foreground">Drop images here or click to upload</p>
          <p className="text-xs text-muted-foreground mt-1">PNG, JPG, GIF, SVG, WebP · Max 5 MB each</p>
          <Button variant="outline" size="sm" className="mt-4">
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Choose Files
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">
          No images match "{search}"
        </div>
      ) : (
        <>
          {/* Drop zone overlay when drag */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            className={cn(
              "fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm transition-all pointer-events-none",
              dragOver ? "opacity-100 pointer-events-auto" : "opacity-0"
            )}>
            <div className="flex flex-col items-center gap-3 p-10 rounded-2xl border-2 border-dashed border-primary bg-primary/5">
              <Upload className="w-10 h-10 text-primary" />
              <p className="text-sm font-semibold text-primary">Drop to upload</p>
            </div>
          </div>

          {/* Image grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {/* Upload more card */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="aspect-square rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors group">
              <Plus className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
              <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">Upload</span>
            </div>

            {filtered.map(item => (
              <div key={item.id}
                className="group relative rounded-lg border border-border bg-card overflow-hidden shadow-sm hover:border-primary/40 hover:shadow-md transition-all cursor-pointer"
                onClick={() => setPreview(item)}>
                {/* Thumbnail */}
                <div className="aspect-square bg-muted/30 flex items-center justify-center overflow-hidden">
                  <img
                    src={item.url}
                    alt={item.name}
                    className="w-full h-full object-contain"
                    onError={e => { (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='1.5'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='8.5' cy='8.5' r='1.5'/%3E%3Cpath d='M21 15l-5-5L5 21'/%3E%3C/svg%3E"; }}
                  />
                </div>

                {/* Info */}
                <div className="p-2">
                  <p className="text-xs font-medium truncate" title={item.name}>{item.name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Badge variant="outline" className="text-[9px] h-4 px-1">
                      {item.type === "upload" ? "upload" : "url"}
                    </Badge>
                    {item.size && <span className="text-[9px] text-muted-foreground">{formatBytes(item.size)}</span>}
                  </div>
                </div>

                {/* Hover actions */}
                <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => copyUrl(item)}
                    className="w-6 h-6 rounded flex items-center justify-center bg-background/90 hover:bg-background border border-border shadow-sm"
                    title="Copy URL">
                    {copiedId === item.id
                      ? <CheckCircle2 className="w-3 h-3 text-green-500" />
                      : <Copy className="w-3 h-3 text-muted-foreground" />}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(item)}
                    className="w-6 h-6 rounded flex items-center justify-center bg-background/90 hover:bg-red-500/20 border border-border shadow-sm"
                    title="Delete">
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </button>
                </div>

                {/* External badge */}
                {item.type === "external" && (
                  <div className="absolute top-1.5 left-1.5">
                    <div className="w-5 h-5 rounded bg-background/90 border border-border flex items-center justify-center">
                      <ExternalLink className="w-2.5 h-2.5 text-muted-foreground" />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Add by URL dialog */}
      <Dialog open={addUrlOpen} onOpenChange={setAddUrlOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Image by URL</DialogTitle>
            <DialogDescription>Paste a public image URL to add it to your media library.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">Image URL *</Label>
              <Input className="h-8 text-xs font-mono" value={urlInput} onChange={e => setUrlInput(e.target.value)}
                placeholder="https://example.com/image.png" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Display Name (optional)</Label>
              <Input className="h-8 text-xs" value={urlName} onChange={e => setUrlName(e.target.value)}
                placeholder="Auto-filled from URL" />
            </div>
            {urlInput && (
              <div className="rounded border border-border p-2 flex items-center justify-center h-24 bg-muted/30">
                <img src={urlInput} alt="preview" className="max-h-full max-w-full object-contain"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddUrlOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={addByUrl} disabled={!urlInput.trim()}>Add Image</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={!!preview} onOpenChange={o => { if (!o) setPreview(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Image className="w-4 h-4 text-primary" />
              {preview?.name}
            </DialogTitle>
            <DialogDescription>
              {preview?.type === "upload" ? "Uploaded image" : "External URL"} · {preview?.uploadedAt ? formatDate(preview.uploadedAt) : ""}
              {preview?.size ? ` · ${formatBytes(preview.size)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-muted/20 p-3 flex items-center justify-center min-h-[200px] max-h-[60vh]">
            <img src={preview?.url} alt={preview?.name} className="max-w-full max-h-full object-contain rounded" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">URL</Label>
            <div className="flex items-center gap-2">
              <Input readOnly value={preview?.url ?? ""} className="h-8 text-xs font-mono flex-1 bg-muted/40" />
              <Button size="sm" variant="outline" onClick={() => preview && copyUrl(preview)}>
                {copiedId === preview?.id ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="destructive" size="sm" onClick={() => { if (preview) { setDeleteTarget(preview); setPreview(null); } }}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
            </Button>
            <Button size="sm" onClick={() => setPreview(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Image</DialogTitle>
            <DialogDescription>
              Remove "{deleteTarget?.name}" from the media library? This cannot be undone.
              {deleteTarget?.type === "upload" && " The image data will be erased from your browser storage."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => deleteTarget && deleteItem(deleteTarget)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
