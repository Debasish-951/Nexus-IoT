import net from "node:net";
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

/** RFC1918, loopback, link-local (incl. cloud metadata), CGNAT, and IPv6 equivalents. */
function isPrivateAddress(host: string): boolean {
  const v = net.isIP(host);

  if (v === 4) {
    const p = host.split(".").map(Number);
    if (p[0] === 10) return true;                                  // 10.0.0.0/8
    if (p[0] === 127) return true;                                 // loopback
    if (p[0] === 169 && p[1] === 254) return true;                 // link-local + metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;     // 172.16.0.0/12
    if (p[0] === 192 && p[1] === 168) return true;                 // 192.168.0.0/16
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;    // CGNAT 100.64.0.0/10
    if (p[0] === 0) return true;                                   // 0.0.0.0/8
    return false;
  }

  if (v === 6) {
    const h = host.toLowerCase().replace(/^\[|\]$/g, "");
    if (h === "::1" || h === "::") return true;                    // loopback / unspecified
    if (h.startsWith("fe80")) return true;                         // link-local
    if (/^f[cd]/.test(h)) return true;                             // unique-local fc00::/7
    // ::ffff:10.0.0.1 — an IPv4 address wearing an IPv6 hat.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  // A hostname, not a literal. Only the obvious local names are caught here;
  // DNS is not resolved (see the note on `assertSafeOutboundUrl`).
  const name = host.toLowerCase();
  return name === "localhost" || name.endsWith(".localhost") || name === "metadata.google.internal";
}

export class UnsafeUrlError extends Error {
  readonly code = "unsafe_url";
}

/**
 * Throws `UnsafeUrlError` if the URL must not be requested by the server.
 *
 * Checks the literal host only — it does NOT resolve DNS, so a hostname that
 * resolves to a private address still passes. Closing that means resolving here
 * and pinning the connection to the resolved IP, since anything else is a
 * time-of-check/time-of-use race. That is worth doing, but it is a bigger change
 * than this; the ranges below cover the direct-IP and localhost cases that make
 * up the actual risk in a self-hosted deployment.
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
      `Refusing to call ${url.hostname}: it is a loopback, link-local or private-network address. ` +
      "Set ALLOW_PRIVATE_WEBHOOK_TARGETS=true if this deployment must reach hosts on its own network.",
    );
  }

  return url;
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
