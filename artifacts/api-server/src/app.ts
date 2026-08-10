import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger, REDACT_PATHS } from "./lib/logger";
import { authConfig } from "./lib/auth-config";
import { attachPrincipal, stripForgedActorHeaders } from "./middleware/principal";
import { attachApiClient } from "./middleware/apiKeyAuth";
import { csrfGuard } from "./middleware/csrf";
import { authorize } from "./middleware/authorize";
import { floodGuard, apiRateLimit } from "./middleware/apiRateLimit";
import { requestGuard } from "./middleware/requestGuard";
import { correlationId, errorHandler, notFoundHandler } from "./middleware/errorHandler";

const app: Express = express();

// Behind a reverse proxy, `req.ip` and `secure` cookies only work correctly when
// Express is told to trust the forwarding hop — it then reads the last hop of
// `X-Forwarded-For` into `req.ip` and honours `X-Forwarded-Proto: https`.
//
// The hop count is now explicit configuration (TRUST_PROXY) rather than inferred
// from NODE_ENV, because the correct value is a property of the DEPLOYMENT and
// both wrong answers are harmful: too low behind nginx and every user shares one
// rate-limit bucket, too high and the client forges the address the limits key
// on. The default matches the reference deployment (one nginx in production,
// none in local dev). The proxy must overwrite the header, not append to it.
if (authConfig.trustProxy > 0) app.set("trust proxy", authConfig.trustProxy);
// Do not advertise the framework.
app.disable("x-powered-by");

// First, before logging: every log line this request produces should carry the
// same id the user will be shown if it fails.
app.use(correlationId);

app.use(
  pinoHttp({
    logger,
    // Use the correlation id as pino's request id, so the id in the user's error
    // message is the id in every log line for that request. pino-http's default
    // is a per-process counter that restarts at 1 on each deploy.
    genReqId: (req) => (req as unknown as { correlationId?: string }).correlationId ?? "unknown",
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
    // Shares the single redaction list with the base logger. Two partial lists
    // is how one of them ends up missing the header that matters.
    redact: { paths: REDACT_PATHS, remove: true },
  }),
);

// ── Security response headers ────────────────────────────────────────────────
//
// Hand-rolled rather than pulling in helmet: this is the subset that applies to
// a JSON API, and adding a dependency would be blocked by the workspace's
// 24-hour minimumReleaseAge policy for no real benefit.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  // API responses are never a cacheable, shareable artefact.
  res.setHeader("Cache-Control", "no-store");
  if (authConfig.isProd) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

// ── CORS ─────────────────────────────────────────────────────────────────────
//
// Was `cors()` — a wildcard origin. A wildcard is incompatible with credentialed
// requests anyway, so cookie auth forces an explicit allowlist.
app.use(cors({
  origin(origin, callback) {
    // Same-origin and non-browser callers (curl, MQTT bridge, server-to-server)
    // send no Origin header — those are not CORS requests at all.
    if (!origin) { callback(null, true); return; }
    if (authConfig.corsOrigins.includes(origin)) { callback(null, true); return; }
    logger.warn({ origin }, "CORS: rejected origin not in CORS_ORIGINS");
    callback(null, false);
  },
  credentials: true,
  allowedHeaders: [
    "Content-Type", "Authorization", "X-API-Key",
    authConfig.session.csrfHeaderName,
    "X-Actor-Name", "X-Actor-Role", "X-Actor-Username",
  ],
  // A cross-origin caller cannot read a response header unless it is exposed —
  // without this the SPA sees the 429 but not how long to wait, and the budget
  // headers would be invisible to any browser-based integration.
  exposedHeaders: [
    "Retry-After",
    "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset",
    "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset",
  ],
  maxAge: 600,
}));

app.use(cookieParser());
// Bound the request body: the ingest endpoints accept batches, but 1 MB is far
// above any legitimate payload and stops a trivial memory-exhaustion attempt.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Structural floor for every body, immediately after parsing and before anything
// reads it. Byte size is already bounded above; this bounds SHAPE — nesting
// depth, key count, and the prototype-polluting key names that survive
// JSON.parse as real own properties. Per-route `validate()` is stricter, but
// this covers routes that have no schema yet, which is the case that would
// otherwise fail silently.
app.use(requestGuard);

// ── Rate limit → authentication → CSRF → authorisation ───────────────────────
//
// Order matters and is the whole security model:
//   0. floodGuard rejects on source address alone, BEFORE any database work.
//      Placed first precisely because steps 1 and 2 each query the database:
//      a limiter mounted after them still lets an unauthenticated flood generate
//      the load it was meant to prevent.
//   1. attachPrincipal resolves the session cookie into req.principal (never rejects)
//   2. attachApiClient resolves a machine credential into req.apiClient (never rejects).
//      This has to precede `authorize`, or existing /export integrations would be
//      401'd before reaching the route-level apiKeyAuth that checks their scope.
//   3. stripForgedActorHeaders removes client-supplied X-Actor-* when unauthenticated
//   4. csrfGuard rejects cross-site writes on cookie-authenticated requests
//   5. authorize makes the single allow/deny decision, deny-by-default
//   6. apiRateLimit charges the request to its USER, which is only knowable
//      after step 1 — hence a second limiter here rather than one at the top.
//
// Mounted on /api as a whole so no route file can forget its guard.
app.use("/api", floodGuard);
app.use("/api", attachPrincipal, attachApiClient, stripForgedActorHeaders, csrfGuard, authorize);
app.use("/api", apiRateLimit);

app.use("/api", router);

// ── Not found, then errors ───────────────────────────────────────────────────
//
// Express 5 forwards rejected async handlers to the error handler, so a route
// may simply let a failure propagate and get a safe response plus a full log
// entry for free.
//
// The previous handler returned `err.message` whenever NODE_ENV was not
// "production" — fail-open on the single configuration mistake most likely to
// happen on a self-hosted VM. Detail is now behind an explicit DEBUG_ERRORS
// opt-in; see lib/errors.ts.
app.use("/api", notFoundHandler);
app.use(errorHandler);

export default app;
