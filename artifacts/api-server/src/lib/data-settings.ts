/**
 * Data Management settings, kept as one JSON document in `job_state` under the
 * key `data_settings`. Every field has a default, so a missing or partial
 * document is fine. Changed on the Settings tab of Data Management.
 */
import { z } from "zod";
import { pool } from "@workspace/db";
import { partialUpdate } from "./validation";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, 24-hour");

export const DataSettingsSchema = z.object({
  alerts: z.object({
    /** Raise an alert when free disk space falls below this percentage. 0 = off. */
    diskFreePctBelow: z.number().min(0).max(90).default(15),
    /** ...or when the disk is expected to be full within this many days. 0 = off. */
    daysUntilFullBelow: z.number().int().min(0).max(3650).default(30),
    /** ...or when the last good backup is older than this. 0 = off. */
    backupMaxAgeHours: z.number().int().min(0).max(24 * 60).default(26),
    /** ...or when the summaries are this far behind. 0 = off. */
    summariesBehindHours: z.number().int().min(0).max(24 * 30).default(3),
    /** ...or when more ingest requests than this were refused in the last hour. 0 = off. */
    rejectionsPerHourAbove: z.number().int().min(0).max(1_000_000).default(100),
    /** ...or when an asset that was sending has been quiet longer than health.quietMinutes. */
    quietAssets: z.boolean().default(true),
    /** Optional webhook (HTTPS recommended) that receives raised and cleared alerts as JSON. */
    webhookUrl: z.string().url().max(2000).nullable().default(null),
  }).prefault({}),
  pruneWindow: z.object({
    /** When on, the hourly job deletes telemetry only between start and end (plant time). */
    enabled: z.boolean().default(false),
    start: hhmm.default("01:00"),
    end: hhmm.default("05:00"),
  }).prefault({}),
  approval: z.object({
    /** When on, deletions estimated above thresholdRows wait for a second administrator. */
    enabled: z.boolean().default(false),
    thresholdRows: z.number().int().min(0).max(1_000_000_000).default(1_000_000),
  }).prefault({}),
  archive: z.object({
    /** When on, raw readings are written to daily files before pruning deletes them. */
    enabled: z.boolean().default(false),
  }).prefault({}),
  tiers: z.object({
    /** Days 15-minute summaries are kept. 0 = do not build them. */
    m15Days: z.number().int().min(0).max(3650).default(365),
    /** Days hourly summaries are kept; null = RETENTION_ROLLUP_DAYS (default 1825). 0 = for ever. */
    hourDays: z.number().int().min(0).max(36500).nullable().default(null),
  }).prefault({}),
  health: z.object({
    /** An asset counts as quiet after this many minutes without a reading. */
    quietMinutes: z.number().int().min(5).max(60 * 24 * 30).default(60),
  }).prefault({}),
});

export type DataSettings = z.infer<typeof DataSettingsSchema>;

/** Partial update body: any subset of sections and fields. */
export const DataSettingsUpdate = z.object({
  alerts: partialUpdate(DataSettingsSchema.shape.alerts.unwrap()).optional(),
  pruneWindow: partialUpdate(DataSettingsSchema.shape.pruneWindow.unwrap()).optional(),
  approval: partialUpdate(DataSettingsSchema.shape.approval.unwrap()).optional(),
  archive: partialUpdate(DataSettingsSchema.shape.archive.unwrap()).optional(),
  tiers: partialUpdate(DataSettingsSchema.shape.tiers.unwrap()).optional(),
  health: partialUpdate(DataSettingsSchema.shape.health.unwrap()).optional(),
}).strict();

const KEY = "data_settings";
let cache: { at: number; value: DataSettings } | null = null;

export function parseSettings(raw: unknown): DataSettings {
  const r = DataSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : DataSettingsSchema.parse({});
}

export async function getDataSettings(): Promise<DataSettings> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value;
  const r = await pool.query<{ value: unknown }>(`SELECT value FROM job_state WHERE key = $1`, [KEY]);
  const value = parseSettings(r.rows[0]?.value);
  cache = { at: Date.now(), value };
  return value;
}

export async function saveDataSettings(update: z.infer<typeof DataSettingsUpdate>): Promise<DataSettings> {
  const current = await getDataSettings();
  const merged = DataSettingsSchema.parse({
    alerts: { ...current.alerts, ...update.alerts },
    pruneWindow: { ...current.pruneWindow, ...update.pruneWindow },
    approval: { ...current.approval, ...update.approval },
    archive: { ...current.archive, ...update.archive },
    tiers: { ...current.tiers, ...update.tiers },
    health: { ...current.health, ...update.health },
  });
  await pool.query(
    `INSERT INTO job_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, JSON.stringify(merged)],
  );
  cache = { at: Date.now(), value: merged };
  return merged;
}

/** Minutes since midnight of `d` in `timeZone`. */
export function minutesInZone(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Whether `d` falls inside the window (plant time). A window may cross midnight. */
export function insideWindow(d: Date, w: { enabled: boolean; start: string; end: string }, timeZone: string): boolean {
  if (!w.enabled) return true;
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const now = minutesInZone(d, timeZone), a = toMin(w.start), b = toMin(w.end);
  if (a === b) return true;
  return a < b ? now >= a && now < b : now >= a || now < b;
}
