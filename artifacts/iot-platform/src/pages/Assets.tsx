import { useState } from "react";
import {
  useListAssets,
  useListAssetAttributes,
  useCreateAsset,
  useDeleteAsset,
  getListAssetsQueryKey,
  getListAssetAttributesQueryKey,
  useCreateAssetAttribute,
  useDeleteAttribute,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { ChevronRight, ChevronDown, Blocks, Plus, Trash2, Edit2, Search, Download, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface Asset {
  id: string;
  name: string;
  identifier: string;
  parentId?: string | null;
  templateName?: string | null;
  childCount: number;
  attributeCount: number;
  updatedAt: string;
}

function AssetTreeNode({ asset, allAssets, selectedId, onSelect, depth }: {
  asset: Asset; allAssets: Asset[]; selectedId: string | null; onSelect: (a: Asset) => void; depth: number;
}) {
  const children = allAssets.filter((a) => a.parentId === asset.id);
  const [expanded, setExpanded] = useState(depth < 2);
  return (
    <div>
      <div
        className={cn("flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-sm transition-colors", selectedId === asset.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60")}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => onSelect(asset)}
        data-testid={`asset-tree-node-${asset.id}`}
      >
        {children.length > 0 ? (
          <button onClick={(e) => { e.stopPropagation(); setExpanded((o) => !o); }} className="shrink-0">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : <span className="w-3.5" />}
        <Blocks className="w-3.5 h-3.5 shrink-0 text-primary/70" />
        <span className="truncate">{asset.name}</span>
      </div>
      {expanded && children.map((child) => (
        <AssetTreeNode key={child.id} asset={child} allAssets={allAssets} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
}

function AttributeType({ type }: { type: string }) {
  const colors: Record<string, string> = { static: "bg-blue-100 text-blue-700", dynamic: "bg-green-100 text-green-700", metric: "bg-purple-100 text-purple-700" };
  return <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium", colors[type] ?? "bg-muted text-muted-foreground")}>{type}</span>;
}

export default function Assets() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [addAssetOpen, setAddAssetOpen] = useState(false);
  const [addAttrOpen, setAddAttrOpen] = useState(false);

  const { data: assets } = useListAssets();
  const { data: attributes } = useListAssetAttributes(selectedAsset?.id ?? "", {
    query: { enabled: !!selectedAsset?.id, queryKey: getListAssetAttributesQueryKey(selectedAsset?.id ?? "") },
  });

  const createAsset = useCreateAsset();
  const deleteAsset = useDeleteAsset();
  const createAttr = useCreateAssetAttribute();
  const deleteAttr = useDeleteAttribute();

  const assetForm = useForm({ defaultValues: { name: "", identifier: "", parentId: "" } });
  const attrForm = useForm({ defaultValues: { name: "", type: "static", dataType: "text", value: "", tagName: "", uom: "" } });

  const allAssets = (assets as Asset[] | undefined) ?? [];
  const rootAssets = allAssets.filter((a) => !a.parentId);
  const filteredSearch = search ? allAssets.filter((a) => a.name.toLowerCase().includes(search.toLowerCase())) : [];

  function onAddAsset(data: { name: string; identifier: string; parentId?: string }) {
    createAsset.mutate(
      { data: { name: data.name, identifier: data.identifier, parentId: data.parentId || null } },
      {
        onSuccess: () => {
          toast({ title: "Asset created" });
          qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
          setAddAssetOpen(false);
          assetForm.reset();
        },
      }
    );
  }

  function onAddAttr(data: { name: string; type: string; dataType: string; value?: string; tagName?: string; uom?: string }) {
    if (!selectedAsset) return;
    createAttr.mutate(
      { id: selectedAsset.id, data: { name: data.name, type: data.type as any, dataType: data.dataType as any, value: data.value || null, tagName: data.tagName || null, uom: data.uom || null } },
      {
        onSuccess: () => {
          toast({ title: "Attribute added" });
          qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset.id) });
          setAddAttrOpen(false);
          attrForm.reset();
        },
      }
    );
  }

  const attrList = (attributes as any[] | undefined) ?? [];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Tree panel */}
      <div className="w-64 border-r border-border flex flex-col shrink-0 bg-card">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Search assets..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-xs" data-testid="asset-search" />
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-1.5 space-y-0.5">
            {!assets ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-7 w-full rounded" />)
            ) : search ? (
              filteredSearch.map((a) => (
                <div key={a.id} onClick={() => setSelectedAsset(a)} className={cn("flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-sm transition-colors", selectedAsset?.id === a.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60")}>
                  <Blocks className="w-3.5 h-3.5 text-primary/70" />
                  <span className="truncate">{a.name}</span>
                </div>
              ))
            ) : (
              rootAssets.map((a) => (
                <AssetTreeNode key={a.id} asset={a} allAssets={allAssets} selectedId={selectedAsset?.id ?? null} onSelect={setSelectedAsset} depth={0} />
              ))
            )}
          </div>
        </ScrollArea>
        <div className="p-2 border-t border-border">
          <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => setAddAssetOpen(true)} data-testid="add-asset-btn">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Asset
          </Button>
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedAsset ? (
          <>
            <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-sm">{selectedAsset.name}</h2>
                <p className="text-xs text-muted-foreground font-mono">{selectedAsset.identifier}</p>
              </div>
              <div className="flex items-center gap-2">
                {selectedAsset.templateName && <Badge variant="secondary" className="text-xs">{selectedAsset.templateName}</Badge>}
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 text-xs"
                  onClick={() => deleteAsset.mutate({ id: selectedAsset.id }, { onSuccess: () => { toast({ title: "Asset deleted" }); qc.invalidateQueries({ queryKey: getListAssetsQueryKey() }); setSelectedAsset(null); } })}
                  data-testid="delete-asset-btn"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <Tabs defaultValue="attributes" className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 pt-2 border-b border-border bg-card">
                <TabsList className="h-8">
                  <TabsTrigger value="attributes" className="text-xs h-7">Attribute</TabsTrigger>
                  <TabsTrigger value="table" className="text-xs h-7">Table</TabsTrigger>
                  <TabsTrigger value="media" className="text-xs h-7">Media</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="attributes" className="flex-1 overflow-auto m-0">
                <div className="p-3 flex items-center gap-2 border-b border-border bg-muted/30">
                  <Button size="sm" className="h-7 text-xs" onClick={() => setAddAttrOpen(true)} data-testid="add-attr-btn"><Plus className="w-3.5 h-3.5 mr-1" /> Add</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs"><Upload className="w-3.5 h-3.5 mr-1" /> Export</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs"><Download className="w-3.5 h-3.5 mr-1" /> Import</Button>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 sticky top-0 z-10">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-8"></th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Value</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Tag Name</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">UoM</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Quality</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Timestamp</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {!attributes ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50"><td colSpan={9} className="px-3 py-2"><Skeleton className="h-3 w-full" /></td></tr>
                      ))
                    ) : attrList.length === 0 ? (
                      <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">No attributes</td></tr>
                    ) : (
                      attrList.map((attr: any) => (
                        <tr key={attr.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors" data-testid={`attr-row-${attr.id}`}>
                          <td className="px-3 py-2"><button className="text-muted-foreground hover:text-primary"><Edit2 className="w-3 h-3" /></button></td>
                          <td className="px-3 py-2"><AttributeType type={attr.type} /></td>
                          <td className="px-3 py-2 font-medium">{attr.name}</td>
                          <td className="px-3 py-2 font-mono">{attr.value != null ? String(typeof attr.value === "object" ? JSON.stringify(attr.value) : attr.value) : "-"}</td>
                          <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{attr.tagName ?? "-"}</td>
                          <td className="px-3 py-2">{attr.uom ?? "-"}</td>
                          <td className="px-3 py-2">
                            {attr.quality ? <span className={cn("text-xs", attr.quality === "good" ? "text-green-600" : "text-yellow-600")}>{attr.quality}</span> : "-"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{attr.timestamp ? format(new Date(attr.timestamp), "MM/dd HH:mm:ss") : "-"}</td>
                          <td className="px-3 py-2">
                            <button className="text-muted-foreground hover:text-destructive transition-colors"
                              onClick={() => deleteAttr.mutate({ id: attr.id }, { onSuccess: () => { toast({ title: "Attribute deleted" }); qc.invalidateQueries({ queryKey: getListAssetAttributesQueryKey(selectedAsset.id) }); } })}
                              data-testid={`delete-attr-${attr.id}`}
                            ><Trash2 className="w-3 h-3" /></button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TabsContent>
              <TabsContent value="table" className="flex-1 flex items-center justify-center m-0"><p className="text-sm text-muted-foreground">Table view — coming soon</p></TabsContent>
              <TabsContent value="media" className="flex-1 flex items-center justify-center m-0"><p className="text-sm text-muted-foreground">Media view — coming soon</p></TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Blocks className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select an asset to view details</p>
            </div>
          </div>
        )}
      </div>

      {/* Add Asset Dialog */}
      <Dialog open={addAssetOpen} onOpenChange={setAddAssetOpen}>
        <DialogContent data-testid="add-asset-dialog">
          <DialogHeader><DialogTitle>Add Asset</DialogTitle></DialogHeader>
          <Form {...assetForm}>
            <form onSubmit={assetForm.handleSubmit(onAddAsset)} className="space-y-4">
              <FormField control={assetForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="Asset name" {...field} data-testid="asset-name-input" /></FormControl></FormItem>)} />
              <FormField control={assetForm.control} name="identifier" render={({ field }) => (<FormItem><FormLabel>Identifier *</FormLabel><FormControl><Input placeholder="unique_identifier" {...field} data-testid="asset-identifier-input" /></FormControl></FormItem>)} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddAssetOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createAsset.isPending} data-testid="save-asset-btn">Add</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Add Attribute Dialog */}
      <Dialog open={addAttrOpen} onOpenChange={setAddAttrOpen}>
        <DialogContent data-testid="add-attr-dialog">
          <DialogHeader><DialogTitle>Add Attribute</DialogTitle></DialogHeader>
          <Form {...attrForm}>
            <form onSubmit={attrForm.handleSubmit(onAddAttr)} className="space-y-4">
              <FormField control={attrForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name *</FormLabel><FormControl><Input placeholder="Attribute name" {...field} data-testid="attr-name-input" /></FormControl></FormItem>)} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={attrForm.control} name="type" render={({ field }) => (
                  <FormItem><FormLabel>Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger data-testid="attr-type-select"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent><SelectItem value="static">Static</SelectItem><SelectItem value="dynamic">Dynamic</SelectItem><SelectItem value="metric">Metric</SelectItem></SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={attrForm.control} name="dataType" render={({ field }) => (
                  <FormItem><FormLabel>Data Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger data-testid="attr-datatype-select"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent><SelectItem value="text">text</SelectItem><SelectItem value="number">number</SelectItem><SelectItem value="double">double</SelectItem><SelectItem value="boolean">boolean</SelectItem><SelectItem value="timestamp">timestamp</SelectItem></SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <FormField control={attrForm.control} name="value" render={({ field }) => (<FormItem><FormLabel>Value</FormLabel><FormControl><Input placeholder="Value" {...field} data-testid="attr-value-input" /></FormControl></FormItem>)} />
              <FormField control={attrForm.control} name="tagName" render={({ field }) => (<FormItem><FormLabel>Tag Name</FormLabel><FormControl><Input placeholder="device.metric_key" {...field} data-testid="attr-tagname-input" /></FormControl></FormItem>)} />
              <FormField control={attrForm.control} name="uom" render={({ field }) => (<FormItem><FormLabel>UoM</FormLabel><FormControl><Input placeholder="e.g. kWh, °C, bar" {...field} data-testid="attr-uom-input" /></FormControl></FormItem>)} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddAttrOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createAttr.isPending} data-testid="save-attr-btn">Add</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
