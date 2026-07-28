import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAssets, getListAssetsQueryKey, getListAssetTemplatesQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Boxes } from "lucide-react";
import { apiFetch } from "@/lib/auth-api";

// Single-step asset creation: name it and go. A new asset is always created
// device-less (identifier = null); bind a Device ID afterwards by editing the
// asset, which is where the seen-device validation lives. When opened from a
// row's "+" the parent's template is inherited automatically, so its attributes
// are materialised without asking the user to pick one.
export default function CreateAssetWizard({
  open, onOpenChange, onCreated, initialParentId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (assetId: string) => void;
  initialParentId?: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: assets } = useListAssets();
  const assetList = (assets as any[] | undefined) ?? [];

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
    qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
  }, [open]); // eslint-disable-line

  const parentId = initialParentId ?? "";
  const parent = assetList.find((a) => a.id === parentId);
  const isChild = !!parentId;
  // Children inherit the parent's template (no extra step); roots get none and
  // can be given one later via Assign Template.
  const inheritedTemplateId = isChild ? (parent?.templateId ?? "") : "";

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          identifier: "",
          templateId: inheritedTemplateId || null,
          templateName: parent?.templateName ?? null,
          parentId: parentId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Cannot create asset", description: data.error ?? "Failed to create asset", variant: "destructive" });
        return;
      }
      // Materialise the inherited template's attributes onto the new asset.
      if (inheritedTemplateId) {
        try {
          await apiFetch(`/api/assets/${data.id}/apply-template`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templateId: inheritedTemplateId }),
          });
        } catch { /* non-fatal */ }
      }
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      toast({ title: "Asset created", description: `${trimmed} created` });
      onOpenChange(false);
      onCreated?.(data.id);
    } catch (err: any) {
      toast({ title: "Cannot create asset", description: err?.message ?? "Network error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Boxes className="w-4 h-4 text-primary" /> Create Asset</DialogTitle>
          <DialogDescription>
            {isChild
              ? <>Adding a child under <strong>{parent?.name ?? "the selected asset"}</strong>{parent?.templateName ? <> · template {parent.templateName}</> : null}.</>
              : "Name the asset to create it at the top level. Add child assets beneath it afterwards."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-1">
          <Label className="text-sm">{isChild ? "Child Asset Name" : "Asset Name"} <span className="text-destructive">*</span></Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Motor-101, Chiller A"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button type="button" onClick={handleCreate} disabled={submitting || !name.trim()}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
