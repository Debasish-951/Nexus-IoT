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
const ENVELOPE = new Set(["deviceid", "device_id", "timestamp", "timestampunix", "capturedat", "captured_at", "receivedat", "id", "version", "source", "machineid", "machine_id", "assetid", "asset_id"]);
// Hierarchy-level column names recognised in FLAT rows (and in the wrapping
// envelope object). ONLY these become grouping nodes — categorical metrics like
// `status`/`operatorShift` are NOT levels. Order is coarse→fine so a level path
// nests sensibly even if the source lists columns out of order.
const LEVEL_KEYS = [
  "enterprise", "company", "organization", "org", "corporation", "group",
  "site", "campus", "facility", "location", "region",
  "plant", "factory", "building", "fab", "block",
  "area", "zone", "workshop", "shop", "cleanroom", "room", "bay",
  "unit", "department", "dept", "division", "section",
  "line", "cell", "station",
  "process", "processmodule", "module", "manufacturingstep", "step", "stage",
  "subprocess", "sub_process", "substep",
];
const LEVEL_SET = new Set(LEVEL_KEYS);
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

// The hierarchy-level columns of a flat row = the string columns that come BEFORE
// the recognised LEVEL_KEYS (whitelist). Categorical metrics such as `status` or
// `operatorShift` are deliberately excluded — only true location/org columns nest.
// Returned in the object's own key order (author intent).
function levelKeysOf(row: any): string[] {
  return Object.keys(row).filter((k) =>
    LEVEL_SET.has(k.toLowerCase()) && typeof row[k] === "string" && (row[k] as string).trim());
}

// The leaf node name for a row: its MachineId (e.g. LITHO_01) if present, else the
// machine (type) name. The `machine` value stays as the machine's type/template.
function leafNameOf(row: any): string {
  const idKey = Object.keys(row).find((k) => k.toLowerCase() === "machineid" || k.toLowerCase() === "machine_id");
  if (idKey && typeof row[idKey] === "string" && (row[idKey] as string).trim()) return (row[idKey] as string).trim();
  if (typeof row.machine === "string" && row.machine.trim()) return row.machine.trim();
  return "Machine";
}

// Detect a FLAT array of machine rows: [{ unit, process, machine, powerKW, … }, …].
// Each row is one machine reading with its location as sibling columns (no nesting).
function isFlatRows(arr: any[]): boolean {
  return arr.length > 0 && arr.every((r) =>
    r && typeof r === "object" && !Array.isArray(r) &&
    typeof r.machine === "string" && !("children" in r) &&
    levelKeysOf(r).length > 0);
}

// Location/org level values on the WRAPPING object (e.g. { enterprise, site,
// machines:[…] }) — become the top ancestors shared by every row.
function objectLevelPath(obj: any): string[] {
  return Object.keys(obj)
    .filter((k) => LEVEL_SET.has(k.toLowerCase()) && typeof obj[k] === "string" && (obj[k] as string).trim())
    .map((k) => (obj[k] as string).trim());
}

// Convert flat machine rows into the nested tree. `prefix` = ancestor level values
// from the wrapping envelope. Level columns become grouping nodes (in column
// order); the leaf is the MachineId; every remaining scalar column is an attribute.
function parseFlatRows(rows: any[], prefix: string[] = []): HNode[] {
  const roots: HNode[] = [];
  for (const row of rows) {
    const levelKeys = levelKeysOf(row);
    const path = [...prefix, ...levelKeys.map((k) => (row[k] as string).trim())];
    let level = roots;
    for (const name of path) {
      let f = level.find((n) => !n.attr && n.name.toLowerCase() === name.toLowerCase());
      if (!f) { f = node(name); level.push(f); }
      level = f.children;
    }
    const mName = leafNameOf(row);
    let m = level.find((n) => n.name.toLowerCase() === mName.toLowerCase());
    if (!m) { m = node(mName); level.push(m); }
    for (const [k, v] of Object.entries(row)) {
      const lk = k.toLowerCase();
      if (lk === "machine" || lk === "name" || ENVELOPE.has(lk) || levelKeys.includes(k)) continue;
      if (v != null && typeof v === "object") continue;
      if (m.children.some((c) => c.name.toLowerCase() === lk)) continue;
      const dt = typeof v === "number" ? (Number.isInteger(v) ? "number" : "double") : typeof v === "boolean" ? "boolean" : "text";
      m.children.push(attrNode(k, dt, guessUom(k)));
    }
  }
  return roots;
}

function parseJson(t: string): HNode[] {
  const raw = JSON.parse(t);

  // Flat array of machine rows → rebuild the nested hierarchy.
  if (Array.isArray(raw) && isFlatRows(raw)) return parseFlatRows(raw);
  // Flat rows wrapped in an envelope object, e.g. { deviceId, timestamp, machines: [ …rows… ] }.
  // Use the first non-envelope array property whose elements look like flat rows.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (ENVELOPE.has(k.toLowerCase())) continue;
      if (Array.isArray(v) && isFlatRows(v)) return parseFlatRows(v, objectLevelPath(raw));
    }
  }

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

// Machine → Device ID mapping. Applied ONLY to matching machine (leaf) assets
// during Generate Asset Tree; unmatched machines get no device id (blank).
const MACHINE_DEVICE_MAP: Record<string, string> = {
  "creel machine": "CREEL_01", "soft flow dyeing machine": "SFDM_01", "overflow washer": "OW_01", "rf dryer": "RF_DRYER_01",
  "auto bale opener": "ABO_01", "rectilinear comber": "COMBER_01", "draw frame": "DRAWFRAME_01", "ring spinning frame": "RINGSPIN_01",
  "auto cone winder": "CONEWINDER_01", "packing machine": "PACKING_01", "pet bottle washer": "PETWASHER_01", "extruder": "EXTRUDER_01",
  "melt filtration system": "MFS_01", "spinning machine": "SPINNING_01", "stenter dryer": "STENTER_01", "crimping machine": "CRIMPER_01",
  "baler": "BALER_01", "blending hopper": "HOPPER_01", "rotor spinning machine": "ROTORSPIN_01", "yarn doubler": "YARNDOUBLER_01",
};
// Carding Machine is ambiguous → resolve by unit ancestor (Unit 1 vs Unit 2).
function deviceIdFor(name: string, ancestors: string[]): string {
  const key = name.trim().toLowerCase();
  if (key === "carding machine") return ancestors.some((a) => /unit\s*2/i.test(a)) ? "CARDING_02" : "CARDING_01";
  return MACHINE_DEVICE_MAP[key] ?? "";
}

// Read each machine's deviceId straight from the pasted JSON payload, keyed by
// its full path (so it maps exactly to the tree node). This is the source of truth.
const PAYLOAD_ENV = new Set(["deviceid", "timestamp", "timestampunix", "capturedat", "receivedat", "machine", "assetid", "name"]);
function extractPayloadDevices(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  let raw: any;
  try { raw = JSON.parse(text); } catch { return map; }
  function walk(node: any, path: string[]) {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === "object" && !Array.isArray(item) && typeof item.deviceId === "string") {
          const name = (typeof item.machine === "string" && item.machine) || (typeof item.name === "string" && item.name) || "Machine";
          map[[...path, name].join("/").toLowerCase()] = item.deviceId;
        } else walk(item, path);
      }
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) { if (PAYLOAD_ENV.has(k.toLowerCase())) continue; if (v && typeof v === "object") walk(v, [...path, k]); }
    }
  }
  walk(raw, []);
  return map;
}
const machinePathKey = (name: string, ancestors: string[]) => [...[...ancestors].reverse(), name].join("/").toLowerCase();

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
  const [deviceIds, setDeviceIds] = useState<Record<string, string>>({}); // machine nodeId -> device id
  const [payloadDev, setPayloadDev] = useState<Record<string, string>>({}); // payload pathKey -> device id
  const [payloadRootDevice, setPayloadRootDevice] = useState(""); // top-level deviceId from the payload (the only valid root device)

  useEffect(() => {
    fetch(`${BASE}/api/asset-templates`).then((r) => (r.ok ? r.json() : [])).then((d) => setTemplates(Array.isArray(d) ? d : [])).catch(() => {});
    Promise.all([
      fetch(`${BASE}/api/ingest/seen-devices`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`${BASE}/api/assets`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([seen, assets]) => {
      const used = new Set((assets as any[]).map((a) => a.identifier).filter(Boolean));
      const free = (seen as any[]).map((d) => d.deviceId).filter((id: string) => !used.has(id));
      setFreeDevices(free);
    }).catch(() => {});
  }, []);

  function analyze() {
    setParseError(null);
    try {
      const parsed = parseHierarchy(text);
      if (parsed.length === 0) { setParseError("No nodes found in the input."); return; }
      setTree(parsed); setAnalyzed(true); setCollapsed(new Set());
      // Root device id + per-machine device ids come straight from the payload.
      setPayloadDev(extractPayloadDevices(text));
      try {
        const raw = JSON.parse(text);
        // Root device id: top-level `deviceId` (nested payload) or the first row's
        // `deviceId` (flat array of rows — they all share the same root device).
        const dev = (raw && typeof raw.deviceId === "string" && raw.deviceId.trim())
          ? raw.deviceId.trim()
          : (Array.isArray(raw) && raw[0] && typeof raw[0].deviceId === "string" && raw[0].deviceId.trim())
            ? raw[0].deviceId.trim()
            : "";
        if (dev) { setPayloadRootDevice(dev); setRootDevice(dev); }
        else { setPayloadRootDevice(""); }
      } catch { setPayloadRootDevice(""); }
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

  // Machine (leaf) nodes that can carry a Device ID — non-attribute nodes with
  // no non-attribute children (units/processes are excluded).
  const machineNodes = useMemo(() => {
    const f = flatten(tree);
    const parentOf = new Map(f.map((x) => [x.n, x.parent]));
    const out: { node: HNode; name: string; ancestors: string[] }[] = [];
    for (const { n, parent } of f) {
      if (isAttribute(n, parent)) continue;
      if (n.children.some((c) => !isAttribute(c, n))) continue; // has child assets → grouping
      const anc: string[] = []; let p = parent; const seen = new Set<string>();
      while (p && !seen.has(p.id)) { seen.add(p.id); anc.push(p.name); p = parentOf.get(p) ?? null; }
      out.push({ node: n, name: n.name, ancestors: anc });
    }
    return out;
  }, [tree]);

  // Device ids come from the payload (by path); fall back to the name mapping.
  useEffect(() => {
    setDeviceIds(() => {
      const next: Record<string, string> = {};
      for (const m of machineNodes) next[m.node.id] = payloadDev[machinePathKey(m.name, m.ancestors)] ?? deviceIdFor(m.name, m.ancestors);
      return next;
    });
  }, [machineNodes, payloadDev]);

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
    if (!rootDevice.trim()) { toast({ title: "Root device id is required", variant: "destructive" }); return; }
    if (payloadRootDevice && rootDevice.trim() !== payloadRootDevice) {
      toast({ title: "Wrong device id", description: `Must match the payload's device id "${payloadRootDevice}".`, variant: "destructive" });
      return;
    }
    if (validation.errors.length) { toast({ title: "Fix validation errors first", variant: "destructive" }); return; }
    setGenAssets(true);
    setGenProgress("");
    const tmplByName = new Map(templates.map((t) => [String(t.name).toLowerCase(), t]));
    let created = 0, failed = 0;

    async function makeAsset(name: string, parentId: string | null, identifier: string): Promise<string | null> {
      const t = tmplByName.get(name.toLowerCase());
      // A machine device id must be a known device — register it before create.
      if (identifier) {
        await fetch(`${BASE}/api/ingest/register-device`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: identifier }),
        }).catch(() => {});
      }
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

    async function walk(n: HNode, parentId: string, ancestors: string[]) {
      // Single-device model: only the root owns a device; every other node
      // (units/processes/machines) is device-less and inherits the root device.
      const id = await makeAsset(n.name, parentId, "");
      if (!id) return;
      for (const c of n.children) {
        if (isAttribute(c, n)) continue;   // attribute leaves are template-stamped, not assets
        await walk(c, id, [...ancestors, n.name]);
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
        await walk(r, rootId, [rootName]);
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
                    <Label className="text-xs">Root device id <span className="text-destructive">*</span></Label>
                    <Input value={rootDevice} onChange={(e) => setRootDevice(e.target.value)}
                      placeholder="e.g. testing" className={cn("h-8 text-sm font-mono", payloadRootDevice && rootDevice.trim() !== payloadRootDevice && "border-destructive focus-visible:ring-destructive/40")} />
                    {payloadRootDevice && rootDevice.trim() !== payloadRootDevice && (
                      <p className="text-[11px] text-destructive">Wrong device id — must match the payload's device id <code className="font-mono">{payloadRootDevice}</code>.</p>
                    )}
                  </div>
                </div>
                {machineNodes.length > 0 && (
                  <div className="border border-border rounded-md">
                    <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">
                      Machines ({machineNodes.length}) — inherit the root device
                    </div>
                    <div className="max-h-52 overflow-auto divide-y divide-border">
                      {machineNodes.map((m) => (
                        <div key={m.node.id} className="flex items-center gap-2 px-3 py-1.5">
                          <span className="text-xs flex-1 truncate" title={m.name}>{m.name}</span>
                          <code className="text-xs font-mono text-slate-500 bg-muted rounded px-2 py-1 w-40 text-right truncate" title="Inherited from root device">{(rootDevice || "root") + " (inherited)"}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <Button variant="outline" className="w-full" onClick={generateAssets}
                  disabled={genAssets || !rootDevice.trim() || (!!payloadRootDevice && rootDevice.trim() !== payloadRootDevice) || validation.errors.length > 0 || !can("manage_assets")}>
                  {genAssets ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> {genProgress || "Building…"}</> : <><Layers className="w-4 h-4 mr-1.5" /> Generate Asset Tree</>}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Root device id is required (prefilled from the payload's top-level <code>deviceId</code>). Each machine's Device ID (above) is prefilled from the mapping — edit any, then Generate.
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
