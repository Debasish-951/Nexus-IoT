import "dotenv/config";
import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { startMqttSubscribers } from "./services/mqtt.js";
import { initWebSocketServer } from "./lib/ws-broadcast";
import { runPruning } from "./routes/system";
import { loadSeenDevices } from "./lib/seen-devices";

// On Replit, PORT is injected by the platform.
// For local development, default to 8080 so the frontend proxy works out of the box.
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
  }, PRUNE_INTERVAL_MS);
});

server.on("error", (err) => {
  logger.error({ err }, "Server error");
  process.exit(1);
});
