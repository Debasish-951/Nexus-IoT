import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { logger } from "./logger";

let wss: WebSocketServer | null = null;

export function initWebSocketServer(server: Server): void {
  wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", (ws) => {
    ws.on("error", () => {});
    ws.send(JSON.stringify({ type: "connected" }));
  });

  logger.info("WebSocket server attached at /api/ws");
}

export function broadcast(type: string, data: unknown): void {
  if (!wss) return;
  const msg = JSON.stringify({ type, data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}
