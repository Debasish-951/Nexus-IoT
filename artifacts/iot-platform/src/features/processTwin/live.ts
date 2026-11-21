import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWsEvents, type WsStatus } from "@/hooks/useWsEvents";
import { fetchPlantValues } from "@/features/plantTwin/api";
import { useAlarmLimits, statusFromLimits, type Limits } from "@/features/plantTwin/shared/alarmLimits";
import type { Playback } from "@/features/plantTwin/shared/playback";
import { registerMine, symDef, type Draw, type Status } from "./symbols";
import { isSym, isTag, sceneBindings, type Binding, type Drive, type LimitsCfg, type PipeItem, type ProcessScene, type Role, type SymItem, type TagItem } from "./scene";

/**
 * Live state of a process twin: latest values of every linked reading (polled
 * and nudged by the telemetry WebSocket), the demo simulation for readings not
 * linked, and the animation state (rotor angles, pipe flow offsets).
 */
export type Src = "live" | "demo" | "none" | "history";
export interface Reading { v: number | null; src: Src; status: Status }

export type Scenario = "normal" | "trip" | "highLevel" | "overheat" | "blocked";
export const SCENARIOS: [Scenario, string][] = [["normal", "Normal running"], ["trip", "Pump trip"], ["highLevel", "High level"], ["overheat", "High temperature"], ["blocked", "Blocked filter"]];

export const KIND_UNIT: Record<string, string> = { flow: "m³/h", pressure: "bar", dp: "bar", temp: "°C", level: "%", speed: "rpm", agitator: "rpm", opening: "%", analysis: "pH", energy: "kWh", cond: "µS/cm", o2: "mg/L", freq: "Hz", value: "" };
const ROLE_KIND: Record<Role, string> = { level: "level", speed: "speed", opening: "opening", temperature: "temp", value: "value" };

/** Demo kind from an ISA tag: "FT-101" → flow, "PDT-3" → dp, "TIC-2" → temp. */
export function kindFromTag(tag: string): string {
  const l = tag.toUpperCase().replace(/[^A-Z]/g, "");
  if (l.startsWith("PD")) return "dp";
  if (l.startsWith("SIC") || l.startsWith("SI") || l.startsWith("ST")) return "speed";
  if (l.startsWith("ZT") || l.startsWith("ZI")) return "opening";
  if (l.startsWith("EM") || l.startsWith("EI") || l.startsWith("JT")) return "energy";
  return ({ F: "flow", P: "pressure", T: "temp", L: "level", A: "analysis", S: "speed", Z: "opening", E: "energy", J: "energy" } as Record<string, string>)[l[0]] ?? "value";
}
/** Symbols whose speed is an agitator (slow, 0-150 rpm by default). */
const AGITATED = new Set(["agitator", "reactor", "fermenter"]);
export const tagKind = (t: TagItem) => t.demoKind ?? kindFromTag(t.tag);
export function driveKind(s: SymItem, role: Role): string {
  if (role !== "value") return role === "speed" && AGITATED.has(s.type) ? "agitator" : ROLE_KIND[role];
  return symDef(s.type).demo ?? kindFromTag(s.tag);
}

const BASE: Record<string, number> = { flow: 120, pressure: 4.2, dp: 0.4, temp: 60, level: 65, speed: 1480, agitator: 118, opening: 70, analysis: 7.1, cond: 850, o2: 6.5, freq: 48, value: 50 };
function target(kind: string, sc: Scenario): number {
  const b = BASE[kind] ?? 50;
  switch (sc) {
    case "trip": return ({ flow: 0, pressure: 0.3, speed: 0, level: 93, temp: 48, dp: 0.05, freq: 0 } as Record<string, number>)[kind] ?? b;
    case "highLevel": return ({ level: 94, flow: 95 } as Record<string, number>)[kind] ?? b;
    case "overheat": return kind === "temp" ? 98 : b;
    case "blocked": return ({ dp: 1.6, flow: 70, pressure: 5.6 } as Record<string, number>)[kind] ?? b;
    default: return b;
  }
}
const NOISE: Record<string, number> = { flow: 1.6, pressure: 0.05, dp: 0.02, temp: 0.3, level: 0.05, speed: 6, agitator: 1.2, opening: 0, analysis: 0.02, cond: 4, o2: 0.03, freq: 0.08, value: 0.5 };

function toLimits(l?: LimitsCfg): Limits | undefined { return l && Object.values(l).some((x) => x !== undefined) ? l : undefined; }
const norm = (v: number, min = 0, max = 100) => Math.max(0, Math.min(1, (v - min) / ((max - min) || 1)));
export function heatColour(f: number) { const c = Math.max(0, Math.min(1, f)); return `rgb(${Math.round(29 + c * 210)},${Math.round(78 - c * 10)},${Math.round(216 - c * 148)})`; }
export function fmtVal(v: number | null, unit?: string, decimals?: number, kind?: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const d = decimals ?? (kind === "speed" || kind === "agitator" || kind === "opening" || kind === "energy" ? 0 : Math.abs(v) < 10 ? 2 : 1);
  const u = unit ?? (kind ? KIND_UNIT[kind] : "");
  return `${v.toFixed(d)}${u ? ` ${u}` : ""}`;
}
const worst = (list: Status[]): Status => (list.includes("crit") ? "crit" : list.includes("warn") ? "warn" : list.includes("ok") ? "ok" : "none");

export interface Runtime {
  ws: WsStatus;
  /** Re-render counter (about 25 per second while visible). */
  frame: number;
  read: (bind: Binding | undefined, kind: string, key: string, manual?: LimitsCfg) => Reading;
  tagReading: (t: TagItem) => Reading;
  driveReading: (s: SymItem, role: Role) => Reading;
  draw: (s: SymItem) => Draw;
  pipe: (p: PipeItem) => { offset: number; moving: boolean; status: Status; src: Src };
  symStatus: (id: string) => Status;
  pairs: Binding[];
}

export function useProcessRuntime(scene: ProcessScene, opts: { demo: boolean; scenario: Scenario; playback?: Playback; refreshMs?: number; animate?: boolean }): Runtime {
  const limitsOf = useAlarmLimits();
  registerMine(scene.custom);
  const pairs = useMemo(() => {
    const seen = new Set<string>();
    return sceneBindings(scene).filter((b) => { const k = `${b.assetId}\u0000${b.metric}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 500);
  }, [scene]);
  const pairsKey = pairs.map((p) => `${p.assetId}:${p.metric}`).join("|");

  // ── latest values ─────────────────────────────────────────────────────────
  const values = useRef(new Map<string, number | null>());
  const [nonce, setNonce] = useState(0);
  const lastWs = useRef(0);
  const ws = useWsEvents({ telemetry: () => { const now = Date.now(); if (now - lastWs.current > 3000) { lastWs.current = now; setNonce((n) => n + 1); } } });
  const refreshMs = opts.refreshMs ?? 20_000;
  useEffect(() => { const id = setInterval(() => setNonce((n) => n + 1), refreshMs); return () => clearInterval(id); }, [refreshMs]);
  useEffect(() => {
    if (!pairs.length) { values.current = new Map(); return; }
    let cancelled = false;
    fetchPlantValues(pairs).then((rows) => {
      if (cancelled) return;
      const m = new Map<string, number | null>(); rows.forEach((r) => m.set(`${r.assetId}\u0000${r.metric}`, r.value)); values.current = m;
    }).catch(() => { /* keeps the last values */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, pairsKey]);

  // ── demo + animation clock ────────────────────────────────────────────────
  const demoState = useRef(new Map<string, number>());
  const angles = useRef(new Map<string, number>());
  const offsets = useRef(new Map<string, number>());
  const energy = useRef(new Map<string, number>());
  const [frame, setFrame] = useState(0);
  const optsRef = useRef(opts); optsRef.current = opts;
  const sceneRef = useRef(scene); sceneRef.current = scene;
  const animate = opts.animate !== false;

  const readRef = useRef<Runtime["read"]>(() => ({ v: null, src: "none", status: "none" }));
  const read = useCallback<Runtime["read"]>((bind, kind, key, manual) => {
    const o = optsRef.current;
    if (bind?.assetId && bind.metric) {
      const lim = limitsOf(bind.assetId, bind.metric) ?? toLimits(manual);
      if (o.playback?.active) {
        const v = o.playback.valueAt(bind.assetId, bind.metric) ?? null;
        return { v, src: "history", status: v == null ? "none" : statusFromLimits(v, lim) ?? "ok" };
      }
      const v = values.current.get(`${bind.assetId}\u0000${bind.metric}`);
      if (v != null) return { v, src: "live", status: statusFromLimits(v, lim) ?? "ok" };
      return { v: null, src: "none", status: "none" };
    }
    if (!o.demo) return { v: null, src: "none", status: "none" };
    let v: number;
    if (kind === "energy") { if (!energy.current.has(key)) energy.current.set(key, 12_480); v = energy.current.get(key)!; }
    else { v = demoState.current.get(key) ?? target(kind, o.scenario); demoState.current.set(key, v); }
    return { v, src: "demo", status: statusFromLimits(v, toLimits(manual)) ?? "ok" };
  }, [limitsOf]);
  readRef.current = read;

  useEffect(() => {
    if (!animate) return;
    let raf = 0, last = performance.now(), lastFrame = 0;
    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (document.hidden) return;
      const o = optsRef.current, s = sceneRef.current;
      // Demo values drift towards the scenario target.
      const k = Math.min(1, dt * 0.9);
      for (const [key, v] of demoState.current) {
        const kind = key.split("|")[1] ?? "value";
        const t = target(kind, o.scenario); const nz = (NOISE[kind] ?? 0.5) * (t === 0 ? 0 : 1);
        demoState.current.set(key, Math.max(0, v + (t - v) * k + (Math.random() - 0.5) * nz));
      }
      for (const [key, v] of energy.current) energy.current.set(key, v + dt * (o.scenario === "trip" ? 0.002 : 0.05));
      // Rotors and pipe flow.
      for (const it of s.items) {
        if (!isSym(it)) continue;
        const def = symDef(it.type);
        if (def.roles.includes("value") && driveKind(it, "value") === "energy" && !energy.current.has(`${it.id}|energy`)) energy.current.set(`${it.id}|energy`, 12_480);
        if (!def.roles.includes("speed")) continue;
        const d = it.drives?.speed;
        const r = readRef.current(d?.bind, driveKind(it, "speed"), `${it.id}|${driveKind(it, "speed")}`, d?.limits);
        const v = r.v ?? 0; const max = d?.max ?? (driveKind(it, "speed") === "agitator" ? 150 : 1500);
        const running = r.src !== "none" && (max <= 1 ? v > 0.5 : v > Math.max(1, max * 0.01));
        const rate = running ? Math.max(0.25, Math.min(1, v / max)) * 300 : 0;
        angles.current.set(it.id, ((angles.current.get(it.id) ?? 0) + rate * dt) % 360);
      }
      for (const p of s.pipes) {
        if (p.line === "signal" || p.line === "electrical") continue;
        const r = readRef.current(p.flow?.bind, "flow", `${p.id}|flow`, p.flow?.limits);
        const f = r.v == null ? 0 : norm(r.v, p.flow?.min ?? 0, p.flow?.max ?? 150);
        offsets.current.set(p.id, ((offsets.current.get(p.id) ?? 0) - dt * 70 * f) % 2200);
      }
      if (now - lastFrame > 40) { lastFrame = now; setFrame((f) => (f + 1) % 1e9); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  const tagReading = useCallback((t: TagItem) => { const kind = tagKind(t); return read(t.bind, kind, `${t.id}|${kind}`, t.limits); }, [read]);
  const driveReading = useCallback((s: SymItem, role: Role) => { const d: Drive | undefined = s.drives?.[role]; const kind = driveKind(s, role); return read(d?.bind, kind, `${s.id}|${kind}`, d?.limits); }, [read]);

  // Status of each symbol and pipe: its own readings plus the tag bubbles attached to it.
  const statusMap = (() => {
    const m = new Map<string, Status[]>();
    const push = (id: string, st: Status) => { const l = m.get(id) ?? []; l.push(st); m.set(id, l); };
    for (const it of scene.items) {
      if (isTag(it)) { if (it.attach) push(it.attach, tagReading(it).status); }
      else for (const role of symDef(it.type).roles) if (it.drives?.[role]?.bind || opts.demo) push(it.id, driveReading(it, role).status);
    }
    for (const p of scene.pipes) if (p.flow) push(p.id, read(p.flow.bind, "flow", `${p.id}|flow`, p.flow.limits).status);
    return m;
  })();
  const symStatus = (id: string) => worst(statusMap.get(id) ?? []);

  const draw = (s: SymItem): Draw => {
    const def = symDef(s.type);
    const d: Draw = { uid: `px-${s.id}`, level: null, angle: angles.current.get(s.id) ?? 0, running: null, open: null, heat: null, value: null, text: "", gauge: null, status: symStatus(s.id), tag: s.style?.hideTag ? "" : s.tag, time: performance.now() / 1000, label: s.label };
    for (const role of def.roles) {
      const dr = s.drives?.[role]; const r = driveReading(s, role);
      if (r.src === "none" || r.v == null) continue;
      const kind = driveKind(s, role);
      if (role === "level") d.level = norm(r.v, dr?.min ?? 0, dr?.max ?? 100);
      if (role === "opening") d.open = norm(r.v, dr?.min ?? 0, dr?.max ?? 100);
      if (role === "temperature") d.heat = heatColour(norm(r.v, dr?.min ?? 20, dr?.max ?? 100));
      if (role === "speed") { const max = dr?.max ?? (kind === "agitator" ? 150 : 1500); d.running = max <= 1 ? r.v > 0.5 : r.v > Math.max(1, max * 0.01); }
      if (role === "value") {
        d.value = r.v; d.text = fmtVal(r.v, dr?.unit, dr?.decimals, kind) + (r.src === "demo" ? " ·demo" : "");
        const def0 = kind === "pressure" ? 10 : kind === "flow" ? 200 : kind === "dp" ? 2 : 100;
        d.gauge = norm(r.v, dr?.min ?? 0, dr?.max ?? def0);
        if (kind === "energy") d.text = r.v.toFixed(dr?.decimals ?? 0);
      }
    }
    return d;
  };

  const pipe = (p: PipeItem) => {
    const signal = p.line === "signal" || p.line === "electrical";
    const r = signal ? null : read(p.flow?.bind, "flow", `${p.id}|flow`, p.flow?.limits);
    const moving = !!r && r.v != null && r.v > Math.max(0.01, ((p.flow?.max ?? 150) - (p.flow?.min ?? 0)) * 0.005);
    return { offset: offsets.current.get(p.id) ?? 0, moving, status: symStatus(p.id), src: (r?.src ?? "none") as Src };
  };

  return { ws, frame, read, tagReading, driveReading, draw, pipe, symStatus, pairs };
}
