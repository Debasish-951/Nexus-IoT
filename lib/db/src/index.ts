import dotenv from "dotenv";
import path from "path";
dotenv.config({
 path: path.resolve(process.cwd(), "../../.env"),
});
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
const { Pool } = pg;
if (!process.env.DATABASE_URL) {
 throw new Error(
 "DATABASE_URL must be set. Did you forget to provision a database?",
 );
}

/** A positive integer from the environment, or the default when unset or invalid. */
function intEnv(name: string, fallback: number): number {
 const raw = process.env[name];
 if (raw === undefined || raw.trim() === "") return fallback;
 const n = Number(raw);
 return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * TLS for the database connection.
 *
 * An `sslmode` in DATABASE_URL always wins: node-postgres parses the connection
 * string after the options below, so `?sslmode=require` (or `verify-full`) is
 * honoured as written. DB_SSL=true turns TLS on for a URL without sslmode;
 * DB_SSL_REJECT_UNAUTHORIZED=false accepts a self-signed server certificate,
 * which some managed databases use, at the cost of server identity checks.
 */
function sslOption(url: string): pg.PoolConfig["ssl"] {
 if (/[?&]sslmode=/i.test(url)) return undefined;
 const flag = (process.env.DB_SSL ?? "").trim().toLowerCase();
 if (flag === "true" || flag === "1" || flag === "require") {
  return { rejectUnauthorized: (process.env.DB_SSL_REJECT_UNAUTHORIZED ?? "true").trim().toLowerCase() !== "false" };
 }
 return undefined;
}

const databaseUrl = process.env.DATABASE_URL;
const ssl = sslOption(databaseUrl);

/**
 * Pool limits and timeouts. The defaults used to be node-postgres's own: no
 * statement timeout, so one heavy dashboard query could hold a connection for
 * minutes while ingest queued behind it.
 */
export const pool = new Pool({
 connectionString: databaseUrl,
 ssl,
 max: intEnv("DB_POOL_MAX", 10) || 10,
 // A query running longer than this is cancelled by PostgreSQL. 0 disables.
 statement_timeout: intEnv("DB_STATEMENT_TIMEOUT_MS", 30_000),
 // A transaction left open and idle (a bug, a crashed handler) is ended.
 idle_in_transaction_session_timeout: intEnv("DB_IDLE_IN_TRANSACTION_TIMEOUT_MS", 60_000),
 // How long to wait for a new connection before the query fails.
 connectionTimeoutMillis: intEnv("DB_CONNECTION_TIMEOUT_MS", 10_000),
 // Idle connections are closed after this.
 idleTimeoutMillis: intEnv("DB_IDLE_TIMEOUT_MS", 30_000),
});

if (process.env.NODE_ENV === "production" && !ssl && !/[?&]sslmode=/i.test(databaseUrl)) {
 let host = "";
 try { host = new URL(databaseUrl).hostname; } catch { /* unparseable: pg reports it */ }
 if (host && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  console.warn(`[db] DATABASE_URL points at ${host} without TLS. Add ?sslmode=verify-full or set DB_SSL=true.`);
 }
}

// An idle client can fail when PostgreSQL restarts or drops a connection. Without
// a listener, node-postgres raises that as an uncaught "error" event and the
// process exits. The pool discards the broken client and opens a new one on the
// next query, so logging is all that is needed here.
pool.on("error", (err) => {
 console.error(`[db] Idle database connection failed: ${err.message}`);
});
export const db = drizzle(pool, { schema });
export * from "./schema";

/** The pg Pool class, for code that must open its own short-lived connection (pull connectors reading an external PostgreSQL). */
export const PgPool = Pool;
