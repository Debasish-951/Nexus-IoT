import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import { and, eq, isNull, gt } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { authConfig } from "./auth-config";
import { hashToken } from "./tokens";
import { resolveAccess, hasPermission, type EffectiveAccess } from "./rbac";

let wss: WebSocketServer | null = null;

/**
 * Per-socket authorisation context.
 *
 * The upgrade used to be anonymous, which was harmless when the only traffic
 * was alarm and activity-log events. It is not harmless now: security events
 * carry usernames, source IPs, and failure reasons, so the socket has to know
 * who is listening.
 *
 * NOTE: this deliberately imports the DB directly rather than reusing
 * lib/sessions.ts — security-log.ts imports this module, and sessions.ts
 * imports security-log.ts, so going through sessions.ts would close an import
 * cycle at module-evaluation time.
 */
interface SocketContext {
  userId: string;
  username: string;
  access: EffectiveAccess;
}

const contexts = new WeakMap<WebSocket, SocketContext>();

function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

async function authenticateUpgrade(req: IncomingMessage): Promise<SocketContext | null> {
  const raw = readCookie(req, authConfig.session.cookieName);
  if (!raw || raw.length < 20 || raw.length > 128) return null;

  const [row] = await db
    .select({ user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
    .where(and(
      eq(sessionsTable.tokenHash, hashToken(raw)),
      isNull(sessionsTable.revokedAt),
      gt(sessionsTable.expiresAt, new Date()),
    ));

  if (!row || row.user.status !== "active") return null;

  return {
    userId: row.user.id,
    username: row.user.username,
    access: resolveAccess(row.user.role, row.user.accessOverrides),
  };
}

export function initWebSocketServer(server: Server): void {
  // `noServer` so the handshake can be rejected before the socket is upgraded —
  // an unauthenticated client never reaches the connection handler at all.
  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/ws") return; // leave other upgrades alone

    authenticateUpgrade(req)
      .then((context) => {
        if (!context) {
          logger.warn({ ip: req.socket.remoteAddress }, "WebSocket upgrade rejected: no valid session");
          socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        wss!.handleUpgrade(req, socket, head, (ws) => {
          contexts.set(ws, context);
          wss!.emit("connection", ws, req);
        });
      })
      .catch((err) => {
        logger.error({ err }, "WebSocket upgrade failed");
        socket.destroy();
      });
  });

  wss.on("connection", (ws) => {
    ws.on("error", () => {});
    ws.send(JSON.stringify({ type: "connected" }));
  });

  logger.info("WebSocket server attached at /api/ws (session-authenticated)");
}

export interface BroadcastOptions {
  /** Only deliver to sockets whose principal holds this permission. */
  requirePermission?: string;
  /** Only deliver to this user's sockets. */
  userId?: string;
}

/**
 * Which channels are sensitive, and what a listener must hold to receive them.
 * Anything not listed keeps the previous behaviour — delivered to every
 * authenticated socket — so existing alarm/telemetry consumers are unchanged.
 */
const CHANNEL_PERMISSIONS: Record<string, string> = {
  security_event: "manage_security",
  activity_log: "view",
};

export function broadcast(type: string, data: unknown, options: BroadcastOptions = {}): void {
  if (!wss) return;

  const required = options.requirePermission ?? CHANNEL_PERMISSIONS[type];
  const msg = JSON.stringify({ type, data });

  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    const context = contexts.get(client);
    if (!context) continue; // never send to a socket with no resolved principal
    if (options.userId && context.userId !== options.userId) continue;
    if (required && !hasPermission(context.access, required)) continue;

    client.send(msg);
  }
}
