import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { logger } from "./logger";

/**
 * Error taxonomy and the single place a server error becomes a client response.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * A message is shown to a user ONLY if someone deliberately wrote it for a user.
 * Everything else — a thrown Error, a driver failure, a rejected fetch — becomes
 * a generic message plus a correlation id. There is no path where an unplanned
 * error string reaches a client.
 *
 * That inversion matters because the leaks in this codebase were not careless.
 * They were `res.status(400).json({ error: err.message })` in a catch block,
 * written when the only thing that could throw was something harmless. The set
 * of things that can throw grows; the catch block does not get revisited.
 *
 * ── Why not gate on NODE_ENV ─────────────────────────────────────────────────
 *
 * The previous handler returned `err.message` whenever `NODE_ENV !== production`.
 * That is fail-OPEN: the one configuration mistake most likely to happen on a
 * self-hosted VM — forgetting to set NODE_ENV — is exactly the one that turns
 * every internal error into a public disclosure, silently, with no other symptom.
 *
 * Detail is now gated on `DEBUG_ERRORS=true`, an explicit opt-in that nothing
 * sets by accident. Getting it wrong costs a developer some convenience instead
 * of exposing a database schema.
 */

/**
 * Explicit opt-in, not derived from NODE_ENV (see above). It can still only be
 * switched OFF by NODE_ENV: with NODE_ENV=production, DEBUG_ERRORS is ignored and
 * a warning is logged at start-up (audit 23 Nov 2026, I-3), so a debugging flag
 * left in a production .env cannot send stack traces to browsers.
 */
export function debugErrorsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const requested = /^(1|true|yes|on)$/i.test(env.DEBUG_ERRORS ?? "");
  return requested && env.NODE_ENV !== "production";
}
const includeDetail = debugErrorsEnabled();
if (!includeDetail && /^(1|true|yes|on)$/i.test(process.env.DEBUG_ERRORS ?? "")) {
  logger.error("DEBUG_ERRORS is set but IGNORED because NODE_ENV=production: error responses carry no stack traces. Remove DEBUG_ERRORS from the production environment.");
}

// ── Correlation ──────────────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

/**
 * A short, unguessable id tying a client-visible failure to a log line.
 *
 * Random rather than sequential: pino-http's default is a per-process counter,
 * which restarts at 1 on every deploy, so "error 47" matches many different
 * events across a week of logs. It also leaks request volume.
 */
export function newCorrelationId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

export function correlationIdOf(req: Request): string {
  if (!req.correlationId) req.correlationId = newCorrelationId();
  return req.correlationId;
}

// ── Deliberate, user-facing errors ───────────────────────────────────────────

/**
 * An error whose message was WRITTEN for the user.
 *
 * Anything thrown as an AppError is safe to display, because a human chose the
 * wording. Everything else is treated as internal.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  /** Internal-only context. Logged, never returned. */
  readonly detail?: Record<string, unknown>;

  constructor(status: number, code: string, publicMessage: string, detail?: Record<string, unknown>) {
    super(publicMessage);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (msg: string, code = "invalid_request", detail?: Record<string, unknown>) =>
  new AppError(400, code, msg, detail);
export const notFound = (what = "The requested item") =>
  new AppError(404, "not_found", `${what} could not be found.`);
export const conflict = (msg: string, code = "conflict") =>
  new AppError(409, code, msg);

// ── Database errors ──────────────────────────────────────────────────────────

/**
 * Postgres error codes worth translating into something a user can act on.
 *
 * The driver's own message is never reused. `duplicate key value violates unique
 * constraint "assets_identifier_unique"` tells the user nothing they can act on
 * and tells an attacker the table name, the column name, and that an index
 * exists on it. Worse, the DETAIL line of a unique violation contains the
 * conflicting VALUE, which on a users table discloses whether an email is
 * registered.
 *
 * So the mapping is deliberately coarse: it says WHAT went wrong in domain
 * terms and nothing about the schema.
 */
const PG_MESSAGES: Record<string, { status: number; code: string; message: string }> = {
  "23505": { status: 409, code: "already_exists",     message: "Something with those details already exists." },
  "23503": { status: 409, code: "in_use",             message: "That change refers to something that does not exist, or is still in use elsewhere." },
  "23502": { status: 400, code: "missing_required",   message: "A required value was missing." },
  "23514": { status: 400, code: "invalid_value",      message: "One of the values is outside the allowed range." },
  "22P02": { status: 400, code: "invalid_value",      message: "One of the values was not in the expected format." },
  "22001": { status: 400, code: "value_too_long",     message: "One of the values is too long." },
  "40001": { status: 409, code: "conflict",           message: "That change conflicted with another update. Please try again." },
  "40P01": { status: 409, code: "conflict",           message: "That change conflicted with another update. Please try again." },
  "53300": { status: 503, code: "unavailable",        message: "The service is busy. Please try again shortly." },
  "57014": { status: 504, code: "timeout",            message: "That took too long to complete. Try narrowing the request." },
};

/**
 * The PostgreSQL error inside a query error. Drizzle wraps every driver error in
 * a DrizzleQueryError whose own `code` is undefined and whose message holds the
 * full SQL and parameter values; the driver's error is its `cause`.
 */
function pgErrorOf(err: unknown): unknown {
  const cause = (err as { cause?: unknown })?.cause;
  return cause && typeof (cause as { code?: unknown }).code === "string" ? cause : err;
}

function pgCodeOf(err: unknown): string | null {
  const code = (pgErrorOf(err) as { code?: unknown })?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

/**
 * An error safe to write to the log. A wrapped query error is replaced by its
 * driver error's name, message and code, so parameter values (password hashes,
 * tokens, personal data) and the driver's `detail` (which repeats key values) are
 * never logged. Other errors pass through unchanged.
 */
export function loggableError(err: unknown): unknown {
  const e = err as { query?: unknown; params?: unknown; stack?: string };
  if (e && typeof e === "object" && "query" in e && "params" in e) {
    const pg = pgErrorOf(err) as { name?: string; message?: string; code?: string; constraint?: string; table?: string };
    return {
      type: "DrizzleQueryError",
      message: pg && pg !== err ? pg.message : "Database query failed",
      code: pg?.code, constraint: pg?.constraint, table: pg?.table,
      // Stack frames only: the first line of the wrapper's stack repeats its message.
      stack: e.stack?.split("\n").filter((l) => l.trimStart().startsWith("at ")).join("\n"),
    };
  }
  return err;
}

// ── Framework errors that already carry a status ─────────────────────────────
//
// `express.json()` and friends throw `http-errors` objects: a malformed body is
// a 400 with `type: "entity.parse.failed"`, an oversized one a 413. Without this
// they fall through to the catch-all and are answered with 500 — which is both
// wrong (the client caused it and can fix it) and actively harmful, because a
// stream of client-side mistakes then looks like the server failing and buries
// real incidents in whatever watches the 5xx rate.
//
// The message is OURS, keyed off the status. `http-errors` marks its own text
// safe to expose via `expose`, and for a parse failure it is
// "Unexpected token b in JSON at position 9" — harmless, but it describes the
// parser rather than telling the caller anything actionable.
const HTTP_ERROR_MESSAGES: Record<number, { code: string; message: string }> = {
  400: { code: "malformed_request", message: "The request could not be read. Check that the body is valid JSON." },
  413: { code: "payload_too_large", message: "The request is too large." },
  414: { code: "uri_too_long",      message: "The request URL is too long." },
  415: { code: "unsupported_media", message: "That content type is not supported. Send JSON." },
  429: { code: "rate_limited",      message: "Too many requests. Please slow down and try again." },
};

function httpStatusOf(err: unknown): number | null {
  const e = err as { status?: unknown; statusCode?: unknown; expose?: unknown };
  const status = typeof e?.status === "number" ? e.status
    : typeof e?.statusCode === "number" ? e.statusCode
    : null;
  // Only trust a status the thrower explicitly marked as client-facing. An
  // arbitrary object with a `status` field is not necessarily an http-error, and
  // a 5xx must never be reclassified as safe.
  if (status === null || status < 400 || status >= 500) return null;
  return e?.expose === true ? status : null;
}

// ── Classification ───────────────────────────────────────────────────────────

export interface PublicError {
  status: number;
  body: {
    error: string;
    code: string;
    correlationId: string;
    /** Present only when DEBUG_ERRORS=true. */
    debug?: { message: string; stack?: string };
  };
}

/**
 * The one function that decides what a client is allowed to see.
 *
 * Order matters: deliberate errors first, then recognised infrastructure
 * failures translated into domain language, then the catch-all. The catch-all
 * never inspects the error — if it did, someone would eventually widen it.
 */
export function toPublicError(err: unknown, correlationId: string): PublicError {
  const debug = includeDetail && err instanceof Error
    ? { message: err.message, stack: err.stack }
    : undefined;

  if (err instanceof AppError) {
    return { status: err.status, body: { error: err.message, code: err.code, correlationId, ...(debug ? { debug } : {}) } };
  }

  const pg = pgCodeOf(err);
  if (pg && PG_MESSAGES[pg]) {
    const m = PG_MESSAGES[pg];
    return { status: m.status, body: { error: m.message, code: m.code, correlationId, ...(debug ? { debug } : {}) } };
  }

  const http = httpStatusOf(err);
  if (http) {
    const m = HTTP_ERROR_MESSAGES[http] ?? { code: "invalid_request", message: "The request could not be accepted." };
    return { status: http, body: { error: m.message, code: m.code, correlationId, ...(debug ? { debug } : {}) } };
  }

  // Anything else: a bug, a driver failure, an upstream refusing a connection.
  // The user gets one sentence and an id. The specifics are in the log.
  return {
    status: 500,
    body: {
      error: "Something went wrong on our side. Quote the reference below if you report this.",
      code: "internal_error",
      correlationId,
      ...(debug ? { debug } : {}),
    },
  };
}

/**
 * Whether this error is worth a full stack trace in the log.
 *
 * A 400 caused by a user typing badly is not an incident, and logging a stack
 * for every one of them buries the errors that matter. Server-side failures and
 * unrecognised errors always get the stack.
 */
export function isExpected(err: unknown): boolean {
  if (err instanceof AppError) return err.status < 500;
  if (httpStatusOf(err) !== null) return true;   // malformed body, oversized payload
  const pg = pgCodeOf(err);
  return !!(pg && PG_MESSAGES[pg] && PG_MESSAGES[pg].status < 500);
}

/**
 * Fields safe to attach to a log line describing an error.
 *
 * Includes the Postgres code and constraint name deliberately — they belong in
 * the LOG, where they are the fastest route to a diagnosis, and are exactly what
 * must not appear in the response.
 */
export function logContext(err: unknown): Record<string, unknown> {
  const e = pgErrorOf(err) as { code?: unknown; constraint?: unknown; table?: unknown; detail?: unknown; name?: unknown };
  return {
    kind: err instanceof AppError ? "AppError" : (e?.name ?? typeof err),
    ...(typeof e?.code === "string" ? { pgCode: e.code } : {}),
    ...(typeof e?.constraint === "string" ? { constraint: e.constraint } : {}),
    ...(typeof e?.table === "string" ? { table: e.table } : {}),
  };
}
