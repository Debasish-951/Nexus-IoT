import { useEffect, useRef, useState } from "react";

export type WsEventType = "activity_log" | "telemetry" | "alarm" | "connected";

export type WsStatus = "connecting" | "connected" | "reconnecting";

export interface WsMessage {
  type: WsEventType;
  data?: unknown;
}

type WsEventHandler = (data: unknown) => void;

export function useWsEvents(
  handlers: Partial<Record<WsEventType, WsEventHandler>>,
): WsStatus {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const [status, setStatus] = useState<WsStatus>("connecting");

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let attempt = 0;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/api/ws`;

      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg: WsMessage = JSON.parse(event.data as string);
          if (msg.type === "connected") {
            setStatus("connected");
            return;
          }
          const handler = handlersRef.current[msg.type];
          if (handler) handler(msg.data);
        } catch {}
      };

      ws.onclose = () => {
        if (!closed) {
          attempt += 1;
          const delay = Math.min(1000 * 2 ** Math.min(attempt - 1, 5), 30_000);
          reconnectTimer = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {};
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return status;
}
