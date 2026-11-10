/**
 * The plant's time zone, used wherever a figure is grouped by calendar day or
 * hour ("cleared today", the daily alarm trend, the hourly device matrix, 1d/1w
 * aggregation buckets).
 *
 * Those used to mix three clocks: the API host's local zone (setHours), the
 * database session's zone (date_trunc) and UTC (toISOString keys), so a day
 * boundary could fall in a different place in the query and in the chart.
 * Everything now uses PLANT_TIME_ZONE, an IANA name such as "Asia/Kolkata".
 * Unset or unrecognised means UTC.
 */

function resolveZone(raw: string | undefined): string {
  const zone = (raw ?? "").trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    console.warn(`[plant-time] PLANT_TIME_ZONE="${zone}" is not a known time zone; using UTC`);
    return "UTC";
  }
}

export const PLANT_TIME_ZONE = resolveZone(process.env.PLANT_TIME_ZONE);

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(date: Date, zone: string): Record<string, number> {
  let fmt = partsFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    partsFormatters.set(zone, fmt);
  }
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

/** Offset of `zone` from UTC at `date`, in milliseconds (positive east of Greenwich). */
export function zoneOffsetMs(date: Date, zone: string = PLANT_TIME_ZONE): number {
  const p = partsIn(date, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Calendar date ("YYYY-MM-DD") of an instant in the plant zone. */
export function zoneDateKey(date: Date, zone: string = PLANT_TIME_ZONE): string {
  const p = partsIn(date, zone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The instant a wall-clock time in `zone` occurs (first occurrence across a DST change). */
function zonedWallTimeToInstant(y: number, m: number, d: number, h: number, zone: string): Date {
  const guess = Date.UTC(y, m - 1, d, h);
  let t = guess - zoneOffsetMs(new Date(guess), zone);
  // A second pass settles the offset when the first guess crossed a DST change.
  t = guess - zoneOffsetMs(new Date(t), zone);
  return new Date(t);
}

/** Midnight at the start of the plant-zone day containing `date`, `daysBack` days earlier. */
export function startOfZoneDay(date: Date, daysBack = 0, zone: string = PLANT_TIME_ZONE): Date {
  const p = partsIn(date, zone);
  // Date.UTC normalises an out-of-range day, so subtracting days crosses months.
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day - daysBack));
  return zonedWallTimeToInstant(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 0, zone);
}

/** Start of the plant-zone hour containing `date`. Correct for half-hour zones such as India. */
export function startOfZoneHour(date: Date, zone: string = PLANT_TIME_ZONE): Date {
  const offset = zoneOffsetMs(date, zone);
  return new Date(Math.floor((date.getTime() + offset) / 3_600_000) * 3_600_000 - offset);
}
