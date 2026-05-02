import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { startMqttSubscribers } from "./services/mqtt.js";
import { initWebSocketServer } from "./lib/ws-broadcast";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
initWebSocketServer(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening");

  startMqttSubscribers().catch((e) => {
    logger.warn({ err: e }, "MQTT subscriber startup failed — will retry on next broker save");
  });
});

server.on("error", (err) => {
  logger.error({ err }, "Server error");
  process.exit(1);
});
