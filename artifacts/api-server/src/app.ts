import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authConfig } from "./lib/auth-config";
import { attachPrincipal, stripForgedActorHeaders } from "./middleware/principal";
import { attachApiClient } from "./middleware/apiKeyAuth";
import { csrfGuard } from "./middleware/csrf";
import { authorize } from "./middleware/authorize";

const app: Express = express();

// Behind Replit's proxy, `req.ip` and `secure` cookies only work correctly when
// Express is told to trust the forwarding hop.
if (authConfig.isProd) app.set("trust proxy", 1);
// Do not advertise the framework.
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
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
    // Never let a session cookie or an Authorization header reach the log.
    redact: {
      paths: ["req.headers.cookie", "req.headers.authorization", "req.headers['x-api-key']"],
      remove: true,
    },
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
  exposedHeaders: ["Retry-After"],
  maxAge: 600,
}));

app.use(cookieParser());
// Bound the request body: the ingest endpoints accept batches, but 1 MB is far
// above any legitimate payload and stops a trivial memory-exhaustion attempt.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── Authentication → CSRF → authorisation ────────────────────────────────────
//
// Order matters and is the whole security model:
//   1. attachPrincipal resolves the session cookie into req.principal (never rejects)
//   2. attachApiClient resolves a machine credential into req.apiClient (never rejects).
//      This has to precede `authorize`, or existing /export integrations would be
//      401'd before reaching the route-level apiKeyAuth that checks their scope.
//   3. stripForgedActorHeaders removes client-supplied X-Actor-* when unauthenticated
//   4. csrfGuard rejects cross-site writes on cookie-authenticated requests
//   5. authorize makes the single allow/deny decision, deny-by-default
//
// Mounted on /api as a whole so no route file can forget its guard.
app.use("/api", attachPrincipal, attachApiClient, stripForgedActorHeaders, csrfGuard, authorize);

app.use("/api", router);

// ── Error handler ────────────────────────────────────────────────────────────
//
// Express 5 forwards rejected async handlers here. Without it, an unhandled
// rejection in a route would leak a stack trace to the client.
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, method: req.method, path: req.path }, "unhandled error");
  if (res.headersSent) return;
  res.status(500).json({
    error: authConfig.isProd ? "Internal server error" : err.message,
    code: "internal_error",
  });
});

export default app;
