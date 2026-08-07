import "dotenv/config";
import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { startMqttSubscribers } from "./services/mqtt.js";
import { initWebSocketServer } from "./lib/ws-broadcast";
import { runPruning } from "./routes/system";
import { loadSeenDevices } from "./lib/seen-devices";
import { assertAuthConfigSane } from "./lib/auth-config";
import { pruneExpiredSessions } from "./lib/sessions";

// Fail fast, before the port is bound, on a configuration that would be unsafe
// in this environment (e.g. activation links printed to the log in production).
assertAuthConfigSane();

// PORT is overridable by the environment (systemd unit, container, shell).
// Defaults to 8080, which is the target the frontend dev proxy expects — see the
// `proxy` block in artifacts/iot-platform/vite.config.ts.
const rawPort = process.env["PORT"] ?? "8080";
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
initWebSocketServer(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening");

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
  setInterval(() => {
    runPruning()
      .then((r) => { if (r.totalRowsDeleted > 0) logger.info(r, "Retention pruning completed"); })
      .catch((e) => logger.warn({ err: e }, "Retention pruning error"));

    // Sessions that can never authenticate again are kept for 7 days (so recent
    // activity stays reviewable in the Security Center) and then dropped.
    pruneExpiredSessions()
      .then((n) => { if (n > 0) logger.info({ sessions: n }, "Pruned expired sessions"); })
      .catch((e) => logger.warn({ err: e }, "Session pruning error"));
  }, PRUNE_INTERVAL_MS);
});

server.on("error", (err) => {
  logger.error({ err }, "Server error");
  process.exit(1);
});
