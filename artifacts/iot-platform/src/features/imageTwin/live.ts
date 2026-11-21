import { useEffect, useMemo, useRef, useState } from "react";
import { useWsEvents } from "@/hooks/useWsEvents";
import { fetchPlantValues } from "@/features/plantTwin/api";
import { useAlarmLimits } from "@/features/plantTwin/shared/alarmLimits";
import type { Playback } from "@/features/plantTwin/shared/playback";
import { demoValue, evaluate, type ItemView } from "./evaluate";
import type { TwinItem } from "./types";

/**
 * Live state of every item: latest reading per linked asset + metric (polled
 * every `refreshSec` and nudged by telemetry over the WebSocket), demo values
 * for unlinked items while demo is on, or history while playback runs.
 */
export function useItemViews(items: TwinItem[], opts: { demo: boolean; playback?: Playback; refreshSec?: number; enabled?: boolean }) {
  const { demo, playback, refreshSec = 20, enabled = true } = opts;
  const limits = useAlarmLimits();
  const [values, setValues] = useState(new Map<string, { v: number | null; ts: string }>());
  const [nonce, setNonce] = useState(0);
  const lastWs = useRef(0);
  const wsStatus = useWsEvents({ telemetry: () => { const now = Date.now(); if (now - lastWs.current > 3000) { lastWs.current = now; setNonce((n) => n + 1); } } });
  useEffect(() => { if (!refreshSec) return; const id = setInterval(() => setNonce((n) => n + 1), refreshSec * 1000); return () => clearInterval(id); }, [refreshSec]);
  const pairs = useMemo(() => {
    const seen = new Set<string>(); const out: { assetId: string; metric: string }[] = [];
    for (const i of items) if (i.assetId && i.metric) { const k = `${i.assetId}\u0000${i.metric}`; if (!seen.has(k)) { seen.add(k); out.push({ assetId: i.assetId, metric: i.metric }); } }
    return out;
  }, [items]);
  const pairsKey = pairs.map((p) => `${p.assetId}:${p.metric}`).join("|");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || !pairs.length) { setValues(new Map()); return; }
    let cancelled = false;
    // The API takes up to 500 pairs per call.
    const batches: typeof pairs[] = []; for (let i = 0; i < pairs.length; i += 500) batches.push(pairs.slice(i, i + 500));
    Promise.all(batches.map((b) => fetchPlantValues(b))).then((all) => {
      if (cancelled) return;
      const m = new Map<string, { v: number | null; ts: string }>();
      all.flat().forEach((r) => m.set(`${r.assetId}\u0000${r.metric}`, { v: r.value, ts: r.ts }));
      setValues(m); setUpdatedAt(Date.now());
    }).catch(() => { /* keep the last values */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, pairsKey, enabled]);

  // Demo values move; re-evaluate twice a second while any item uses them.
  const anyDemo = demo && items.some((i) => !(i.assetId && i.metric));
  const [tick, setTick] = useState(0);
  useEffect(() => { if (!anyDemo) return; const id = setInterval(() => setTick((x) => x + 1), 500); return () => clearInterval(id); }, [anyDemo]);

  const views = useMemo(() => {
    const t = performance.now() / 1000;
    const m = new Map<string, ItemView>();
    for (const it of items) {
      const linked = !!(it.assetId && it.metric);
      if (playback?.active) {
        const v = linked ? playback.valueAt(it.assetId, it.metric) ?? null : null;
        m.set(it.id, evaluate(it, v, linked && v != null ? "history" : "none", limits));
      } else if (linked) {
        const r = values.get(`${it.assetId}\u0000${it.metric}`);
        m.set(it.id, evaluate(it, r?.v ?? null, r?.v != null ? "live" : "none", limits, r?.ts));
      } else if (demo) {
        m.set(it.id, evaluate(it, demoValue(it, t), "demo", limits));
      } else m.set(it.id, evaluate(it, null, "none", limits));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, values, demo, tick, limits, playback?.active, playback?.at]);

  return { views, wsStatus, pairs, limits, updatedAt };
}
