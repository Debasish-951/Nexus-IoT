import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { onUserReset } from "@/lib/user-scoped-state";

export type WsEventType = "activity_log" | "telemetry" | "alarm" | "broker_status" | "connected";

export type WsStatus = "connecting" | "connected" | "reconnecting";

export interface WsMessage {
  type: WsEventType;
  data?: unknown;
}

type WsEventHandler = (data: unknown) => void;
type Handlers = Partial<Record<WsEventType, WsEventHandler>>;

/**
 * One WebSocket per tab, shared by every subscriber.
 *
 * Each `useWsEvents` call used to open its own socket, so a page with the bell,
 * the broker bar and a live view held three or four connections to the same
 * endpoint receiving the same broadcasts. Subscribers now register with this
 * module; the socket opens with the first and closes shortly after the last.
 *
 * Reconnect behaviour:
 *   - status reads "reconnecting" from the moment the socket drops, not only
 *     once the next attempt starts (it used to say "connected" through the
 *     whole back-off);
 *   - after a reconnect every query is invalidated, so events broadcast while
 *     the socket was down are picked up from the REST endpoints;
 *   - close code 4001 is the server dropping the socket because this user's
 *     access changed — reconnect at once rather than backing off.
 */

/** Close code the API uses when a user's access changed and the socket must be re-authorised. */
const ACCESS_CHANGED_CODE = 4001;
/** Grace period before closing an unused socket, so a route change does not drop and reopen it. */
const IDLE_CLOSE_MS = 2_000;

interface Subscriber {
  handlers: { current: Handlers };
  setStatus: (s: WsStatus) => void;
}

const subscribers = new Set<Subscriber>();
let socket: WebSocket | null = null;
let status: WsStatus = "connecting";
let attempt = 0;
let everConnected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** Used to resync after a reconnect. Every subscriber sits under the same provider. */
let queryClient: QueryClient | null = null;

function setShared(next: WsStatus) {
  status = next;
  for (const s of subscribers) s.setStatus(next);
}

function scheduleReconnect(delay: number) {
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (subscribers.size > 0) connect();
  }, delay);
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/api/ws`;

  setShared(everConnected || attempt > 0 ? "reconnecting" : "connecting");
  const ws = new WebSocket(url);
  socket = ws;

  ws.onopen = () => {
    attempt = 0;
  };

  ws.onmessage = (event: MessageEvent) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }
    if (msg.type === "connected") {
      const isReconnect = everConnected;
      everConnected = true;
      setShared("connected");
      // Anything broadcast while we were away was lost; refetch what is on screen.
      if (isReconnect) void queryClient?.invalidateQueries();
      return;
    }
    for (const s of subscribers) {
      const handler = s.handlers.current[msg.type];
      if (handler) {
        try { handler(msg.data); } catch { /* one bad handler must not starve the rest */ }
      }
    }
  };

  ws.onclose = (ev: CloseEvent) => {
    if (socket !== ws) return; // superseded or deliberately closed
    socket = null;
    if (subscribers.size === 0) return;
    setShared("reconnecting");
    if (ev.code === ACCESS_CHANGED_CODE) {
      attempt = 0;
      scheduleReconnect(250);
      return;
    }
    attempt += 1;
    scheduleReconnect(Math.min(1000 * 2 ** Math.min(attempt - 1, 5), 30_000));
  };

  ws.onerror = () => {};
}

function subscribe(sub: Subscriber) {
  subscribers.add(sub);
  if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
  if (!socket && reconnectTimer === null) connect();
}

function unsubscribe(sub: Subscriber) {
  subscribers.delete(sub);
  if (subscribers.size > 0) return;
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (subscribers.size > 0) return;
    if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    const ws = socket;
    socket = null;
    ws?.close();
    attempt = 0;
    everConnected = false;
    status = "connecting";
  }, IDLE_CLOSE_MS);
}

// Sign-out or a user switch: the open socket was authorised as the previous
// user, so drop it now instead of letting it idle out, and start a fresh one if
// anything is still listening.
onUserReset(() => {
  if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
  const ws = socket;
  socket = null;
  ws?.close();
  attempt = 0;
  everConnected = false;
  status = "connecting";
  // Deferred: on sign-out the subscribers are about to unmount, and the timer
  // only reconnects if something is still listening when it fires.
  scheduleReconnect(250);
});

export function useWsEvents(handlers: Handlers): WsStatus {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const qc = useQueryClient();
  queryClient = qc;

  const [current, setCurrent] = useState<WsStatus>(status);

  useEffect(() => {
    const sub: Subscriber = { handlers: handlersRef, setStatus: setCurrent };
    subscribe(sub);
    setCurrent(status);
    return () => unsubscribe(sub);
  }, []);

  return current;
}
