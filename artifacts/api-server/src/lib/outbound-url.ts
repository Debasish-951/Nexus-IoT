import net from "node:net";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { lookup } from "node:dns/promises";
import { authConfig } from "./auth-config";

/**
 * Guard for URLs the server will fetch on a user's behalf — alarm webhooks and
 * data destinations.
 *
 * Both let a signed-in user name any address and have the SERVER request it.
 * That is a server-side request forgery primitive: this platform is self-hosted
 * on a VM that can usually reach a management network, other services on
 * localhost, and — on a cloud instance — the metadata endpoint at 169.254.169.254
 * that hands out credentials. The user's own browser can reach none of those.
 *
 * It needs `manage_alarms` / `manage_destinations`, so this is not an anonymous
 * hole; it is a privileged user reaching further than they should be able to.
 *
 * Deliberately a blocklist of address ranges rather than an allowlist of hosts:
 * an allowlist would need configuring before the first webhook could be created,
 * which is a real cost for a feature people use with arbitrary third-party
 * endpoints (Teams, Slack, a customer's own collector).
 *
 * Set `ALLOW_PRIVATE_WEBHOOK_TARGETS=true` where an on-premise deployment
 * genuinely needs to post to a private host — an air-gapped plant posting to its
 * own historian is a legitimate case, and refusing it outright would push people
 * to disable the feature instead.
 */

/**
 * How the server should treat an address it is about to connect to.
 *
 * - `forbidden`: never a legitimate target for anything this server calls out
 *   to: loopback, unspecified, link-local (which includes the cloud metadata
 *   endpoint 169.254.169.254), multicast, the reserved 240.0.0.0/4 block and
 *   the documentation ranges.
 * - `private`: a network that is not the public internet but can be a real
 *   peer on a plant LAN: RFC 1918, CGNAT 100.64.0.0/10, the 198.18.0.0/15
 *   benchmarking block, IPv6 unique-local and site-local.
 * - `public`: everything else.
 *
 * IPv6 forms that carry an IPv4 address (IPv4-mapped `::ffff:a.b.c.d`,
 * IPv4-compatible `::a.b.c.d`, IPv4-translated `::ffff:0:a.b.c.d`, NAT64
 * `64:ff9b::/96`, 6to4 `2002::/16` and Teredo `2001::/32`) are judged by the
 * IPv4 address inside, in every spelling the URL parser can produce.
 */
export type AddressClass = "public" | "private" | "forbidden";

function classifyIPv4(p: number[]): AddressClass {
  const [a, b, c] = p as [number, number, number, number];
  if (a === 0) return "forbidden";                                 // 0.0.0.0/8 "this network"
  if (a === 127) return "forbidden";                               // loopback
  if (a === 169 && b === 254) return "forbidden";                  // link-local + metadata
  if (a >= 224) return "forbidden";                                // 224/4 multicast, 240/4 reserved, broadcast
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return "forbidden"; // 192.0.0.0/24 IETF, 192.0.2.0/24 docs
  if (a === 198 && b === 51 && c === 100) return "forbidden";      // 198.51.100.0/24 docs
  if (a === 203 && b === 0 && c === 113) return "forbidden";       // 203.0.113.0/24 docs
  if (a === 10) return "private";                                  // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return "private";           // 172.16.0.0/12
  if (a === 192 && b === 168) return "private";                    // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return "private";          // CGNAT 100.64.0.0/10
  if (a === 198 && (b === 18 || b === 19)) return "private";       // 198.18.0.0/15 benchmarking
  return "public";
}

/** Sixteen bytes of an IPv6 literal (with or without a trailing dotted quad), or null. */
export function parseIPv6(raw: string): number[] | null {
  let h = raw.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (net.isIP(h) !== 6) return null;
  const tail: number[] = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (dotted) {
    const q = dotted[1]!.split(".").map(Number);
    tail.push((q[0]! << 8) | q[1]!, (q[2]! << 8) | q[3]!);
    h = h.slice(0, -dotted[1]!.length);
    if (!h.endsWith("::")) h = h.slice(0, -1);
  }
  const [left, right] = h.includes("::") ? h.split("::") as [string, string] : [h, null];
  const lw = left ? left.split(":").filter((x) => x !== "").map((x) => parseInt(x, 16)) : [];
  const rw = right ? right.split(":").filter((x) => x !== "").map((x) => parseInt(x, 16)) : [];
  const want = 8 - tail.length;
  const groups = right === null ? lw : [...lw, ...new Array(Math.max(0, want - lw.length - rw.length)).fill(0), ...rw];
  const words = [...groups.slice(0, want), ...tail];
  if (words.length !== 8 || words.some((w) => !Number.isFinite(w))) return null;
  return words.flatMap((w) => [w >> 8, w & 255]);
}

function classifyIPv6(b: number[]): AddressClass {
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const v4 = (o: number) => classifyIPv4(b.slice(o, o + 4));
  if (zero(0, 15) && (b[15] === 0 || b[15] === 1)) return "forbidden";        // :: and ::1
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return v4(12);         // ::ffff:a.b.c.d (mapped)
  if (zero(0, 12)) return v4(12);                                             // ::a.b.c.d (compatible)
  if (zero(0, 8) && b[8] === 0xff && b[9] === 0xff && zero(10, 12)) return v4(12); // ::ffff:0:a.b.c.d (translated)
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return zero(4, 12) ? v4(12) : "private";                                  // NAT64 64:ff9b::/96, local-use 64:ff9b:1::/48
  }
  if (b[0] === 0x20 && b[1] === 0x02) return v4(2);                           // 6to4 2002::/16
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) {
    return classifyIPv4(b.slice(12, 16).map((x) => x ^ 0xff));                // Teredo: client address, inverted
  }
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return "forbidden"; // 2001:db8::/32 docs
  if (b[0] === 0x01 && zero(1, 8)) return "forbidden";                        // 100::/64 discard
  if (b[0] === 0xff) return "forbidden";                                      // ff00::/8 multicast
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return "forbidden";           // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return "private";             // fec0::/10 site-local (deprecated)
  if ((b[0]! & 0xfe) === 0xfc) return "private";                              // fc00::/7 unique-local
  return "public";
}

/** Classify an IP literal or host name (names are not resolved; only local names are caught). */
export function classifyHost(rawHost: string): AddressClass {
  // URL.hostname keeps the brackets around an IPv6 literal ("[::1]"), and
  // net.isIP("[::1]") is 0, so IPv6 literals used to skip every check.
  const host = rawHost.replace(/^\[|\]$/g, "");
  const v = net.isIP(host);
  if (v === 4) return classifyIPv4(host.split(".").map(Number));
  if (v === 6) {
    const bytes = parseIPv6(host);
    return bytes ? classifyIPv6(bytes) : "forbidden";
  }
  // A hostname, not a literal. Only the obvious local names are caught here;
  // the address it resolves to is checked when the connection is made.
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name === "localhost" || name.endsWith(".localhost") || name === "metadata.google.internal") return "forbidden";
  return "public";
}

/** Loopback, link-local (incl. cloud metadata), private networks, reserved ranges and their IPv6 forms. */
export function isPrivateAddress(rawHost: string): boolean {
  return classifyHost(rawHost) !== "public";
}

export class UnsafeUrlError extends Error {
  readonly code = "unsafe_url";
}

/**
 * Throws `UnsafeUrlError` if the URL must not be requested by the server.
 *
 * Checks the literal host only — it does NOT resolve DNS. That is enough for
 * validating input before it is saved; `safeFetch` resolves the name and pins
 * the connection to the checked address when it actually calls it.
 */
export function assertSafeOutboundUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Only http and https URLs can be called — got "${url.protocol.replace(":", "")}".`);
  }

  if (!authConfig.allowPrivateWebhookTargets && isPrivateAddress(url.hostname)) {
    throw new UnsafeUrlError(
      `Refusing to call ${url.hostname}: it is a loopback, link-local, private-network or reserved address. ` +
      "Set ALLOW_PRIVATE_WEBHOOK_TARGETS=true if this deployment must reach hosts on its own network.",
    );
  }

  return url;
}

/** Normalise the `family` a socket passes to its lookup function. */
function familyOf(f: unknown): 0 | 4 | 6 {
  if (f === 4 || f === "IPv4") return 4;
  if (f === 6 || f === "IPv6") return 6;
  return 0;
}

/**
 * A `dns.lookup`-compatible function for a socket's `lookup` option. It resolves
 * the name once, refuses the connection if ANY answer is refused by `refuse`
 * (which returns a reason, or null to allow), and hands the checked answers
 * straight to the socket. The socket connects to exactly what this returned, so
 * a DNS answer that changes between the check and the connection (DNS
 * rebinding) cannot slip through: there is no second resolution. The Host
 * header and TLS SNI still carry the original name.
 *
 * Not called for an IP literal; check those with `classifyHost` first.
 */
export function guardedLookup(refuse: (address: string) => string | null): net.LookupFunction {
  const fn = (hostname: string, options: { family?: unknown; all?: boolean } | undefined, callback: (...args: unknown[]) => void): void => {
    lookup(hostname, { all: true, family: familyOf(options?.family) }).then((answers) => {
      for (const a of answers) {
        const reason = refuse(a.address);
        if (reason) { callback(new UnsafeUrlError(`Refusing to connect to ${hostname}: ${reason}`)); return; }
      }
      if (!answers.length) { callback(Object.assign(new Error(`Could not resolve ${hostname}.`), { code: "ENOTFOUND" })); return; }
      if (options?.all) callback(null, answers);
      else callback(null, answers[0]!.address, answers[0]!.family);
    }, (err: unknown) => callback(err));
  };
  return fn as unknown as net.LookupFunction;
}

/** A request body as bytes. safeFetch callers send JSON strings; bytes are accepted too. */
function bodyBytes(body: RequestInit["body"]): Buffer | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  throw new TypeError("safeFetch sends string or byte bodies only.");
}

/**
 * `fetch` over node:http/https with the socket's address lookup replaced by
 * `lookupFn`, returning a standard `Response`. Redirects are never followed
 * (the 3xx response is returned, like `redirect: "manual"`), and a fresh socket
 * is used per call, so nothing is shared with a connection opened to another
 * address.
 */
export function pinnedFetch(url: URL, init: RequestInit, lookupFn: net.LookupFunction): Promise<Response> {
  if (url.username || url.password) {
    // Same rule as fetch(): credentials belong in a header, not the URL.
    return Promise.reject(new TypeError("A URL with a user name or password in it cannot be called; send credentials in a header."));
  }
  const method = (init.method ?? "GET").toUpperCase();
  const given = new Headers(init.headers);
  const headers: Record<string, string> = { accept: "*/*", "user-agent": "iot-platform" };
  given.forEach((v, k) => { headers[k] = v; });
  let body: Buffer | undefined;
  try { body = bodyBytes(init.body); } catch (err) { return Promise.reject(err); }
  if (body) {
    headers["content-length"] = String(body.length);
    if (!given.has("content-type") && typeof init.body === "string") headers["content-type"] = "text/plain;charset=UTF-8";
  }
  const signal = init.signal ?? undefined;
  const transport = url.protocol === "https:" ? https : http;

  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ""),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method, headers, signal, agent: false, lookup: lookupFn,
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status > 599) { res.destroy(); reject(new Error(`Unexpected HTTP status ${status}.`)); return; }
      const out = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (v === undefined) continue;
        for (const one of Array.isArray(v) ? v : [v]) out.append(k, one);
      }
      const noBody = method === "HEAD" || status === 204 || status === 205 || status === 304;
      if (noBody) res.resume();
      resolve(new Response(noBody ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>), {
        status, statusText: res.statusMessage ?? "", headers: out,
      }));
    });
    // An abort (e.g. AbortSignal.timeout) rejects with the signal's own reason,
    // as fetch does, so callers that look for a "TimeoutError" still find it.
    req.on("error", (err) => reject(signal?.aborted ? signal.reason : err));
    req.end(body);
  });
}

const PRIVATE_HINT = "Set ALLOW_PRIVATE_WEBHOOK_TARGETS=true if this deployment must reach hosts on its own network.";

/**
 * Fetch a user-supplied URL from the server, with the same guard applied to
 * where it really goes:
 *
 * - the hostname is resolved, and every address it resolves to is checked, so
 *   a DNS name pointing at 127.0.0.1 or 169.254.169.254 is refused;
 * - the connection is made to the address that was checked (see
 *   `guardedLookup`), so DNS rebinding between check and connect is closed;
 * - redirects are not followed, so a public URL cannot bounce the request to
 *   a private address.
 *
 * With ALLOW_PRIVATE_WEBHOOK_TARGETS=true nothing is refused, so the plain
 * global fetch is used, exactly as before.
 */
export async function safeFetch(raw: string, init: RequestInit): Promise<Response> {
  const url = assertSafeOutboundUrl(raw);
  if (authConfig.allowPrivateWebhookTargets) return fetch(url, { ...init, redirect: "manual" });
  return pinnedFetch(url, init, guardedLookup((address) => classifyHost(address) === "public"
    ? null
    : `it resolves to a loopback, link-local, private-network or reserved address. ${PRIVATE_HINT}`));
}

/** Non-throwing form, for validating user input before it is saved. */
export function checkOutboundUrl(raw: string): { ok: true } | { ok: false; error: string } {
  try {
    assertSafeOutboundUrl(raw);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
