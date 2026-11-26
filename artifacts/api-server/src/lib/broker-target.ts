import net from "node:net";
import tls from "node:tls";
import mqtt, { MqttClient, type IClientOptions } from "mqtt";
import { authConfig } from "./auth-config";
import { classifyHost, guardedLookup, parseIPv6 } from "./outbound-url";

/**
 * Where an MQTT broker may point (audit 23 Nov 2026, M-7).
 *
 * A broker endpoint is typed in by a user with `manage_brokers`, and then the
 * SERVER connects to it, again and again, and records each connection error in
 * the broker history. Unchecked, that is a request-forgery and port-scan tool:
 * point it at 169.254.169.254 or at 10.0.0.5:5432 and read the history.
 *
 * Policy:
 * - always refused: link-local (incl. the cloud metadata endpoint), multicast,
 *   reserved and documentation ranges, unspecified, and unix sockets;
 * - loopback (a broker on this same machine): refused unless
 *   ALLOW_LOOPBACK_BROKER_TARGETS=true;
 * - private / plant-LAN addresses: allowed, because that is where brokers
 *   usually live; ALLOW_PRIVATE_BROKER_TARGETS=false refuses them too.
 *
 * Checked when the broker is saved (the literal host) and again on every
 * connection: a host name is resolved by `guardedLookup`, and the socket
 * connects to the address that was checked, so DNS rebinding cannot route a
 * reconnect somewhere else.
 */

const KINDS: Record<string, "tcp" | "tls" | "ws"> = {
  "mqtt:": "tcp", "tcp:": "tcp",
  "mqtts:": "tls", "ssl:": "tls", "tls:": "tls",
  "ws:": "ws", "wss:": "ws",
};

export interface BrokerPolicy { allowPrivateBrokerTargets: boolean; allowLoopbackBrokerTargets: boolean }

/** 127.0.0.0/8, ::1, their IPv4-in-IPv6 forms, and localhost names. */
export function isLoopbackHost(raw: string): boolean {
  const host = raw.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  const v = net.isIP(host);
  if (v === 4) return host.startsWith("127.");
  if (v === 6) {
    const b = parseIPv6(host);
    if (!b) return false;
    const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
    if (zero(0, 15) && b[15] === 1) return true;
    const embedsV4 = zero(0, 12) || (zero(0, 10) && b[10] === 0xff && b[11] === 0xff);
    return embedsV4 && b[12] === 127;
  }
  return host === "localhost" || host.endsWith(".localhost");
}

/** Why this address may not be used for a broker, or null when it may. */
export function brokerAddressRefusal(host: string, policy: BrokerPolicy = authConfig): string | null {
  if (isLoopbackHost(host)) {
    return policy.allowLoopbackBrokerTargets
      ? null
      : "it is this server itself (loopback). Set ALLOW_LOOPBACK_BROKER_TARGETS=true to use a broker on the same machine.";
  }
  const c = classifyHost(host);
  if (c === "forbidden") return "it is a link-local, cloud-metadata, multicast or reserved address.";
  if (c === "private" && !policy.allowPrivateBrokerTargets) {
    return "it is a private-network address, and ALLOW_PRIVATE_BROKER_TARGETS=false on this server.";
  }
  return null;
}

export interface BrokerTarget { kind: "tcp" | "tls" | "ws"; host: string; port: number; url: URL }

/** Parse and check an MQTT broker endpoint. */
export function parseBrokerEndpoint(endpoint: string, policy: BrokerPolicy = authConfig): BrokerTarget | { error: string } {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return { error: "Enter the broker address as a URL, for example mqtt://broker.plant.local:1883." };
  }
  const kind = KINDS[url.protocol];
  if (!kind) return { error: `The broker protocol "${url.protocol.replace(/:$/, "")}" is not supported. Use mqtt, mqtts, ws or wss.` };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return { error: "The broker address has no host name." };
  const reason = brokerAddressRefusal(host, policy);
  if (reason) return { error: `Refusing broker address ${host}: ${reason}` };
  const port = url.port ? Number(url.port) : kind === "tcp" ? 1883 : kind === "tls" ? 8883 : url.protocol === "wss:" ? 443 : 80;
  return { kind, host, port, url };
}

/**
 * The check run when a broker is saved. MQTT endpoints must parse and pass the
 * policy. Azure endpoints are stored but never connected to, so only a host
 * that can be read from them is checked.
 */
export function checkBrokerEndpoint(endpoint: string | null | undefined, type: string, policy: BrokerPolicy = authConfig): { ok: true } | { ok: false; error: string } {
  const value = (endpoint ?? "").trim();
  if (!value) return { ok: true };
  if (type === "mqtt") {
    const t = parseBrokerEndpoint(value, policy);
    return "error" in t ? { ok: false, error: t.error } : { ok: true };
  }
  let host = "";
  try { host = new URL(value).hostname; } catch { return { ok: true }; }
  if (!host) return { ok: true };
  const reason = brokerAddressRefusal(host.replace(/^\[|\]$/g, ""), policy);
  return reason ? { ok: false, error: `Refusing broker address ${host}: ${reason}` } : { ok: true };
}

export class BrokerTargetError extends Error {
  readonly code = "broker_target_refused";
}

/**
 * `mqtt.connect` with the broker policy applied to every (re)connection.
 *
 * TCP and TLS use our own stream builder so the socket gets `guardedLookup`
 * (mqtt.js does not pass a lookup function to `net.createConnection`). WebSocket
 * brokers go through mqtt.js with the same lookup on the WebSocket's HTTP
 * request. When MQTTJS_SOCKS_PROXY is set the proxy resolves the name, so only
 * the literal-host check applies.
 */
export function connectBroker(endpoint: string, options: IClientOptions): MqttClient {
  const t = parseBrokerEndpoint(endpoint);
  if ("error" in t) throw new BrokerTargetError(t.error);
  const lookup = guardedLookup((address) => brokerAddressRefusal(address));

  if (t.kind === "ws" || process.env.MQTTJS_SOCKS_PROXY) {
    return mqtt.connect(endpoint, { ...options, wsOptions: { ...(options.wsOptions ?? {}), lookup } as IClientOptions["wsOptions"] });
  }

  const opts: IClientOptions = {
    ...options,
    protocol: t.kind === "tls" ? "mqtts" : "mqtt",
    host: t.host, hostname: t.host, port: t.port,
  };
  // Credentials written into the URL (mqtt://user:pass@host) keep working, as with mqtt.connect.
  if (t.url.username && !opts.username) {
    opts.username = decodeURIComponent(t.url.username);
    if (t.url.password && !opts.password) opts.password = decodeURIComponent(t.url.password);
  }
  const build = () => t.kind === "tls"
    ? tls.connect({
      host: t.host, port: t.port, lookup,
      servername: net.isIP(t.host) ? undefined : t.host,
      rejectUnauthorized: options.rejectUnauthorized !== false,
    })
    : net.createConnection({ host: t.host, port: t.port, lookup });
  return new MqttClient(build, opts);
}

/**
 * A broker history message as shown to someone who is not an administrator.
 * Raw connection errors ("connect ECONNREFUSED 10.0.0.5:5432") tell the reader
 * which internal hosts and ports exist; only administrators see them.
 */
export function publicBrokerMessage(message: string | null): string | null {
  if (!message) return message;
  if (message.startsWith("Refusing broker address")) return message;
  return "The connection failed. An administrator can see the details.";
}
