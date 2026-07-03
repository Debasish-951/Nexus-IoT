import { useMemo, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListAssetTemplatesQueryKey, getListAssetsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/UserContext";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Workflow, Sparkles, Plus, Trash2, ChevronRight, ChevronDown,
  AlertTriangle, CheckCircle2, Cpu, Activity, Layers, Loader2, Merge,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Telemetry tag vocabulary — leaf nodes matching these become attributes,
// not their own template (attached to the nearest ancestor machine/device). ──
const TELEMETRY_WORDS = [
  "temperature", "temp", "pressure", "vibration", "power", "rpm", "current",
  "voltage", "humidity", "flow", "speed", "torque", "level", "ph", "energy",
  "efficiency", "load", "frequency", "amps", "kwh", "kw",
];
const DEVICE_WORDS = ["plc", "gateway", "edge", "opc", "modbus", "mqtt", "sensor", "device"];

const UOM_GUESS: Record<string, string> = {
  temperature: "°C", temp: "°C", pressure: "bar", vibration: "mm/s", power: "kW",
  rpm: "rpm", current: "A", amps: "A", voltage: "V", humidity: "%", flow: "m³/h",
  speed: "m/min", torque: "Nm", frequency: "Hz", energy: "kWh", kwh: "kWh", kw: "kW",
};

let nid = 1;
interface HNode { id: string; name: string; children: HNode[]; attr?: boolean; dataType?: string; uom?: string }
function node(name: string, children: HNode[] = []): HNode { return { id: `n${nid++}`, name: name.trim(), children }; }
// Attribute leaf (a telemetry/data field on a machine/device — never a template).
function attrNode(name: string, dataType: string, uom: string): HNode {
  return { id: `n${nid++}`, name: name.trim(), children: [], attr: true, dataType, uom };
}
const ENVELOPE = new Set(["deviceid", "device_id", "timestamp", "timestampunix", "capturedat", "captured_at", "receivedat", "id", "version", "source"]);
function guessUom(name: string): string {
  const l = name.toLowerCase();
  return Object.entries(UOM_GUESS).find(([w]) => l.includes(w))?.[1] ?? "";
}

const kindOf = (name: string): "telemetry" | "device" | "asset" => {
  const l = name.toLowerCase();
  if (TELEMETRY_WORDS.some((w) => l === w || l.includes(w))) return "telemetry";
  if (DEVICE_WORDS.some((w) => l.includes(w))) return "device";
  return "asset";
};

const EXAMPLE = `Factory Alpha
  Unit 1
    Synthetic Dyeing
      Preparation
        Creel Machine
          PLC
            Telemetry Tags
              Temperature
              Pressure
              RPM
  Unit 2
    Synthetic Dyeing
      Preparation
        Creel Machine`;

// ─────────────────────────── Parsers ───────────────────────────
function detectFormat(t: string): "json" | "csv" | "text" {
  const s = t.trim();
  if (s.startsWith("{") || s.startsWith("[")) return "json";
  const first = s.split(/\r?\n/)[0] ?? "";
  if (first.includes(",") && /(^|,)\s*(name|parent|path|level)\s*(,|$)/i.test(first)) return "csv";
  return "text";
}

// Plain-text indented tree (also handles ├──/└──/│ glyphs and → / -> paths).
function parseText(t: string): HNode[] {
  const lines = t.split(/\r?\n/).filter((l) => l.trim().length > 0);
  // Arrow-path mode: each line is a full path "A → B → C".
  if (lines.every((l) => /→|->/.test(l))) {
    const roots: HNode[] = [];
    for (const line of lines) {
      const parts = line.split(/→|->/).map((p) => p.trim()).filter(Boolean);
      let level = roots;
      for (const name of parts) {
        let found = level.find((n) => n.name.toLowerCase() === name.toLowerCase());
        if (!found) { found = node(name); level.push(found); }
        level = found.children;
      }
    }
    return roots;
  }
  // Indent mode.
  const roots: HNode[] = [];
  const stack: { indent: number; node: HNode }[] = [];
  for (const raw of lines) {
    const cleaned = raw.replace(/[│├└]/g, " ").replace(/─/g, " ");
    const indent = (cleaned.match(/^\s*/)?.[0].replace(/\t/g, "    ").length) ?? 0;
    const name = cleaned.trim();
    if (!name) continue;
    const n = node(name);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length === 0) roots.push(n);
    else stack[stack.length - 1].node.children.push(n);
    stack.push({ indent, node: n });
  }
  return roots;
}

function parseJson(t: string): HNode[] {
  const raw = JSON.parse(t);

  // A leaf "machine/reading" object: its `machine`/`name` is the node name and
  // every scalar field becomes an ATTRIBUTE (temperature, status, batchId, …).
  function machineNode(item: any): HNode {
    if (item == null || typeof item !== "object") return node(String(item));
    const name = (typeof item.machine === "string" && item.machine) || (typeof item.name === "string" && item.name) || "Machine";
    const attrs: HNode[] = [];
    for (const [k, v] of Object.entries(item)) {
      const lk = k.toLowerCase();
      if (lk === "machine" || lk === "name" || ENVELOPE.has(lk)) continue;
      if (v != null && typeof v === "object") continue; // ignore nested objects/arrays inside a reading
      const dt = typeof v === "number" ? (Number.isInteger(v) ? "number" : "double") : typeof v === "boolean" ? "boolean" : "text";
      attrs.push(attrNode(k, dt, guessUom(k)));
    }
    return node(name, attrs);
  }

  // Recursively turn a value under `key` into hierarchy nodes.
  function valueToNodes(key: string, v: any): HNode[] {
    if (v == null) return [node(key)];
    if (Array.isArray(v)) {
      // key is a level (e.g. "Preparation") holding one or more machine readings.
      const items = v.map((x) => (x && typeof x === "object" && !Array.isArray(x)) ? machineNode(x) : node(String(x)));
      return [node(key, items)];
    }
    if (typeof v === "object") {
      // {name, children} explicit form
      if (typeof v.name === "string") return [node(v.name, keyToNodes(v.children ?? {}))];
      return [node(key, keyToNodes(v))];
    }
    // scalar under a key → attribute leaf
    return [attrNode(key, typeof v === "number" ? "double" : "text", guessUom(key))];
  }
  function keyToNodes(obj: any): HNode[] {
    if (Array.isArray(obj)) return obj.flatMap((x) => (typeof x === "string" ? [node(x)] : (x && typeof x === "object" && (x.machine || x.name && !x.children)) ? [machineNode(x)] : keyToNodes(x)));
    const out: HNode[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (ENVELOPE.has(k.toLowerCase())) continue;
      out.push(...valueToNodes(k, v));
    }
    return out;
  }

  if (Array.isArray(raw)) return raw.flatMap((r) => (typeof r === "string" ? [node(r)] : r?.name ? [node(r.name, keyToNodes(r.children ?? {}))] : keyToNodes(r)));
  if (raw?.name && raw?.children) return [node(raw.name, keyToNodes(raw.children))];
  return keyToNodes(raw);
}

// CSV: supports a `path` column (split by / or >) OR name+parent columns.
function parseCsv(t: string): HNode[] {
  const lines = t.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
  const pathIdx = headers.findIndex((h) => h === "path");
  const roots: HNode[] = [];
  if (pathIdx >= 0) {
    for (const cells of rows) {
      const parts = (cells[pathIdx] ?? "").split(/[/>]/).map((p) => p.trim()).filter(Boolean);
      let level = roots;
      for (const name of parts) {
        let f = level.find((n) => n.name.toLowerCase() === name.toLowerCase());
        if (!f) { f = node(name); level.push(f); }
        level = f.children;
      }
    }
    return roots;
  }
  const nameIdx = Math.max(0, headers.findIndex((h) => h === "name"));
  const parentIdx = headers.findIndex((h) => h === "parent");
  const byName: Record<string, HNode> = {};
  for (const cells of rows) {
    const nm = cells[nameIdx]; if (!nm) continue;
    byName[nm.toLowerCase()] = node(nm);
  }
  for (const cells of rows) {
    const nm = cells[nameIdx]; if (!nm) continue;
    const n = byName[nm.toLowerCase()];
    const parent = parentIdx >= 0 ? cells[parentIdx] : "";
    if (parent && byName[parent.toLowerCase()]) byName[parent.toLowerCase()].children.push(n);
    else roots.push(n);
  }
  return roots;
}

function parseHierarchy(t: string): HNode[] {
  const fmt = detectFormat(t);
  if (fmt === "json") return parseJson(t);
  if (fmt === "csv") return parseCsv(t);
  return parseText(t);
}

// ─────────────────────────── Tree helpers ───────────────────────────
function flatten(nodes: HNode[], depth = 0, parent: HNode | null = null): { n: HNode; depth: number; parent: HNode | null }[] {
  const out: { n: HNode; depth: number; parent: HNode | null }[] = [];
  for (const n of nodes) { out.push({ n, depth, parent }); out.push(...flatten(n.children, depth + 1, n)); }
  return out;
}
function removeNode(nodes: HNode[], id: string): HNode[] {
  return nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

// ─────────────────────────── Page ───────────────────────────
export default function HierarchyGenerator() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { can } = useCurrentUser();

  const [text, setText] = useState(EXAMPLE);
  const [tree, setTree] = useState<HNode[]>([]);
  const [analyzed, setAnalyzed] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Asset-tree generation state
  const [templates, setTemplates] = useState<any[]>([]);
  const [freeDevices, setFreeDevices] = useState<string[]>([]);
  const [rootName, setRootName] = useState("Textile Factory");
  const [rootDevice, setRootDevice] = useState("");
  const [genAssets, setGenAssets] = useState(false);
  const [genProgress, setGenProgress] = useState("");

  useEffect(() => {
    fetch(`${BASE}/api/asset-templates`).then((r) => (r.ok ? r.json() : [])).then((d) => setTemplates(Array.isArray(d) ? d : [])).catch(() => {});
    Promise.all([
      fetch(`${BASE}/api/ingest/seen-devices`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`${BASE}/api/assets`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([seen, assets]) => {
      const used = new Set((assets as any[]).map((a) => a.identifier).filter(Boolean));
      const free = (seen as any[]).map((d) => d.deviceId).filter((id: string) => !used.has(id));
      setFreeDevices(free);
      setRootDevice((cur) => cur || free[0] || "");
    }).catch(() => {});
  }, []);

  function analyze() {
    setParseError(null);
    try {
      const parsed = parseHierarchy(text);
      if (parsed.length === 0) { setParseError("No nodes found in the input."); return; }
      setTree(parsed); setAnalyzed(true); setCollapsed(new Set());
    } catch (e: any) {
      setParseError(`Could not parse input: ${e?.message ?? "invalid format"}`);
    }
  }

  const flat = useMemo(() => flatten(tree), [tree]);

  // Duplicate detection among TEMPLATES only (attribute leaves repeat by design).
  const nameCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const { n, parent } of flat) { if (isAttribute(n, parent)) continue; const k = n.name.toLowerCase(); m[k] = (m[k] ?? 0) + 1; }
    return m;
  }, [flat]);
  const duplicates = useMemo(
    () => Object.entries(nameCounts).filter(([, c]) => c > 1)
      .map(([k]) => flat.find((f) => f.n.name.toLowerCase() === k)!.n.name),
    [nameCounts, flat],
  );

  // Validation.
  const validation = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const { n } of flat) {
      if (!n.name.trim()) errors.push("An empty node name was found.");
      else if (/[^a-zA-Z0-9 ._\-/]/.test(n.name)) warnings.push(`"${n.name}" contains unusual characters.`);
    }
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  }, [flat]);

  // Unique templates to create: one per distinct node that is NOT an attribute.
  // Attribute leaves (machine fields / telemetry tags) attach to their nearest
  // template ancestor as attribute definitions.
  const templatePlan = useMemo(() => {
    const map = new Map<string, { name: string; kind: string; tags: Map<string, { dataType: string; uom: string }> }>();
    for (const { n, parent } of flat) {
      if (isAttribute(n, parent)) {
        const holder = ancestorTemplate(n, tree);
        if (holder) {
          const key = holder.name.toLowerCase();
          if (!map.has(key)) map.set(key, { name: holder.name, kind: kindOf(holder.name), tags: new Map() });
          if (!map.get(key)!.tags.has(n.name)) map.get(key)!.tags.set(n.name, { dataType: n.dataType ?? "double", uom: n.uom ?? guessUom(n.name) });
        }
        continue;
      }
      const key = n.name.toLowerCase();
      if (!map.has(key)) map.set(key, { name: n.name, kind: kindOf(n.name), tags: new Map() });
    }
    return [...map.values()];
  }, [flat, tree]);

  const reusableCount = templatePlan.length;
  const totalNodes = flat.length;

  function toggle(id: string) { setCollapsed((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; }); }
  function rename(id: string, name: string) {
    const walk = (ns: HNode[]): HNode[] => ns.map((n) => n.id === id ? { ...n, name } : { ...n, children: walk(n.children) });
    setTree((t) => walk(t));
  }
  function del(id: string) { setTree((t) => removeNode(t, id)); }
  function addChild(id: string) {
    const walk = (ns: HNode[]): HNode[] => ns.map((n) => n.id === id ? { ...n, children: [...n.children, node("New Node")] } : { ...n, children: walk(n.children) });
    setTree((t) => walk(t));
  }
  function addRoot() { setTree((t) => [...t, node("New Root")]); }

  async function generate() {
    if (!can("manage_templates")) { toast({ title: "Not allowed", description: "You need template management permission.", variant: "destructive" }); return; }
    if (validation.errors.length) { toast({ title: "Fix validation errors first", variant: "destructive" }); return; }
    setGenerating(true);
    let created = 0, failed = 0;
    try {
      for (const t of templatePlan) {
        const res = await fetch(`${BASE}/api/asset-templates`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: t.name, tags: [t.kind] }),
        }).catch(() => null);
        if (!res || !res.ok) { failed++; continue; }
        const tpl = await res.json().catch(() => null);
        created++;
        // Attach telemetry tags as attribute definitions (second call — create route
        // doesn't accept attributeDefinitions; PUT does).
        if (tpl?.id && t.tags.size) {
          const defs = [...t.tags.entries()].map(([tag, meta]) => ({
            name: tag, type: "dynamic", dataType: meta.dataType,
            tagName: tag.toLowerCase().replace(/\s+/g, "_"), uom: meta.uom,
          }));
          await fetch(`${BASE}/api/asset-templates/${tpl.id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attributeDefinitions: defs }),
          }).catch(() => {});
        }
      }
      qc.invalidateQueries({ queryKey: getListAssetTemplatesQueryKey() });
      toast({ title: `Generated ${created} template${created !== 1 ? "s" : ""}`, description: failed ? `${failed} failed (name may already exist).` : "Reused duplicates automatically." });
      if (created) navigate("/asset-templates");
    } finally { setGenerating(false); }
  }

  // Build the full nested ASSET tree from the hierarchy. A wrapper root owns the
  // device id; every other node is a child (identifier auto-null per backend).
  // Machines get their matching template applied (attributes stamped).
  async function generateAssets() {
    if (!can("manage_assets")) { toast({ title: "Not allowed", description: "You need asset management permission.", variant: "destructive" }); return; }
    if (!rootDevice) { toast({ title: "Pick a device id for the root", variant: "destructive" }); return; }
    if (validation.errors.length) { toast({ title: "Fix validation errors first", variant: "destructive" }); return; }
    setGenAssets(true);
    setGenProgress("");
    const tmplByName = new Map(templates.map((t) => [String(t.name).toLowerCase(), t]));
    let created = 0, failed = 0;

    async function makeAsset(name: string, parentId: string | null, identifier: string): Promise<string | null> {
      const t = tmplByName.get(name.toLowerCase());
      const body: any = { name, parentId, identifier };
      if (t) { body.templateId = t.id; body.templateName = t.name; }
      const res = await fetch(`${BASE}/api/assets`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).catch(() => null);
      if (!res || !res.ok) { failed++; return null; }
      const a = await res.json().catch(() => null);
      if (!a?.id) { failed++; return null; }
      created++;
      setGenProgress(`Created ${created} assets…`);
      if (t?.id) {
        await fetch(`${BASE}/api/assets/${a.id}/apply-template`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId: t.id }),
        }).catch(() => {});
      }
      return a.id;
    }

    async function walk(n: HNode, parentId: string) {
      // Attribute leaves are stamped via templates, not created as assets.
      const id = await makeAsset(n.name, parentId, ""); // children → identifier null
      if (!id) return;
      for (const c of n.children) {
        if (isAttribute(c, n)) continue;
        await walk(c, id);
      }
    }

    try {
      // Wrapper root owns the device id (must be a known, free device).
      const rootId = await makeAsset(rootName.trim() || "Site", null, rootDevice);
      if (!rootId) {
        toast({ title: "Root creation failed", description: `Device id "${rootDevice}" may already be used by another asset.`, variant: "destructive" });
        return;
      }
      for (const r of tree) {
        if (isAttribute(r, null)) continue;
        await walk(r, rootId);
      }
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      toast({ title: `Created ${created} assets`, description: failed ? `${failed} failed.` : "Full hierarchy built." });
      navigate("/assets");
    } finally { setGenAssets(false); setGenProgress(""); }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <button onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/asset-management"))} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-primary/10 text-primary"><Workflow className="w-5 h-5" /></div>
        <div>
          <h1 className="text-xl font-bold">Hierarchy → Template Generator</h1>
          <p className="text-sm text-muted-foreground">Paste any asset hierarchy — auto-generate reusable asset templates.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Input */}
        <Card className="p-4 flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold">Hierarchy input</h2>
            <span className="text-xs text-muted-foreground">Plain text · JSON · CSV · arrow paths</span>
          </div>
          <p className="text-xs text-muted-foreground mb-2">Indentation = depth. Format auto-detected.</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
            className="flex-1 min-h-[340px] w-full rounded-md border border-border bg-background p-3 font-mono text-xs resize-y focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <div className="flex items-center gap-2 mt-3">
            <Button onClick={analyze} disabled={!text.trim()}><Sparkles className="w-4 h-4 mr-1.5" /> Analyze Hierarchy</Button>
            <Button variant="outline" onClick={() => setText(EXAMPLE)}>Load example</Button>
          </div>
          {parseError && <p className="text-sm text-destructive mt-2">{parseError}</p>}
        </Card>

        {/* Preview */}
        <Card className="p-4 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">Preview &amp; validation</h2>
            {analyzed && <Button size="sm" variant="outline" onClick={addRoot}><Plus className="w-4 h-4 mr-1" /> Add root</Button>}
          </div>

          {!analyzed ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-16">
              <div className="text-center"><Layers className="w-10 h-10 mx-auto mb-2 opacity-20" />Analyze a hierarchy to preview templates.</div>
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground mb-2">{totalNodes} nodes · {reusableCount} templates to create</div>

              {/* validation + duplicates */}
              {validation.errors.map((e, i) => <Banner key={`e${i}`} tone="error" text={e} />)}
              {duplicates.length > 0 && (
                <Banner tone="info" icon={<Merge className="w-4 h-4" />}
                  text={`${duplicates.length} duplicate name${duplicates.length > 1 ? "s" : ""} (${duplicates.slice(0, 3).join(", ")}${duplicates.length > 3 ? "…" : ""}) — each becomes ONE reused template.`} />
              )}
              {validation.warnings.slice(0, 3).map((w, i) => <Banner key={`w${i}`} tone="warn" text={w} />)}
              {validation.errors.length === 0 && validation.warnings.length === 0 && (
                <Banner tone="ok" text="Hierarchy looks valid." />
              )}

              {/* tree */}
              <div className="flex-1 overflow-y-auto border border-border rounded-md p-2 mt-2 space-y-0.5 max-h-[380px]">
                {flat.filter(({ n, parent }) => {
                  // hide if any ancestor collapsed
                  let p = parent; while (p) { if (collapsed.has(p.id)) return false; p = flatten(tree).find((f) => f.n === p)?.parent ?? null; }
                  return true;
                }).map(({ n, depth, parent }) => {
                  const attr = isAttribute(n, parent);
                  const kind = kindOf(n.name);
                  const dup = !attr && nameCounts[n.name.toLowerCase()] > 1;
                  return (
                    <div key={n.id} className="flex items-center gap-1.5 group" style={{ paddingLeft: depth * 16 }}>
                      {n.children.length > 0 ? (
                        <button onClick={() => toggle(n.id)} className="p-0.5 text-muted-foreground shrink-0">
                          {collapsed.has(n.id) ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      ) : <span className="w-[18px] shrink-0" />}
                      {attr ? <Activity className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                        : kind === "device" ? <Cpu className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        : <Layers className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                      <Input value={n.name} onChange={(e) => rename(n.id, e.target.value)}
                        className="h-7 text-xs flex-1 min-w-0" />
                      {attr && <Badge variant="secondary" className="text-[9px] shrink-0">tag</Badge>}
                      {!attr && kind === "device" && <Badge variant="secondary" className="text-[9px] shrink-0">device</Badge>}
                      {dup && <Badge variant="outline" className="text-[9px] shrink-0">×{nameCounts[n.name.toLowerCase()]}</Badge>}
                      <button onClick={() => addChild(n.id)} title="Add child" className="p-0.5 text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 shrink-0"><Plus className="w-3.5 h-3.5" /></button>
                      <button onClick={() => del(n.id)} title="Delete" className="p-0.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  );
                })}
              </div>

              <Button className="mt-3" onClick={generate} disabled={generating || reusableCount === 0 || validation.errors.length > 0 || !can("manage_templates")}>
                {generating ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4 mr-1.5" /> Generate {reusableCount} template{reusableCount !== 1 ? "s" : ""}</>}
              </Button>
              {!can("manage_templates") && <p className="text-xs text-muted-foreground mt-1">Template management permission required to generate.</p>}

              {/* ── Generate the real nested asset tree ── */}
              <div className="mt-4 pt-4 border-t border-border space-y-2">
                <p className="text-sm font-semibold flex items-center gap-1.5"><Layers className="w-4 h-4 text-primary" /> Generate Asset Tree</p>
                <p className="text-xs text-muted-foreground">
                  Creates {flat.filter((f) => !isAttribute(f.n, f.parent)).length + 1} nested assets (a root + every level). Grouping levels have no device; a matching template is applied to each node where one exists (machines get their attributes).
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Root asset name</Label>
                    <Input value={rootName} onChange={(e) => setRootName(e.target.value)} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Root device id</Label>
                    <Select value={rootDevice} onValueChange={setRootDevice}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select device…" /></SelectTrigger>
                      <SelectContent className="max-h-60 overflow-y-auto">
                        {freeDevices.length === 0 ? <div className="px-2 py-1.5 text-xs text-muted-foreground">No free device ids</div>
                          : freeDevices.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button variant="outline" className="w-full" onClick={generateAssets}
                  disabled={genAssets || !rootDevice || validation.errors.length > 0 || !can("manage_assets")}>
                  {genAssets ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> {genProgress || "Building…"}</> : <><Layers className="w-4 h-4 mr-1.5" /> Generate Asset Tree</>}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  The root owns the device id (telemetry for it attaches to the root). Only free device ids are listed — if yours isn't there, it's already used by another asset.
                </p>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

// Is this node an attribute (a data field / telemetry tag) rather than a template?
function isAttribute(n: HNode, parent: HNode | null): boolean {
  if (n.attr) return true;              // marked by the JSON parser (machine field)
  if (n.children.length > 0) return false; // has children → structural template
  if (kindOf(n.name) === "telemetry") return true; // leaf that reads like a metric
  if (parent && /telemetr|tag/i.test(parent.name)) return true; // under a "Telemetry Tags" node
  return false;                         // standalone leaf (e.g. a machine) → template
}

// Nearest ancestor that is a template (not an attribute) — holds attribute leaves.
function ancestorTemplate(target: HNode, tree: HNode[]): HNode | null {
  const flat = flatten(tree);
  let cur = flat.find((f) => f.n === target)?.parent ?? null;
  while (cur) {
    const cp = flat.find((f) => f.n === cur)?.parent ?? null;
    if (!isAttribute(cur, cp)) return cur;
    cur = cp;
  }
  return null;
}

function Banner({ tone, text, icon }: { tone: "error" | "warn" | "info" | "ok"; text: string; icon?: React.ReactNode }) {
  const styles = {
    error: "bg-red-50 text-red-700 border-red-200",
    warn: "bg-amber-50 text-amber-700 border-amber-200",
    info: "bg-blue-50 text-blue-700 border-blue-200",
    ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  }[tone];
  const Ico = tone === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <div className={cn("flex items-center gap-2 text-xs rounded-md border px-3 py-1.5 mb-1", styles)}>
      {icon ?? <Ico className="w-4 h-4 shrink-0" />}<span>{text}</span>
    </div>
  );
}
