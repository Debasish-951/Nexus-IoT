import net from "node:net";
import dns from "node:dns/promises";
import { eq, sql } from "drizzle-orm";
import { db, pullConnectorsTable, assetsTable, PgPool, type PullConnector } from "@workspace/db";
import { logger } from "../lib/logger";
import { safeFetch, checkOutboundUrl, classifyHost } from "../lib/outbound-url";
import { decryptSecret } from "../lib/secret-box";
import { assetSubtree } from "../lib/asset-subtree";
import { processNormalised, type NormalisedPayload } from "../routes/ingest";
import { emitLater } from "../lib/integration/events";

/**
 * Pull connectors: the platform fetches data on a schedule and feeds it through
 * the same pipeline as ingest (processNormalised), so attributes, calculated
 * values and alarm rules behave exactly as for pushed data.
 *
 *   rest    GET/POST a JSON endpoint; records found at a dot path.
 *   sql     a SELECT on an external PostgreSQL, with an optional watermark.
 *   modbus  Modbus TCP holding/input registers (function 3 / 4).
 *   opcua   saved, but NOT run yet: needs an OPC UA client library.
 *
 * Connectors are created disabled and run only after someone enables them, so
 * adding this service changes nothing for an installation that does not use it.
 */

export const CONNECTOR_TYPES = ["rest", "sql", "modbus", "opcua"] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];
export const secretContext = (id: string) => `pull_connectors.${id}`;

export interface Reading { deviceId: string; timestamp?: Date; metrics: Record<string, unknown> }
export interface RunResult { ok: boolean; status: "ok" | "error" | "skipped"; records: number; stored: number; error?: string; preview?: Reading[] }

const MAX_RECORDS = 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Read `a.b.0.c` from an object. Empty path = the value itself. */
export function atPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const part of path.split(".").filter(Boolean)) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Turn whatever the source returned into readings. */
export function toReadings(
  data: unknown,
  opts: { deviceId?: string; deviceIdField?: string; timestampField?: string; fields?: string[] },
): Reading[] {
  const list = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
  const out: Reading[] = [];
  for (const item of list.slice(0, MAX_RECORDS)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const deviceId = String((opts.deviceIdField ? atPath(row, opts.deviceIdField) : undefined) ?? opts.deviceId ?? "").trim();
    if (!deviceId) continue;
    const tsRaw = opts.timestampField ? atPath(row, opts.timestampField) : undefined;
    const ts = tsRaw instanceof Date ? tsRaw : typeof tsRaw === "string" || typeof tsRaw === "number" ? new Date(tsRaw) : undefined;
    const metrics: Record<string, unknown> = {};
    const keys = opts.fields?.length ? opts.fields : Object.keys(row);
    for (const k of keys) {
      if (k === opts.deviceIdField || k === opts.timestampField) continue;
      const v = atPath(row, k);
      if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.trim() !== "")) metrics[k] = v;
    }
    if (Object.keys(metrics).length) out.push({ deviceId, timestamp: ts && !Number.isNaN(ts.getTime()) ? ts : undefined, metrics });
  }
  return out;
}

/**
 * Field devices (PLCs, databases) normally live on the plant network, so
 * private addresses are allowed for Modbus and SQL. Loopback, link-local
 * (cloud metadata) and unspecified addresses are always refused.
 */
export async function assertConnectorHost(host: string): Promise<void> {
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  for (const a of addrs) {
    // classifyHost also catches multicast, reserved and documentation ranges and
    // every IPv6 spelling of an IPv4 address (audit 23 Nov 2026, I-5).
    if (classifyHost(a) === "forbidden") {
      throw new Error(`Address ${a} is not allowed for a connector (loopback, link-local or reserved).`);
    }
  }
}

// ── REST ─────────────────────────────────────────────────────────────────────

async function readRest(c: PullConnector, secret: string | null): Promise<Reading[]> {
  const cfg = c.config as Record<string, any>;
  const url = String(cfg.url ?? "");
  const check = checkOutboundUrl(url);
  if (!check.ok) throw new Error(check.error);
  const headers: Record<string, string> = { Accept: "application/json" };
  for (const [k, v] of Object.entries((cfg.headers ?? {}) as Record<string, unknown>)) if (typeof v === "string") headers[k] = v;
  if (cfg.authType === "bearer" && secret) headers.Authorization = `Bearer ${secret}`;
  if (cfg.authType === "api_key" && secret) headers[String(cfg.apiKeyHeader || "X-API-Key")] = secret;
  if (cfg.authType === "basic" && cfg.basicUser) headers.Authorization = `Basic ${Buffer.from(`${cfg.basicUser}:${secret ?? ""}`).toString("base64")}`;
  const method = cfg.method === "POST" ? "POST" : "GET";
  if (method === "POST") headers["Content-Type"] = "application/json";
  const r = await safeFetch(url, { method, headers, body: method === "POST" ? String(cfg.body ?? "{}") : undefined, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  return toReadings(atPath(json, cfg.recordsPath), {
    deviceId: cfg.deviceId, deviceIdField: cfg.deviceIdField, timestampField: cfg.timestampField, fields: cfg.fields,
  });
}

// ── PostgreSQL ───────────────────────────────────────────────────────────────

export function assertSelectOnly(query: string): void {
  const q = query.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(q)) throw new Error("The query must start with SELECT or WITH.");
  if (q.includes(";")) throw new Error("Only one statement is allowed.");
}

async function readSql(c: PullConnector, secret: string | null): Promise<{ readings: Reading[]; watermark?: unknown }> {
  const cfg = c.config as Record<string, any>;
  if (!secret) throw new Error("No connection string is stored for this connector.");
  const query = String(cfg.query ?? "");
  assertSelectOnly(query);
  const host = new URL(secret).hostname;
  await assertConnectorHost(host);
  const pool = new PgPool({ connectionString: secret, max: 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 1_000 });
  try {
    const client = await pool.connect();
    try {
      // Read-only transaction with a time limit: a connector can never change the source.
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = 15000");
      const params = query.includes("$1") ? [cfg.watermark ?? null] : [];
      const result = await client.query(query, params);
      await client.query("COMMIT");
      const rows = result.rows.slice(0, MAX_RECORDS) as Record<string, unknown>[];
      const readings = toReadings(rows, { deviceId: cfg.deviceId, deviceIdField: cfg.deviceIdColumn, timestampField: cfg.timestampColumn, fields: cfg.fields });
      const wm = cfg.watermarkColumn && rows.length ? rows[rows.length - 1]![cfg.watermarkColumn] : undefined;
      return { readings, watermark: wm instanceof Date ? wm.toISOString() : wm };
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

// ── Modbus TCP ───────────────────────────────────────────────────────────────

export interface ModbusRegister { name: string; address: number; function?: "holding" | "input"; type?: "uint16" | "int16" | "uint32" | "int32" | "float32"; scale?: number; wordOrder?: "big" | "little" }

const WORDS: Record<string, number> = { uint16: 1, int16: 1, uint32: 2, int32: 2, float32: 2 };

/** Decode registers (big-endian bytes; word order selectable for 32-bit values). */
export function decodeRegisters(words: number[], type: ModbusRegister["type"] = "uint16", wordOrder: "big" | "little" = "big"): number {
  const buf = Buffer.alloc(4);
  if ((WORDS[type] ?? 1) === 1) {
    buf.writeUInt16BE(words[0]! & 0xffff, 0);
    return type === "int16" ? buf.readInt16BE(0) : buf.readUInt16BE(0);
  }
  const [hi, lo] = wordOrder === "little" ? [words[1]!, words[0]!] : [words[0]!, words[1]!];
  buf.writeUInt16BE(hi & 0xffff, 0); buf.writeUInt16BE(lo & 0xffff, 2);
  return type === "int32" ? buf.readInt32BE(0) : type === "float32" ? buf.readFloatBE(0) : buf.readUInt32BE(0);
}

/** One Modbus TCP request/response on an open socket. */
function modbusRead(socket: net.Socket, txId: number, unitId: number, fn: 3 | 4, address: number, count: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const req = Buffer.alloc(12);
    req.writeUInt16BE(txId, 0); req.writeUInt16BE(0, 2); req.writeUInt16BE(6, 4);
    req.writeUInt8(unitId, 6); req.writeUInt8(fn, 7); req.writeUInt16BE(address, 8); req.writeUInt16BE(count, 10);
    let chunks = Buffer.alloc(0);
    const timer = setTimeout(() => { cleanup(); reject(new Error("Modbus device did not answer within 5 s")); }, 5_000);
    const onData = (d: Buffer) => {
      chunks = Buffer.concat([chunks, d]);
      if (chunks.length < 9) return;
      const len = chunks.readUInt16BE(4);
      if (chunks.length < 6 + len) return;
      cleanup();
      const code = chunks.readUInt8(7);
      if (code & 0x80) { reject(new Error(`Modbus exception ${chunks.readUInt8(8)} at address ${address}`)); return; }
      const bytes = chunks.readUInt8(8);
      const words: number[] = [];
      for (let i = 0; i < bytes / 2; i++) words.push(chunks.readUInt16BE(9 + i * 2));
      resolve(words);
    };
    const onError = (e: Error) => { cleanup(); reject(e); };
    function cleanup() { clearTimeout(timer); socket.off("data", onData); socket.off("error", onError); }
    socket.on("data", onData); socket.on("error", onError);
    socket.write(req);
  });
}

async function readModbus(c: PullConnector): Promise<Reading[]> {
  const cfg = c.config as Record<string, any>;
  const host = String(cfg.host ?? "");
  const port = Number(cfg.port ?? 502);
  const unitId = Number(cfg.unitId ?? 1);
  const registers = (Array.isArray(cfg.registers) ? cfg.registers : []) as ModbusRegister[];
  if (!host || !registers.length) throw new Error("Set a host and at least one register.");
  if (!cfg.deviceId) throw new Error("Set the device id (the asset identifier) the readings belong to.");
  await assertConnectorHost(host);
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.createConnection({ host, port, timeout: 5_000 }, () => resolve(s));
    s.once("error", reject);
    s.once("timeout", () => { s.destroy(); reject(new Error(`Could not connect to ${host}:${port} within 5 s`)); });
  });
  try {
    const metrics: Record<string, unknown> = {};
    let tx = 1;
    for (const reg of registers.slice(0, 200)) {
      const count = WORDS[reg.type ?? "uint16"] ?? 1;
      const words = await modbusRead(socket, tx++, unitId, reg.function === "input" ? 4 : 3, Number(reg.address), count);
      const value = decodeRegisters(words, reg.type, reg.wordOrder);
      metrics[reg.name] = reg.scale ? value * reg.scale : value;
    }
    return [{ deviceId: String(cfg.deviceId), timestamp: new Date(), metrics }];
  } finally {
    socket.destroy();
  }
}

// ── Run one connector ────────────────────────────────────────────────────────

export async function runConnector(c: PullConnector, opts: { dryRun?: boolean } = {}): Promise<RunResult> {
  if (c.type === "opcua") {
    return { ok: false, status: "skipped", records: 0, stored: 0, error: "OPC UA connectors are saved but do not run yet. An OPC UA client library still has to be added to the server." };
  }
  let secret: string | null = null;
  try { secret = decryptSecret(c.secretEnc, secretContext(c.id)); } catch { return { ok: false, status: "error", records: 0, stored: 0, error: "Stored secret could not be decrypted" }; }

  let readings: Reading[] = [];
  let watermark: unknown;
  try {
    if (c.type === "rest") readings = await readRest(c, secret);
    else if (c.type === "sql") ({ readings, watermark } = await readSql(c, secret));
    else if (c.type === "modbus") readings = await readModbus(c);
    else return { ok: false, status: "error", records: 0, stored: 0, error: `Unknown connector type ${c.type}` };
  } catch (err) {
    return { ok: false, status: "error", records: 0, stored: 0, error: (err as Error).message?.slice(0, 500) ?? "Read failed" };
  }
  if (opts.dryRun) return { ok: true, status: "ok", records: readings.length, stored: 0, preview: readings.slice(0, 5) };

  let scope: Set<string> | null = null;
  if (c.projectId) {
    const assets = await db.select({ id: assetsTable.id, parentId: assetsTable.parentId }).from(assetsTable);
    scope = assetSubtree([c.projectId], assets);
  }
  let stored = 0;
  for (const r of readings) {
    const n: NormalisedPayload = { deviceId: r.deviceId, timestamp: r.timestamp, metrics: r.metrics, payloadFormat: "flat" };
    try {
      const result = await processNormalised(n, undefined, true, scope);
      stored += result.recordsWritten;
    } catch (err) {
      logger.warn({ connectorId: c.id, err: (err as Error).message }, "Connector reading could not be stored");
    }
  }
  if (c.type === "sql" && watermark !== undefined) {
    await db.update(pullConnectorsTable).set({ config: { ...(c.config as object), watermark } }).where(eq(pullConnectorsTable.id, c.id));
  }
  return { ok: true, status: "ok", records: readings.length, stored };
}

async function recordRun(c: PullConnector, r: RunResult): Promise<void> {
  await db.update(pullConnectorsTable).set({
    lastRunAt: new Date(), lastStatus: r.status, lastError: r.error ?? null,
    ...(r.ok ? { lastSuccessAt: new Date() } : {}),
    runCount: sql`${pullConnectorsTable.runCount} + 1`,
    recordsRead: sql`${pullConnectorsTable.recordsRead} + ${r.records}`,
  }).where(eq(pullConnectorsTable.id, c.id));
  // Report a connector that starts failing once, not on every run.
  if (!r.ok && r.status === "error" && c.lastStatus !== "error") {
    emitLater("connector.error", { projectId: c.projectId, payload: { connectorId: c.id, name: c.name, type: c.type, error: r.error } });
  }
}

export async function runAndRecord(c: PullConnector): Promise<RunResult> {
  const r = await runConnector(c);
  await recordRun(c, r).catch((err) => logger.warn({ err: (err as Error).message }, "Connector run not recorded"));
  return r;
}

// ── Scheduler ────────────────────────────────────────────────────────────────

const runningIds = new Set<string>();
let timer: NodeJS.Timeout | null = null;
let lastFailureLog = 0;

async function tick(): Promise<void> {
  let list: PullConnector[];
  try {
    list = await db.select().from(pullConnectorsTable).where(eq(pullConnectorsTable.enabled, true));
  } catch (err) {
    if (Date.now() - lastFailureLog > 300_000) { lastFailureLog = Date.now(); logger.warn({ err: (err as Error).message }, "Connector scheduler could not load connectors"); }
    return;
  }
  const now = Date.now();
  for (const c of list) {
    if (c.type === "opcua" || runningIds.has(c.id)) continue;
    const interval = Math.min(86_400, Math.max(5, c.intervalSec)) * 1000;
    if (c.lastRunAt && now - c.lastRunAt.getTime() < interval) continue;
    runningIds.add(c.id);
    void runAndRecord(c).finally(() => runningIds.delete(c.id));
  }
}

export function startConnectorScheduler(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, 5_000);
  timer.unref();
}

export function stopConnectorScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
