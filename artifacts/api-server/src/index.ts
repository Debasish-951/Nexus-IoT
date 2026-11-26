import "dotenv/config";
import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { startMqttSubscribers, stopMqttSubscribers } from "./services/mqtt.js";
import { pool } from "@workspace/db";
import { initWebSocketServer, closeWebSocketServer } from "./lib/ws-broadcast";
import { runPruning, runOperationalPruning, runScheduledRetention } from "./routes/system";
import { startRollupJob } from "./services/rollups";
import { computeStorage } from "./routes/system";
import { startAlertJob } from "./services/system-alerts";
import { startIngestRejectionFlush } from "./services/ingest-rejections";
import { ensureFuturePartitions } from "./services/partitions";
import { loadSeenDevices } from "./lib/seen-devices";
import { assertAuthConfigSane } from "./lib/auth-config";
import { logSecretsReport } from "./lib/secrets";
import { initSecretBox } from "./lib/secret-box";
import { ensureUploadRoot } from "./lib/upload/storage";
import { ensureAuditStore } from "./lib/audit-store";
import { reportScannerStatus } from "./lib/upload/scanner";
import { pruneExpiredSessions } from "./lib/sessions";
import { pruneSecurityEvents } from "./lib/security-log";
import { assertNoPublicApiKey } from "./lib/public-api-key";
import { warnLegacyPlaintextSecrets } from "./middleware/apiKeyAuth";
import { startDeliveryWorker, stopDeliveryWorker, pruneIntegrationData } from "./services/delivery-worker";
import { startConnectorScheduler, stopConnectorScheduler } from "./services/connectors";
import { startRequestLogFlush, flushRequestLog, pruneApiLogs } from "./lib/integration/client-auth";
import { pruneIdempotencyKeys } from "./lib/integration/idempotency";

// Last-resort handlers. A rejected promise nobody awaited (a background job, a
// library callback) would otherwise stop the process under Node's default
// behaviour, taking ingest down for every client. It is logged and the process
// keeps serving. An uncaught exception leaves state unknown, so it is logged and
// the process exits for systemd to restart it cleanly.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception; exiting so the service manager can restart the API");
  process.exit(1);
});

// Fail fast, before the port is bound, on a configuration that would be unsafe
// in this environment (e.g. activation links printed to the log in production).
assertAuthConfigSane();
// Load the encryption key ring before anything can read a credential, and report
// what was loaded — provenance and fingerprints only, never values.
initSecretBox();
logSecretsReport();
// Storage directory and scanner reachability are reported at boot, so a
// misconfiguration surfaces then rather than on the first upload.
// Audit log: append-only trigger and hash backfill (logs and continues on failure).
void ensureAuditStore();

ensureUploadRoot().catch((err) => {
  // Uploads then fail per request with a clear error, instead of the whole API
  // stopping at boot (and restarting in a loop under systemd).
  logger.error({ err }, "Upload storage directory is not usable; uploads will fail until it is fixed");
});
void reportScannerStatus();

// PORT is overridable by the environment (systemd unit, container, shell).
// Defaults to 8080, which is the target the frontend dev proxy expects — see the
// `proxy` block in artifacts/iot-platform/vite.config.ts.
const rawPort = process.env["PORT"] ?? "8080";
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Interface to listen on. Unset keeps the previous behaviour, every interface,
// so nothing changes for an installation that does not set it. Behind nginx on
// the same VM it should be 127.0.0.1: port 8080 is then unreachable from the
// network, so nothing can bypass nginx's TLS, its X-Forwarded-For handling or
// its WebSocket path, and per-key IP allowlists see the real client address.
// See docs/operations/vm-deployment-checklist.md.
const host = process.env["HOST"]?.trim() || undefined;

// Refuses to start in production while a key with the published seed secret is
// active. Runs before the port is bound, so the API never serves with it.
await assertNoPublicApiKey();

const server = http.createServer(app);
initWebSocketServer(server);

server.listen(port, host, () => {
  logger.info({ port, host: host ?? "all interfaces" }, "Server listening");

  // Legacy plaintext API secrets still authenticate until the operator runs the
  // migration; say so once per client at every start until they have.
  warnLegacyPlaintextSecrets()
    .catch((e) => logger.warn({ err: e }, "Legacy API secret check failed"));

  // Load the persisted seen-device registry (+ existing asset identifiers) so the
  // device list and match-on-create rule survive restarts.
  loadSeenDevices()
    .then((n) => logger.info({ devices: n }, "Loaded seen-device registry"))
    .catch((e) => logger.warn({ err: e }, "Seen-device load failed"));

  startMqttSubscribers().catch((e) => {
    logger.warn({ err: e }, "MQTT subscriber startup failed — will retry on next broker save");
  });

  // Background data-retention pruning — runs every hour
  const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
  // Hourly telemetry summaries (services/rollups.ts): Data Management counts,
  // retention previews and long-term chart data. Pruning waits for them.
  startRollupJob();
  // Storage / backup / pipeline alerts every 10 minutes (Data Management > Overview).
  startAlertJob(computeStorage);
  startIngestRejectionFlush();
  // Integration Hub: queued destination deliveries, pull connectors (only
  // enabled ones run), and the buffered per-client request log.
  startDeliveryWorker();
  startConnectorScheduler();
  startRequestLogFlush();
  ensureFuturePartitions().catch((e) => logger.warn({ err: e }, "Partition maintenance failed"));
  setInterval(() => {
    // Telemetry policies, then alarms, history, logs, broker events, auth tokens,
    // old summaries and the pruning history; recorded as one pruning-history row.
    runScheduledRetention()
      .catch((e) => logger.warn({ err: e }, "Retention run error"));
    // Previous direct calls, now made inside runScheduledRetention:
    void runPruning; void runOperationalPruning;

    // Sessions that can never authenticate again are kept for 7 days (so recent
    // activity stays reviewable in the Security Center) and then dropped.
    pruneExpiredSessions()
      .then((n) => { if (n > 0) logger.info({ sessions: n }, "Pruned expired sessions"); })
      .catch((e) => logger.warn({ err: e }, "Session pruning error"));

    // Audit retention. Age-based first, then an absolute row cap — see
    // lib/security-log.ts for why the cap exists alongside the age limit.
    pruneSecurityEvents()
      .catch((e) => logger.warn({ err: e }, "Security event pruning error"));

    // Integration Hub logs: delivery log + outbox, API request log, expired
    // OAuth tokens and day-old idempotency keys.
    Promise.all([pruneIntegrationData(), pruneApiLogs(), pruneIdempotencyKeys()])
      .catch((e) => logger.warn({ err: (e as Error).message }, "Integration log pruning error"));
  }, PRUNE_INTERVAL_MS);
});

server.on("error", (err) => {
  logger.error({ err }, "Server error");
  process.exit(1);
});

// Graceful shutdown on `systemctl stop|restart` (SIGTERM) and Ctrl+C (SIGINT).
// Stop taking new requests, let requests in flight finish (an ingest post is a
// few queries), stop MQTT and live connections, then close the database pool.
// A hard exit after 10 seconds keeps a stuck request from blocking a restart.
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  const force = setTimeout(() => {
    logger.warn("Shutdown took longer than 10 s; exiting");
    process.exit(1);
  }, 10_000);
  force.unref();

  closeWebSocketServer();
  void stopMqttSubscribers();
  stopDeliveryWorker();
  stopConnectorScheduler();
  void flushRequestLog();
  server.close(() => {
    pool.end()
      .catch((err) => logger.warn({ err }, "Database pool did not close cleanly"))
      .finally(() => {
        logger.info("Shutdown complete");
        process.exit(0);
      });
  });
  // Idle keep-alive connections would otherwise hold server.close open.
  server.closeIdleConnections();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
