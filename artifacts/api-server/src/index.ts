import app from "./app";
import { logger } from "./lib/logger";
import { startMqttSubscribers } from "./services/mqtt.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) { logger.error({ err }, "Error listening on port"); process.exit(1); }
  logger.info({ port }, "Server listening");

  // Start MQTT subscribers (non-blocking — failures don't crash the server)
  startMqttSubscribers().catch((e) => {
    logger.warn({ err: e }, "MQTT subscriber startup failed — will retry on next broker save");
  });
});
