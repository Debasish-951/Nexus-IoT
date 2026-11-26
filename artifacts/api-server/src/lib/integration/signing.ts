import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

/**
 * Webhook signatures.
 *
 * Every signed send carries:
 *   X-Nexus-Timestamp: <unix seconds>
 *   X-Nexus-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 *
 * The receiver recomputes the HMAC over the exact bytes it received and rejects
 * a timestamp older than a few minutes, which stops replays. Same scheme as
 * Stripe and Slack, so receivers can reuse their existing verification code.
 */

export const SIGNATURE_HEADER = "X-Nexus-Signature";
export const TIMESTAMP_HEADER = "X-Nexus-Timestamp";

export function signPayload(secret: string, timestampSec: number, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestampSec}.${body}`).digest("hex");
}

/** Receiver-side check, used by the Integration Guide's verifier and the tests. */
export function verifySignature(
  secret: string, timestampSec: number, body: string, signature: string,
  toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!Number.isFinite(timestampSec) || Math.abs(nowSec - timestampSec) > toleranceSec) return false;
  const expected = Buffer.from(signPayload(secret, timestampSec, body));
  const given = Buffer.from(signature.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** A new random signing secret, shown to the administrator once. */
export function newSigningSecret(): string {
  return "whsec_" + randomBytes(24).toString("base64url");
}
