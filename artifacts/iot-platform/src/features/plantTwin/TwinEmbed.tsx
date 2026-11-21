import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { useWsEvents } from "@/hooks/useWsEvents";
import { createPlantEngine, type PlantEngine } from "./engine/engine";
import { getPlantTwin, fetchPlantValues } from "./api";
import { fetchGlbBytes } from "./panels";
import { useAlarmLimits } from "./shared/alarmLimits";
import "./plantTwin.css";

/**
 * A saved 3D twin (plant or asset twin), view only and compact, for a
 * Visualization dashboard widget. Drag to rotate, scroll to zoom, click a
 * machine to see its label; nothing can be edited or saved from here.
 *
 * Live values refresh every 20 s and on telemetry pushes. Readings that are not
 * linked show demo values only when the twin's own demo switch is on, marked
 * "demo" on the labels, exactly as in Live Twin.
 *
 * Import this lazily: it pulls in three.js.
 */
export default function PlantTwinEmbed({ twinId, refreshMs = 20_000 }: { twinId: string; refreshMs?: number }) {
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), overlayRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<PlantEngine | null>(null);
  const valuesRef = useRef(new Map<string, number | null>());
  const limits = useAlarmLimits();
  const limitsRef = useRef(limits); limitsRef.current = limits;
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; name?: string; error?: string }>({ status: "loading" });
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => (n + 1) % 1_000_000), []);

  useEffect(() => {
    const e = createPlantEngine({
      canvas: canvasRef.current!, host: stageRef.current!, overlay: overlayRef.current!,
      getLive: (a, m) => valuesRef.current.get(a + "\u0000" + m),
      getLimits: (a, m) => limitsRef.current(a, m),
      fetchGlb: fetchGlbBytes,
      onChange: () => { /* the widget shows only a summary; it refreshes on its own tick */ },
      onEdit: () => { /* view only */ },
    });
    e.setReadOnly(true);
    setEngine(e); e.start();
    const ticker = setInterval(() => { if (document.visibilityState === "visible") bump(); }, 1000);
    return () => { clearInterval(ticker); e.dispose(); };
  }, [bump]);

  useEffect(() => {
    if (!engine || !twinId) return;
    let cancelled = false;
    setState({ status: "loading" });
    getPlantTwin(twinId).then((tw) => {
      if (cancelled) return;
      if (tw.kind && tw.kind !== "plant" && tw.kind !== "asset") { setState({ status: "error", error: t("This twin is not a 3D plant or asset twin.") }); return; }
      engine.loadScene(tw.scene, tw.scene?.pack);
      engine.setReadOnly(true);
      setState({ status: "ready", name: tw.name });
    }).catch((err: any) => {
      if (cancelled) return;
      const msg = String(err?.message ?? err);
      setState({ status: "error", error: /not found|403|denied/i.test(msg) ? t("This twin does not exist, or you do not have access to it.") : msg });
    });
    return () => { cancelled = true; };
  }, [engine, twinId, t]);

  // Live values: on a timer and when telemetry arrives (at most every 3 s).
  const [nonce, setNonce] = useState(0);
  const lastWs = useRef(0);
  useWsEvents({ telemetry: () => { const now = Date.now(); if (now - lastWs.current > 3000) { lastWs.current = now; setNonce((n) => n + 1); } } });
  useEffect(() => { const id = setInterval(() => setNonce((n) => n + 1), Math.max(5000, refreshMs)); return () => clearInterval(id); }, [refreshMs]);
  const pairs = state.status === "ready" ? engine?.pairs() ?? [] : [];
  const pairsKey = pairs.map((p) => p.assetId + ":" + p.metric).sort().join("|");
  useEffect(() => {
    if (!pairs.length) { valuesRef.current = new Map(); return; }
    let cancelled = false;
    fetchPlantValues(pairs.slice(0, 500)).then((rows) => {
      if (cancelled) return;
      const m = new Map<string, number | null>(); rows.forEach((r) => m.set(r.assetId + "\u0000" + r.metric, r.value)); valuesRef.current = m;
    }).catch(() => { /* keep the last values */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, pairsKey]);

  const all = state.status === "ready" ? engine?.areaStats()[0] : undefined;
  return (
    <div ref={stageRef} className="pt-stage relative w-full h-full min-h-[160px] rounded-md overflow-hidden">
      <canvas ref={canvasRef} aria-label={t("3D twin")} />
      <div ref={overlayRef} className="pt-overlay" />
      {state.status === "ready" && (
        <div className="absolute left-2 top-2 flex items-center gap-1.5 text-[11px] font-mono pointer-events-none">
          <span className="px-1.5 py-0.5 rounded bg-slate-900/75 text-slate-100 border border-slate-600 truncate max-w-[14rem]">{state.name}</span>
          {all && <span className={cn("px-1.5 py-0.5 rounded border text-white", all.alarms ? (all.worst === "crit" ? "bg-red-950/80 border-red-500" : "bg-amber-950/70 border-amber-500") : "bg-slate-900/75 border-slate-600")}>
            {all.alarms ? t("{n} alarm(s)", { n: all.alarms }) : t("{a}/{b} live", { a: all.linked, b: all.total })}
          </span>}
        </div>
      )}
      {state.status === "loading" && <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-300 bg-black/30">{t("Loading…")}</div>}
      {state.status === "error" && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-slate-300 bg-black/50">{state.error}</div>}
    </div>
  );
}
