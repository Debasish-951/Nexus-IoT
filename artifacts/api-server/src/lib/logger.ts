import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Application logger.
 *
 * ── What goes here that must never go to a client ────────────────────────────
 *
 * Stack traces, Postgres constraint names, upstream hostnames, the id of the
 * signed-in user. The whole error-handling design is to move that detail from
 * the response into this stream — which only works if the stream is protected.
 *
 * ── Destination ──────────────────────────────────────────────────────────────
 *
 * The logger writes JSON lines to stdout (pretty-printed outside production)
 * and never opens a file. On the VM the systemd unit leaves stdout to journald,
 * so the journal is the one log store: read access is the `systemd-journal`
 * (and on Debian/Ubuntu `adm`) group, and retention is journald's. The unit,
 * the permissions and the retention settings are in
 * `docs/operations/vm-deployment-checklist.md` (Step 5) and `.env.example`.
 * The guarantees this file can make are the ones below.
 *
 * ── Redaction ────────────────────────────────────────────────────────────────
 *
 * The list was previously three header paths and applied only to the base
 * logger, while `pino-http` in app.ts carried its own, slightly wider list. Two
 * partial lists is how one of them ends up missing the header that matters — so
 * this is now the single set and app.ts reuses it.
 *
 * `remove: true` rather than the default "[Redacted]" placeholder: a redacted
 * placeholder still records that a credential WAS present and how the request
 * was authenticated, which is more than a log needs to say.
 */
export const REDACT_PATHS = [
  // Request credentials, at every nesting pino might serialise them under.
  "req.headers.cookie",
  "req.headers.authorization",
  "req.headers['x-api-key']",
  "req.headers['x-csrf-token']",
  "headers.cookie",
  "headers.authorization",
  "headers['x-api-key']",
  "res.headers['set-cookie']",

  // Body fields. An error logged with its request body is the most common way a
  // password reaches a log file — the login route logs failures, and the body of
  // a login request is a password.
  "*.password",
  "*.newPassword",
  "*.currentPassword",
  "*.clientSecret",
  "*.token",
  "*.secretKey",
  "*.basicPass",
  "*.mqttPassword",
  "req.body.password",
  "req.body.newPassword",
  "req.body.currentPassword",
];

/**
 * Mask credentials that travel in the URL path before a path is logged:
 * activation and password-reset tokens, and copy-and-paste ingest URL tokens.
 * Anyone able to read the logs could otherwise use a pending reset link or a
 * working ingest URL.
 */
export function redactPath(path: string | undefined): string | undefined {
  if (!path) return path;
  return path
    .replace(/(\/auth\/(?:activation|reset)\/)[^/?#]+/i, "$1[token]")
    .replace(/(\/ingest\/e\/)[^/?#]+/i, "$1[token]");
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: REDACT_PATHS, remove: true },

  // Errors are serialised with their stack. That is the point of the log and the
  // reason it must not be world-readable.
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
