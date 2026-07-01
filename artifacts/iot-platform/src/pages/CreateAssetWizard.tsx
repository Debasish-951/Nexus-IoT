import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAssetTemplates, useListAssets, getListAssetsQueryKey, getListAssetTemplatesQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  FileText, Cpu, CheckCircle2, ArrowRight, ArrowLeft, AlertTriangle, Boxes, Search, Trash2,
} from "lucide-react";

interface SeenDevice { deviceId: string; matched: boolean }

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
  const { data: templates } = useListAssetTemplates();
  const { data: assets } = useListAssets();
  const templateList = (templates as any[] | undefined) ?? [];

  // A device is "linked" if a CURRENT asset already uses it as its identifier.
  // Derived live from assets so deleting an asset frees its device again.
  const linkedIds = useMemo(
    () => new Set(((assets as any[] | undefined) ?? []).map((a) => a.identifier)),
    [assets],
  );

  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [devices, setDevices] = useState<SeenDevice[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const assetList = (assets as any[] | undefined) ?? [];

  function reloadDevices() {
    fetch("/api/ingest/seen-devices")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setDevices(Array.isArray(d) ? d : []))
      .catch(() => setDevices([]));
  }
  async function removeDevice(did: string) {
    await fetch(`/api/ingest/seen-devices/${encodeURIComponent(did)}`, { method: "DELETE" }).catch(() => {});
    if (deviceId === did) setDeviceId("");
    reloadDevices();
  }
  async function pruneDevices() {
    const res = await fetch("/api/ingest/seen-devices/prune", { method: "POST" }).catch(() => null);
    const data = res && res.ok ? await res.json() : { removed: 0 };
    toast({ title: `Removed ${data.removed ?? 0} unused device id(s)` });
    setDeviceId("");
    reloadDevices();
  }

  // Reset on open; refresh templates + load transmitting devices.
  useEffect(() => {
    if (!open) return;
    setStep(0); setTemplateId(""); setTemplateSearch(""); setName(""); setParentId(initialParentId ?? ""); setDeviceId(""); setDeviceSearch("");
    qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
    qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
    reloadDevices();
  }, [open]); // eslint-disable-line

  const parent = assetList.find((a) => a.id === parentId);
  // childMode = opened via the "+" on a row → parent is fixed, template inherited,
  // no Template/Device steps; the user only types the child name.
  const childMode = !!initialParentId;
  // isChild = any time a parent is set (childMode, or parent picked in Details).
  const isChild = !!parentId;
  const effectiveTemplateId = childMode ? (parent?.templateId ?? "") : templateId;
  const template = templateList.find((t) => t.id === effectiveTemplateId);
  const childIdentifier = parent ? `${parent.identifier}.${name.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_.-]/g, "")}` : "";
  const finalIdentifier = isChild ? childIdentifier : deviceId.trim();

  // Steps: child via "+" = Details→Review; child via dropdown = skip Device; root = full.
  const steps = useMemo(() => (
    childMode ? ["Details", "Review"]
      : isChild ? ["Template", "Details", "Review"]
        : ["Template", "Details", "Device", "Review"]
  ), [childMode, isChild]);
  const current = steps[Math.min(step, steps.length - 1)];
  useEffect(() => { if (step > steps.length - 1) setStep(steps.length - 1); }, [steps.length, step]);

  // Hierarchical, indented options for the Parent dropdown.
  const treeOptions = useMemo(() => {
    const out: { id: string; name: string; depth: number }[] = [];
    const walk = (pid: string | null, depth: number) => {
      assetList
        .filter((a) => (a.parentId ?? null) === pid)
        .sort((x, y) => x.name.localeCompare(y.name))
        .forEach((a) => { out.push({ id: a.id, name: a.name, depth }); walk(a.id, depth + 1); });
    };
    walk(null, 0);
    return out;
  }, [assets]); // eslint-disable-line

  const filteredDevices = useMemo(() => {
    const q = deviceSearch.trim().toLowerCase();
    return q ? devices.filter((d) => d.deviceId.toLowerCase().includes(q)) : devices;
  }, [devices, deviceSearch]);
  const canNext =
    current === "Template" ? !!templateId :
    current === "Details" ? name.trim().length > 0 :
    current === "Device" ? deviceId.trim().length > 0 && !linkedIds.has(deviceId.trim()) :
    true;

  async function handleCreate() {
    if (!name.trim()) return;
    if (!childMode && !templateId) return;
    if (!isChild && !deviceId) return;
    if (!finalIdentifier) return;
    const tid = effectiveTemplateId;
    setSubmitting(true);
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), identifier: finalIdentifier, templateId: tid || null, templateName: template?.name ?? null, parentId: parentId || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Cannot create asset", description: data.error ?? "Failed to create asset", variant: "destructive" });
        return;
      }
      // Bind the template (if any): materialize its attributes onto the new asset.
      if (tid) {
        try {
          await fetch(`/api/assets/${data.id}/apply-template`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templateId: tid }),
          });
        } catch { /* non-fatal */ }
      }
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      toast({ title: "Asset created", description: `${name.trim()} bound to device ${deviceId}` });
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Boxes className="w-4 h-4 text-primary" /> Create Asset</DialogTitle>
          <DialogDescription>Bind a transmitting device to a new asset using a template.</DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-1.5 mb-1">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-1.5 flex-1">
              <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0",
                i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary/15 text-primary border border-primary" : "bg-muted text-muted-foreground")}>
                {i < step ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={cn("text-xs", i === step ? "font-medium text-foreground" : "text-muted-foreground")}>{s}</span>
              {i < steps.length - 1 && <div className="flex-1 h-px bg-border" />}
            </div>
          ))}
        </div>

        <div className="min-h-[220px] py-2">
          {/* Step 1: Template */}
          {current === "Template" && (
            <div className="space-y-2">
              <Label className="text-sm">Select an asset template <span className="text-destructive">*</span></Label>
              {templateList.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No templates yet. Create one in Asset Templates first.</p>
              ) : templateId ? (
                <div className="flex items-center justify-between rounded-lg border border-primary bg-primary/5 p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="w-4 h-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{template?.name}</p>
                      <p className="text-xs text-muted-foreground">{template?.attributeCount ?? (template?.attributeDefinitions?.length ?? 0)} attributes</p>
                    </div>
                  </div>
                  <button type="button" className="text-xs text-primary hover:underline shrink-0" onClick={() => { setTemplateId(""); setTemplateSearch(""); }}>Change</button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input value={templateSearch} onChange={(e) => setTemplateSearch(e.target.value)}
                      placeholder="Search templates…" className="pl-8 h-9" autoFocus />
                  </div>
                  {templateSearch.trim() ? (
                    <div className="max-h-56 overflow-y-auto space-y-1.5">
                      {(() => {
                        const q = templateSearch.trim().toLowerCase();
                        const list = templateList.filter((t) => (t.name ?? "").toLowerCase().includes(q));
                        if (list.length === 0) return <p className="text-sm text-muted-foreground text-center py-6">No template matches “{templateSearch}”.</p>;
                        return list.map((t) => (
                          <button key={t.id} type="button" onClick={() => setTemplateId(t.id)}
                            className="w-full flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/40">
                            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{t.name}</p>
                              <p className="text-xs text-muted-foreground">{t.attributeCount ?? (t.attributeDefinitions?.length ?? 0)} attributes</p>
                            </div>
                          </button>
                        ));
                      })()}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground py-3 text-center">Start typing to find a template.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 2: Details */}
          {current === "Details" && (
            <div className="space-y-4">
              {childMode && (
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  Adding a child under <strong>{parent?.name}</strong>
                  {parent?.templateName && <span className="text-muted-foreground"> · template {parent.templateName}</span>}
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-sm">{childMode ? "Child Asset Name" : "Asset Name"} <span className="text-destructive">*</span></Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Motor-101, Chiller A" autoFocus />
              </div>
              {!childMode && (<div className="space-y-1.5">
                <Label className="text-sm">Parent Asset <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <select value={parentId} onChange={(e) => setParentId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  <option value="">None (root level)</option>
                  {treeOptions.map((o) => (
                    <option key={o.id} value={o.id}>{"  ".repeat(o.depth)}{o.depth > 0 ? "└ " : ""}{o.name}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">Place this asset under a parent to build a hierarchy, or leave as a root-level asset.</p>
              </div>)}
              {isChild ? (
                <p className="text-xs text-muted-foreground">
                  Child of <strong>{parent?.name}</strong> — it shares the parent's device. Identifier: <code className="font-mono bg-muted px-1 rounded">{childIdentifier || "…"}</code>. No separate Device ID needed.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  The asset <strong>Identifier</strong> will be the Device ID you pick next — it links incoming telemetry to this asset.
                </p>
              )}
            </div>
          )}

          {/* Step 3: Device — pick from registered device ids (telemetry or template payload) */}
          {current === "Device" && (
            <div className="space-y-2">
              <Label className="text-sm">Select Device ID <span className="text-destructive">*</span></Label>
              {devices.length === 0 ? (
                <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  No device ids registered yet. Register one by pasting its device payload into a template, or by sending telemetry for it — then it appears here.
                </div>
              ) : deviceId ? (
                <div className="flex items-center justify-between rounded-lg border border-primary bg-primary/5 p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Cpu className="w-4 h-4 text-primary shrink-0" />
                    <span className="font-mono text-sm truncate">{deviceId}</span>
                  </div>
                  <button type="button" className="text-xs text-primary hover:underline shrink-0" onClick={() => { setDeviceId(""); setDeviceSearch(""); }}>Change</button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input value={deviceSearch} onChange={(e) => setDeviceSearch(e.target.value)}
                        placeholder="Search device id…" className="pl-8 h-9" autoFocus />
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-9 text-xs shrink-0" onClick={pruneDevices}
                      title="Remove all device ids not bound to an existing asset">
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear unused
                    </Button>
                  </div>
                  {deviceSearch.trim() ? (
                    <div className="max-h-52 overflow-y-auto space-y-1.5">
                      {filteredDevices.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">No device id matches “{deviceSearch}”.</p>
                      ) : filteredDevices.map((d) => {
                        const linked = linkedIds.has(d.deviceId);
                        return (
                          <div key={d.deviceId}
                            className={cn("w-full flex items-center gap-2 rounded-lg border p-2.5 transition-colors",
                              linked ? "opacity-60 border-border" : "border-border hover:bg-muted/40")}>
                            <button type="button" disabled={linked} onClick={() => setDeviceId(d.deviceId)}
                              className={cn("flex-1 flex items-center gap-3 text-left min-w-0", linked && "cursor-not-allowed")}>
                              <Cpu className="w-4 h-4 text-muted-foreground shrink-0" />
                              <span className="flex-1 font-mono text-sm truncate">{d.deviceId}</span>
                              {linked ? <span className="text-[10px] text-muted-foreground">already linked</span> : null}
                            </button>
                            {!linked && (
                              <button type="button" title="Remove this device id" onClick={() => removeDevice(d.deviceId)}
                                className="text-muted-foreground hover:text-destructive shrink-0">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground py-3 text-center">Start typing to find a device id.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 4: Review */}
          {current === "Review" && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Confirm binding</p>
              <div className="rounded-lg border border-border divide-y divide-border text-sm">
                {!isChild && <Row label="Device ID" value={deviceId} mono />}
                <Row label="Asset Name" value={name.trim()} />
                {parentId && <Row label="Parent Asset" value={parent?.name ?? parentId} />}
                <Row label="Identifier" value={finalIdentifier} mono />
                <Row label="Template" value={template?.name ?? "—"} />
              </div>
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-1">
                <span className="font-mono">{finalIdentifier}</span><ArrowRight className="w-3 h-3" />
                <span>{name.trim() || "Asset"}</span><ArrowRight className="w-3 h-3" />
                <span>{template?.name ?? "Template"}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button type="button" variant="ghost" disabled={step === 0 || submitting}
            onClick={() => setStep((s) => Math.max(0, s - 1))}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          {current !== "Review" ? (
            <Button type="button" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              Next <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button type="button" disabled={submitting} onClick={handleCreate}>
              {submitting ? "Creating…" : "Create Asset"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", mono && "font-mono")}>{value}</span>
    </div>
  );
}
