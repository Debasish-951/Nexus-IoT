import type { Request } from "express";
import { logger } from "./logger";

/**
 * Client address resolution for rate limiting and audit.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 *
 * The previous implementation read `x-forwarded-for` straight off the request
 * headers and used the first value it found. That header is attacker-controlled:
 * anything on the internet can send `X-Forwarded-For: <random>` and be treated
 * as a brand-new client on every request. Since the per-IP login limiter keyed
 * on exactly that value, the limiter could be bypassed completely with a single
 * extra header — a rotating XFF gives an unlimited supply of fresh buckets.
 *
 * The fix is to never parse the header here. Express already implements this
 * correctly: with `trust proxy` configured, `req.ip` is the last address that a
 * TRUSTED hop attested to, and untrusted values are discarded. With trust proxy
 * off, `req.ip` is the raw socket peer and the header is ignored entirely. Both
 * are safe; parsing the header by hand is not.
 *
 * ── The deployment constraint this creates ───────────────────────────────────
 *
 * `trust proxy` must match reality:
 *
 *   - Set too LOW (0 hops) behind nginx: every request appears to come from the
 *     proxy itself, so all users share one bucket and the first burst locks out
 *     everybody. A self-inflicted denial of service.
 *   - Set too HIGH (more hops than exist): the attacker controls the hop you
 *     trusted, and you are back to a forgeable key.
 *
 * There is no value that is safe for both, which is why it is explicit
 * configuration (`TRUST_PROXY`) rather than a guess. The reference deployment
 * puts exactly one nginx in front, hence the default of 1 in production.
 */

/** Strip the IPv4-mapped IPv6 prefix and any port, and normalise case. */
function normalise(raw: string): string {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  // "1.2.3.4:5678" — a port on an IPv4 literal. Bracketed IPv6 keeps its colons.
  const lastColon = ip.lastIndexOf(":");
  if (lastColon > -1 && ip.indexOf(":") === lastColon && /^\d+$/.test(ip.slice(lastColon + 1))) {
    ip = ip.slice(0, lastColon);
  }
  return ip.slice(0, 64);
}

/**
 * The address to key rate limits on.
 *
 * Always derived from `req.ip` — see the header note above. Never falls back to
 * a client-supplied header, because a fallback IS the bypass: an attacker would
 * simply trigger whatever condition makes the trusted path unavailable.
 */
export function clientAddress(req: Request): string {
  const ip = req.ip ?? req.socket?.remoteAddress ?? "";
  return ip ? normalise(ip) : "unknown";
}

/**
 * Coarser key covering the network a request came from: IPv4 /24, IPv6 /64.
 *
 * Renting 256 IPv4 addresses in one subnet is cheap, and an IPv6 host is
 * routinely handed a /64 — 18 quintillion addresses — so per-address limits
 * alone are close to meaningless against IPv6. Limiting the block as well means
 * an attacker has to spread across genuinely separate networks.
 *
 * Deliberately coarse and therefore shared: several real users behind one
 * corporate NAT land in the same bucket, which is why the subnet ceiling is set
 * as a multiple of the per-IP one rather than equal to it.
 */
export function subnetKey(ip: string): string {
  if (ip.includes(":")) {
    return ip.split(":").slice(0, 4).join(":") + "::/64";
  }
  const octets = ip.split(".");
  if (octets.length === 4) return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  return ip;
}

/**
 * Warn once per interval when a forwarded header arrives that Express is not
 * configured to trust.
 *
 * This is the signature of both failure modes: a proxy in front that nobody told
 * the app about (users about to share a bucket), or someone probing to see
 * whether the header still works. Either way an operator needs to know, and
 * neither shows up anywhere else.
 */
let lastForwardWarning = 0;
export function warnOnUntrustedForwardHeader(req: Request): void {
  if (!req.headers["x-forwarded-for"]) return;
  // `req.ip` differing from the socket peer means the header WAS honoured.
  const socketIp = normalise(req.socket?.remoteAddress ?? "");
  if (normalise(req.ip ?? "") !== socketIp) return; // trusted and applied — fine

  const now = Date.now();
  if (now - lastForwardWarning < 300_000) return;
  lastForwardWarning = now;
  logger.warn(
    { socketIp },
    "x-forwarded-for received but not trusted — it is being ignored for rate limiting. " +
    "If there IS a reverse proxy in front, set TRUST_PROXY to the number of hops or every " +
    "user will share one rate-limit bucket. If there is not, this is a client trying to forge its address.",
  );
}
