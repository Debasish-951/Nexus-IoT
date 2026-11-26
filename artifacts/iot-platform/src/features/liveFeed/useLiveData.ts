import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListAssets, getListAssetsQueryKey } from "@workspace/api-client-react";
import { apiFetch } from "@/lib/auth-api";
import { useWsEvents, type WsStatus } from "@/hooks/useWsEvents";
import { useCurrentUser } from "@/contexts/UserContext";
import { useProjectScope } from "@/hooks/useProjectScope";
import { OPEN_ALARMS_KEY, useOpenAlarms, type OpenAlarm } from "@/hooks/useOpenAlarms";
import { statusFromLimits, useAlarmLimits, type LimitLookup } from "@/features/plantTwin/shared/alarmLimits";
import { dataStatus, expectedIntervalMs, newest, type DataStatus } from "./status";

/**
 * Data behind the Live Feed page. Sources, all existing endpoints:
 *   - asset list (project scope applied, as before),
 *   - per asset, every 30 s and a few at a time: /assets/:id/health (newest
 *     stored reading, active alarms) and /assets/:id/attributes (latest value,
 *     unit and timestamp of each dynamic attribute, and the optional
 *     "Expected interval (min)" static attribute),
 *   - once per asset, when the user may read telemetry: recent stored readings
 *     to seed the sparklines and the messages-per-minute chart,
 *   - live WebSocket telemetry, alarm and audit events.
 * Mutable buffers live in refs; the page re-renders at most once a second.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const POLL_MS = 30_000;
const BATCH = 6;
const HIST = 30;
const MAX_EVENTS = 200;
const SEED_ASSETS = 25;
const RATE_MINUTES = 15;

export type ReadingStatus = "ok" | "warn" | "crit" | undefined;
export interface Reading { metric: string; value: number; ts: number; uom: string | null; decimals: number | null; hist: { t: number; v: number }[]; level: ReadingStatus }
export interface AssetLive {
  id: string; name: string; parentId: string | null; identifier: string | null;
  intervalMs: number; lastSeen: number; status: DataStatus; activeAlarms: number;
  readings: Reading[];
}
export type LiveEventKind = "alarm" | "status" | "limit" | "user";
/**
 * One line of the event stream. `title` is data (a metric, rule or asset name, or
 * an audit action); an alarm without a rule name has an empty title and the page
 * shows "Alarm". `detail` is interface text the page translates, except when
 * `detailIsData` is set (user names of an audit entry).
 */
export interface LiveEvent { id: string; kind: LiveEventKind; at: number; assetId?: string; assetName?: string; title: string; detail?: string; detailIsData?: boolean; severity?: string; tone: "red" | "amber" | "green" | "blue" | "grey" }

interface Store {
  readings: Map<string, Map<string, Reading>>;   // assetId -> metric -> reading
  units: Map<string, Map<string, { uom: string | null; decimals: number | null }>>;
  interval: Map<string, number>;
  healthSeen: Map<string, number>;
  attrSeen: Map<string, number>;
  wsSeen: Map<string, number>;
  alarmsCount: Map<string, number>;
  seeded: Set<string>;
  minutes: Map<number, { msgs: number; readings: number }>;
  readingTimes: number[];
}

const newStore = (): Store => ({
  readings: new Map(), units: new Map(), interval: new Map(), healthSeen: new Map(), attrSeen: new Map(),
  wsSeen: new Map(), alarmsCount: new Map(), seeded: new Set(), minutes: new Map(), readingTimes: [],
});

/** Key under which ingest stores a dynamic attribute's payload metric. */
const attrKey = (a: { name: string; tagName?: string | null; sourceMetric?: string | null }) => a.sourceMetric || a.tagName || a.name;

export function useLiveData() {
  const qc = useQueryClient();
  const { canModule, session } = useCurrentUser();
  const restricted = !!session?.restrictProjects;
  const canAssets = canModule("assets");
  const canTelemetry = canModule("explorer") || canModule("visualization");
  const canAudit = canModule("activity_log") && !restricted;
  const canAlarms = canModule("alarms");
  const { inScope } = useProjectScope();
  const limits = useAlarmLimits();
  const limitsRef = useRef<LimitLookup>(limits); limitsRef.current = limits;

  const { data: assetsData } = useListAssets(undefined, { query: { enabled: canAssets, queryKey: getListAssetsQueryKey() } });
  const assets = useMemo(
    () => ((assetsData as any[] | undefined) ?? []).filter((a) => inScope(a.id, { strict: true })) as { id: string; name: string; parentId?: string | null; identifier?: string | null }[],
    [assetsData, inScope],
  );
  const nameOf = useRef(new Map<string, string>());
  nameOf.current = new Map(assets.map((a) => [a.id, a.name]));

  const { alarms: openAlarmsRaw } = useOpenAlarms();
  const openAlarms = useMemo(() => (openAlarmsRaw as OpenAlarm[]).filter((a) => inScope(a.assetId, { strict: true })), [openAlarmsRaw, inScope]);

  const store = useRef<Store>(newStore());
  const events = useRef<LiveEvent[]>([]);
  const dirty = useRef(true);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [firstPollDone, setFirstPollDone] = useState(false);
  const prevStatus = useRef(new Map<string, DataStatus>());

  const pushEvent = useCallback((e: Omit<LiveEvent, "id">) => {
    events.current = [{ ...e, id: `${e.at}-${Math.random().toString(36).slice(2, 8)}` }, ...events.current].slice(0, MAX_EVENTS);
    dirty.current = true;
  }, []);

  /** Store one reading, update its buffer and limit level; records limit crossings. */
  const putReading = useCallback((assetId: string, metric: string, value: number, ts: number, live: boolean) => {
    const s = store.current;
    let m = s.readings.get(assetId);
    if (!m) { m = new Map(); s.readings.set(assetId, m); }
    const unit = s.units.get(assetId)?.get(metric);
    const cur = m.get(metric);
    const level = statusFromLimits(value, limitsRef.current(assetId, metric));
    if (!cur) {
      m.set(metric, { metric, value, ts, uom: unit?.uom ?? null, decimals: unit?.decimals ?? null, hist: [{ t: ts, v: value }], level });
      return;
    }
    if (ts < cur.ts) return;
    if (live && cur.level !== undefined && level !== undefined && level !== cur.level) {
      const asset = nameOf.current.get(assetId) ?? assetId;
      pushEvent({
        kind: "limit", at: ts, assetId, assetName: asset, title: metric,
        detail: level === "ok" ? "back within limits" : level === "crit" ? "over the alarm limit" : "over the warning limit",
        tone: level === "crit" ? "red" : level === "warn" ? "amber" : "green",
      });
    }
    if (ts > cur.ts) { cur.hist.push({ t: ts, v: value }); if (cur.hist.length > HIST) cur.hist.splice(0, cur.hist.length - HIST); }
    cur.value = value; cur.ts = ts; cur.level = level;
    if (unit) { cur.uom = unit.uom; cur.decimals = unit.decimals; }
  }, [pushEvent]);

  const countMinute = useCallback((at: number, readings: number, msgs = 1) => {
    const minute = Math.floor(at / 60_000);
    const b = store.current.minutes.get(minute) ?? { msgs: 0, readings: 0 };
    b.msgs += msgs; b.readings += readings;
    store.current.minutes.set(minute, b);
  }, []);

  // ── polling: health + attributes, a few assets at a time ──
  const running = useRef(false);
  const poll = useCallback(async (ids: string[]) => {
    if (!canAssets || running.current || ids.length === 0) return;
    running.current = true;
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        await Promise.all(ids.slice(i, i + BATCH).map(async (id) => {
          const s = store.current;
          try {
            const [hr, ar] = await Promise.all([
              apiFetch(`${BASE}/api/assets/${id}/health`),
              apiFetch(`${BASE}/api/assets/${id}/attributes`),
            ]);
            if (hr.ok) {
              const h = await hr.json();
              s.healthSeen.set(id, newest(h.lastSeen));
              s.alarmsCount.set(id, Number(h.activeAlarms ?? 0));
            }
            if (ar.ok) {
              const attrs = (await ar.json()) as any[];
              s.interval.set(id, expectedIntervalMs(attrs.filter((a) => a.type === "static")));
              const units = new Map<string, { uom: string | null; decimals: number | null }>();
              let attrTs = 0;
              for (const a of attrs) {
                if (a.type !== "dynamic" && a.type !== "metric" && a.type !== "runtime") continue;
                const key = attrKey(a);
                units.set(key, { uom: a.uom ?? null, decimals: a.decimalPlaces ?? null });
                const v = typeof a.value === "number" ? a.value : Number(a.value);
                const ts = newest(a.timestamp);
                if (Number.isFinite(v) && ts) { putReading(id, key, v, ts, false); attrTs = Math.max(attrTs, ts); }
              }
              s.units.set(id, units);
              s.attrSeen.set(id, attrTs);
              for (const r of s.readings.get(id)?.values() ?? []) { const u = units.get(r.metric); if (u) { r.uom = u.uom; r.decimals = u.decimals; } }
            }
            // Recent stored readings once, for sparklines and the rate chart.
            if (canTelemetry && !s.seeded.has(id) && s.seeded.size < SEED_ASSETS) {
              s.seeded.add(id);
              const tr = await apiFetch(`${BASE}/api/telemetry/${id}?limit=300`);
              if (tr.ok) {
                const rows = ((await tr.json()) as any[]).slice().reverse();
                const since = Date.now() - RATE_MINUTES * 60_000;
                const perTs = new Map<number, number>();
                for (const r of rows) {
                  const v = typeof r.value === "number" ? r.value : Number(r.value);
                  const ts = newest(r.timestamp);
                  if (!Number.isFinite(v) || !ts) continue;
                  putReading(id, r.metric, v, ts, false);
                  if (ts >= since) perTs.set(ts, (perTs.get(ts) ?? 0) + 1);
                }
                for (const [ts, n] of perTs) countMinute(ts, n, 1);
              }
            }
          } catch { /* next poll tries again */ }
        }));
        dirty.current = true;
      }
    } finally { running.current = false; setFirstPollDone(true); }
  }, [canAssets, canTelemetry, putReading, countMinute]);

  const idsKey = assets.map((a) => a.id).join(",");
  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    void poll(ids);
    const iv = setInterval(() => void poll(ids), POLL_MS);
    return () => clearInterval(iv);
  }, [idsKey, poll]);

  // ── live events ──
  const onTelemetry = useCallback((data: any) => {
    if (!data?.assetId || !data?.metrics || !inScope(data.assetId, { strict: true })) return;
    const at = Date.now();
    const ts = Math.min(newest(data.timestamp) || at, at);
    let n = 0;
    for (const [k, v] of Object.entries(data.metrics)) {
      const num = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(num)) continue;
      putReading(data.assetId, k, num, ts, true); n++;
    }
    store.current.wsSeen.set(data.assetId, ts);
    store.current.readingTimes.push(...Array(n).fill(at));
    countMinute(at, n, 1);
    dirty.current = true;
  }, [inScope, putReading, countMinute]);

  const onAlarm = useCallback((data: any) => {
    void qc.invalidateQueries({ queryKey: OPEN_ALARMS_KEY });
    if (!data || !inScope(data.assetId, { strict: true })) return;
    const ev = String(data.event ?? "");
    const sev = String(data.severity ?? "");
    pushEvent({
      kind: "alarm", at: newest(data.timestamp) || Date.now(), assetId: data.assetId, assetName: data.assetName,
      title: String(data.ruleName ?? ""), severity: sev || undefined,
      detail: ev === "triggered" ? "raised" : ev === "cleared" ? "cleared" : ev === "acknowledged" ? "acknowledged" : ev,
      tone: ev === "cleared" ? "green" : ev === "acknowledged" ? "blue" : sev === "critical" || sev === "high" ? "red" : "amber",
    });
  }, [qc, inScope, pushEvent]);

  const onActivity = useCallback((data: any) => {
    if (!canAudit || !data) return;
    pushEvent({
      kind: "user", at: newest(data.timestamp) || Date.now(), title: String(data.action ?? ""),
      detail: [data.actorName, data.targetName].filter(Boolean).join(" - ") || undefined, detailIsData: true, tone: "blue",
    });
  }, [canAudit, pushEvent]);

  const wsStatus: WsStatus = useWsEvents({ telemetry: onTelemetry, alarm: onAlarm, activity_log: onActivity });

  // ── clock: re-render at most once a second ──
  useEffect(() => {
    const iv = setInterval(() => {
      const t = Date.now();
      store.current.readingTimes = store.current.readingTimes.filter((x) => t - x < 60_000);
      const oldest = Math.floor(t / 60_000) - RATE_MINUTES;
      for (const k of store.current.minutes.keys()) if (k < oldest) store.current.minutes.delete(k);
      setNow(t);
      if (dirty.current) { dirty.current = false; setTick((x) => x + 1); }
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // ── derived view ──
  const view = useMemo(() => {
    const s = store.current;
    const list: AssetLive[] = assets.map((a) => {
      const intervalMs = s.interval.get(a.id) ?? expectedIntervalMs(undefined);
      const lastSeen = newest(s.wsSeen.get(a.id), s.healthSeen.get(a.id), s.attrSeen.get(a.id));
      return {
        id: a.id, name: a.name, parentId: a.parentId ?? null, identifier: a.identifier ?? null,
        intervalMs, lastSeen, status: dataStatus(lastSeen, intervalMs, now),
        activeAlarms: openAlarms.filter((x) => x.assetId === a.id).length || (canAlarms ? 0 : s.alarmsCount.get(a.id) ?? 0),
        readings: [...(s.readings.get(a.id)?.values() ?? [])].map((r) => ({ ...r, hist: r.hist.slice() })),
      };
    });
    const minuteNow = Math.floor(now / 60_000);
    const rate = Array.from({ length: RATE_MINUTES }, (_, i) => {
      const b = s.minutes.get(minuteNow - (RATE_MINUTES - 1) + i);
      return { v: b?.msgs ?? 0, r: b?.readings ?? 0 };
    });
    return { assets: list, rate, readingsPerMin: s.readingTimes.length || (rate[RATE_MINUTES - 2]?.r ?? 0) };
  }, [assets, openAlarms, canAlarms, now, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Status transitions, recorded once the first poll has given every asset its baseline.
  useEffect(() => {
    if (!firstPollDone) return;
    const prev = prevStatus.current;
    for (const a of view.assets) {
      const before = prev.get(a.id);
      if (before && before !== a.status && a.status !== "never") {
        pushEvent({
          kind: "status", at: now, assetId: a.id, assetName: a.name,
          title: a.name, detail: a.status === "online" ? "online again" : a.status === "delayed" ? "data delayed" : "offline",
          tone: a.status === "online" ? "green" : a.status === "delayed" ? "amber" : "grey",
        });
      }
      prev.set(a.id, a.status);
    }
  }, [view, firstPollDone, now, pushEvent]);

  return {
    ...view, openAlarms, wsStatus, now, events: events.current, ready: firstPollDone,
    can: { alarms: canAlarms, audit: canAudit, assets: canAssets },
  };
}
