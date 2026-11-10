import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import { and, eq, isNull, gt } from "drizzle-orm";
import { db, sessionsTable, usersTable, assetsTable } from "@workspace/db";
import { logger } from "./logger";
import { authConfig } from "./auth-config";
import { hashToken } from "./tokens";
import { resolveAccess, hasPermission, hasModuleAccess, canAccessProject, type EffectiveAccess } from "./rbac";
import { assetSubtree } from "./asset-subtree";

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
  /** The session the socket was opened with, so revoking it closes the socket. */
  sessionId: string;
  username: string;
  access: EffectiveAccess;
  /**
   * Set only for a user with a Project Access restriction. Worked out once at
   * connect, so an asset added later reaches them after they reconnect: the stale
   * direction withholds data rather than leaking it.
   */
  allowedAssets?: Set<string>;
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
    .select({ user: usersTable, sessionId: sessionsTable.id })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
    .where(and(
      eq(sessionsTable.tokenHash, hashToken(raw)),
      isNull(sessionsTable.revokedAt),
      gt(sessionsTable.expiresAt, new Date()),
    ));

  if (!row || row.user.status !== "active") return null;
  // HTTP routes refuse everything except changing the password while a change is
  // required; the live feed must not be the exception.
  if (row.user.mustChangePassword) return null;

  const access = resolveAccess(row.user.role, row.user.accessOverrides);
  let allowedAssets: Set<string> | undefined;
  if (access.restrictProjects) {
    const assets = await db.select({ id: assetsTable.id, parentId: assetsTable.parentId }).from(assetsTable);
    allowedAssets = assetSubtree(
      assets.filter((a) => !a.parentId && canAccessProject(access, a.id)).map((a) => a.id),
      assets,
    );
  }

  return {
    userId: row.user.id,
    sessionId: row.sessionId,
    username: row.user.username,
    access,
    allowedAssets,
  };
}

/**
 * Whether a WebSocket handshake's Origin may open a live connection.
 *
 * Browsers do not apply CORS to WebSockets: a page on another origin can open
 * `wss://<this host>/api/ws`, and the browser attaches the session cookie
 * whenever that page counts as the same site (another subdomain, for example),
 * since the cookie is SameSite=Lax rather than Strict. Without this check such a
 * page could read a signed-in user's live telemetry, alarms and activity feed.
 *
 * Allowed: no Origin at all (not a browser: tools, tests), an origin listed in
 * CORS_ORIGINS, the AUTH_PUBLIC_URL origin, or an origin whose host is the Host
 * the request was sent to (the SPA served by the same nginx).
 */
export function originAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowed: readonly string[],
  publicUrl?: string,
): boolean {
  if (!origin) return true;
  if (allowed.includes(origin)) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (publicUrl) {
    try {
      if (new URL(publicUrl).origin === parsed.origin) return true;
    } catch { /* an unparsable AUTH_PUBLIC_URL simply matches nothing */ }
  }
  return !!host && parsed.host.toLowerCase() === host.trim().toLowerCase();
}

/**
 * Largest message accepted from a client. The browser never sends anything on
 * this socket; the library default of 100 MiB let one connection make the
 * process buffer that much before the frame was even looked at.
 */
const MAX_PAYLOAD_BYTES = 64 * 1024;

export function initWebSocketServer(server: Server): void {
  // `noServer` so the handshake can be rejected before the socket is upgraded —
  // an unauthenticated client never reaches the connection handler at all.
  wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  server.on("upgrade", (req, socket, head) => {
    // A malformed request target (for example "//") makes `new URL` throw. This
    // handler runs outside Express, so the throw would stop the process.
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== "/api/ws") return; // leave other upgrades alone

    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    if (!originAllowed(origin, req.headers.host, authConfig.corsOrigins, authConfig.publicUrl)) {
      logger.warn({ origin, ip: req.socket.remoteAddress }, "WebSocket upgrade rejected: origin not allowed");
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

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

/** Close every live connection, for shutdown. */
export function closeWebSocketServer(): void {
  if (!wss) return;
  for (const ws of wss.clients) ws.close(1001, "server_shutdown");
  wss.close();
}

/** Close code sent when access ends or changes; the client reconnects and re-authenticates. */
const ACCESS_CHANGED = 4001;

/**
 * Close the live connections of one user, or of one session.
 *
 * Access is worked out when a socket connects. Without this, a user who was
 * suspended, signed out by an administrator, demoted, or removed from a project
 * kept receiving live telemetry and alarms until they closed the page. A user
 * whose access merely changed reconnects at once and gets the new access.
 */
export function closeSockets(match: { userId?: string; sessionId?: string; exceptSessionId?: string }, reason: string): number {
  if (!wss) return 0;
  let closed = 0;
  for (const ws of wss.clients) {
    const ctx = contexts.get(ws);
    if (!ctx) continue;
    if (match.userId && ctx.userId !== match.userId) continue;
    if (match.sessionId && ctx.sessionId !== match.sessionId) continue;
    if (match.exceptSessionId && ctx.sessionId === match.exceptSessionId) continue;
    ws.close(ACCESS_CHANGED, reason.slice(0, 100));
    closed++;
  }
  return closed;
}

export interface BroadcastOptions {
  /** Only deliver to sockets whose principal holds this permission. */
  requirePermission?: string;
  /** Only deliver to sockets whose principal can read this module. */
  requireModule?: string;
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
};

/**
 * Channels mirroring a page that needs a module. The activity feed was gated on
 * the generic `view` verb, which every role holds, so Viewers and Operators
 * received sign-ins and user changes the Audit Logs page refuses to show them.
 */
const CHANNEL_MODULES: Record<string, string> = {
  activity_log: "activity_log",
};

/**
 * Channels carrying one asset's data, withheld from users restricted to other
 * projects, with the field naming the asset. An activity entry is scoped by its
 * target, so one about a user, broker or API client (no asset) is withheld from a
 * restricted user, as is any event whose asset is not shown to be theirs.
 */
const PROJECT_SCOPED_CHANNELS: Record<string, string> = {
  telemetry: "assetId",
  alarm: "assetId",
  activity_log: "targetId",
};

export function broadcast(type: string, data: unknown, options: BroadcastOptions = {}): void {
  if (!wss) return;

  const required = options.requirePermission ?? CHANNEL_PERMISSIONS[type];
  const requiredModule = options.requireModule ?? CHANNEL_MODULES[type];
  const scopeKey = PROJECT_SCOPED_CHANNELS[type];
  const msg = JSON.stringify({ type, data });

  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    const context = contexts.get(client);
    if (!context) continue; // never send to a socket with no resolved principal
    if (options.userId && context.userId !== options.userId) continue;
    if (required && !hasPermission(context.access, required)) continue;
    if (requiredModule && !hasModuleAccess(context.access, requiredModule, "read")) continue;
    if (context.allowedAssets && scopeKey) {
      const assetId = (data as Record<string, unknown> | null)?.[scopeKey];
      // An event with no asset cannot be shown to belong to their project, so it is withheld.
      if (typeof assetId !== "string" || !context.allowedAssets.has(assetId)) continue;
    }

    client.send(msg);
  }
}
