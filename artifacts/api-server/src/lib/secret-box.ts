import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { getSecret } from "./secrets";
import { logger } from "./logger";

/**
 * Authenticated encryption for credentials that must be USED, not just checked.
 *
 * ── Why encryption and not hashing ───────────────────────────────────────────
 *
 * Passwords and API secrets are hashed, because the server only ever needs to
 * answer "does this match?". These are different: the server has to present a
 * webhook's bearer token to a third party and an MQTT password to a broker, so
 * it must be able to recover the original. Reversible encryption is the only
 * option, and the security therefore rests entirely on where the KEY lives —
 * which is the point of loading it through lib/secrets.ts from a file a vault
 * can manage, rather than from the database it protects.
 *
 * The threat this actually closes is a database compromise: a dump, a stolen
 * backup, a read-replica with loose permissions, or an SQL-injection that gets
 * past everything else. In all of those the attacker has the ciphertext and not
 * the key. It does NOT protect against someone who can run code in this
 * process — nothing at this layer can.
 *
 * ── Construction ─────────────────────────────────────────────────────────────
 *
 * AES-256-GCM. Authenticated, so a tampered ciphertext fails loudly instead of
 * decrypting to garbage that then gets sent to a broker.
 *
 *   enc:v1:<keyId>:<iv-b64url>:<tag-b64url>:<ciphertext-b64url>
 *
 * The key id travels with the ciphertext. That is what makes rotation possible
 * without a flag day: several keys can be loaded at once, each row decrypts
 * under whichever key encrypted it, and new writes use the current key. A
 * re-encryption pass then moves old rows forward at leisure.
 *
 * The `context` argument becomes GCM additional authenticated data, binding the
 * ciphertext to the column it belongs in. Without it, a value copied from
 * `destinations.basic_pass` into `brokers.mqtt_password` would decrypt happily;
 * with it, that fails authentication. It costs nothing and removes a whole
 * class of "move the blob somewhere more useful" attacks.
 */

const PREFIX = "enc";
const VERSION = "v1";
const IV_BYTES = 12;   // 96 bits, the GCM standard
const KEY_BYTES = 32;  // AES-256

interface KeyEntry {
  id: string;
  key: Buffer;
}

let currentKey: KeyEntry | null = null;
const keyRing = new Map<string, Buffer>();
let initialised = false;

function parseKey(name: string, raw: string): Buffer | null {
  // base64 (with or without padding/url alphabet) or hex.
  const candidates = [
    () => Buffer.from(raw, "base64"),
    () => (/^[0-9a-fA-F]+$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.alloc(0)),
  ];
  for (const make of candidates) {
    try {
      const buf = make();
      if (buf.length === KEY_BYTES) return buf;
    } catch { /* try the next encoding */ }
  }
  logger.error(
    { key: name, decodedLength: Buffer.from(raw, "base64").length },
    `encryption key ${name} is not 32 bytes once decoded — expected base64 or hex for AES-256`,
  );
  return null;
}

/**
 * Load the key ring.
 *
 * `SECRETS_ENC_KEY`      — the current key, used for all new encryption
 * `SECRETS_ENC_KEY_ID`   — its identifier, recorded in each ciphertext (default "1")
 * `SECRETS_ENC_KEY_<id>` — any number of retired keys, kept only so old rows
 *                          still decrypt until the re-encryption pass has run
 *
 * Called once at boot. Absent keys are not fatal: the application still runs and
 * stores credentials in clear, exactly as it did before this module existed —
 * with a loud warning. Making it fatal would mean shipping a change that stops
 * every existing deployment from booting, which gets reverted rather than
 * configured.
 */
export function initSecretBox(): void {
  if (initialised) return;
  initialised = true;

  const keyId = process.env.SECRETS_ENC_KEY_ID?.trim() || "1";
  const raw = getSecret("SECRETS_ENC_KEY");

  if (raw) {
    const key = parseKey("SECRETS_ENC_KEY", raw);
    if (key) {
      currentKey = { id: keyId, key };
      keyRing.set(keyId, key);
    }
  }

  // Retired keys, for decrypt-only.
  for (const envName of Object.keys(process.env)) {
    const m = /^SECRETS_ENC_KEY_([A-Za-z0-9_-]+)$/.exec(envName);
    if (!m || m[1] === "ID") continue;
    const id = m[1];
    if (keyRing.has(id)) continue;
    const value = getSecret(envName);
    if (!value) continue;
    const key = parseKey(envName, value);
    if (key) keyRing.set(id, key);
  }

  if (!currentKey && process.env.NODE_ENV === "production" && process.env.SECRETS_ALLOW_PLAINTEXT !== "true") {
    // Refuse rather than warn: a warning in a production log is easily missed,
    // and every broker password and destination token saved afterwards would be
    // stored in clear.
    throw new Error(
      "SECRETS_ENC_KEY is not set in production, so stored credentials would be saved in clear. " +
      "Set SECRETS_ENC_KEY (or SECRETS_ENC_KEY_FILE), or set SECRETS_ALLOW_PLAINTEXT=true to accept the risk deliberately.",
    );
  }
  if (!currentKey) {
    logger.warn(
      "SECRETS_ENC_KEY is not set — webhook tokens and MQTT passwords will be stored in clear. " +
      "Generate one with:  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"  " +
      "and mount it as a file with SECRETS_ENC_KEY_FILE.",
    );
  } else {
    logger.info({ currentKeyId: currentKey.id, keysLoaded: keyRing.size }, "secret encryption ready");
  }
}

/** Whether encryption is available. Callers use it to decide what to tell the operator. */
export function encryptionEnabled(): boolean {
  if (!initialised) initSecretBox();
  return currentKey !== null;
}

/** Is this value already an envelope produced by this module? */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${PREFIX}:${VERSION}:`);
}

/**
 * Encrypt a credential for storage.
 *
 * Returns the input unchanged when no key is configured, so a deployment that
 * has not set one keeps working exactly as before rather than writing rows it
 * will never be able to read back.
 */
export function encryptSecret(plaintext: string | null | undefined, context: string): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  if (!initialised) initSecretBox();
  if (!currentKey) return plaintext;
  // Never double-wrap: an update that passes a value straight back from a read
  // would otherwise nest envelopes until the column overflows.
  if (isEncrypted(plaintext)) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", currentKey.key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX, VERSION, currentKey.id,
    iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url"),
  ].join(":");
}

/**
 * Decrypt a stored credential.
 *
 * A value that is not an envelope is returned as-is. That is what lets this ship
 * against a live database: rows written before the key existed keep working, and
 * the re-encryption script converts them when the operator is ready. Once every
 * row is converted, `assertAllEncrypted` in the rotation script confirms it.
 */
export function decryptSecret(stored: string | null | undefined, context: string): string | null {
  if (stored === null || stored === undefined || stored === "") return null;
  if (!isEncrypted(stored)) return stored;
  if (!initialised) initSecretBox();

  const parts = stored.split(":");
  if (parts.length !== 6) {
    logger.error({ context }, "stored secret is malformed — refusing to use it");
    return null;
  }
  const [, , keyId, ivB64, tagB64, ctB64] = parts;

  const key = keyRing.get(keyId);
  if (!key) {
    // The usual cause is a retired key removed from the environment before the
    // re-encryption pass finished. Say so precisely: the value is recoverable,
    // it just needs the old key put back.
    logger.error(
      { context, keyId, availableKeys: [...keyRing.keys()] },
      "no decryption key for this ciphertext — restore the retired key and run the re-encryption pass",
    );
    return null;
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Authentication failure. Either the row was tampered with, or it was moved
    // between columns (the AAD no longer matches). Never returns a guess.
    logger.error({ context, keyId }, "secret failed authentication — it may have been altered");
    return null;
  }
}

/** Constant-time comparison, for anywhere a decrypted secret is checked rather than sent. */
export function secretsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Key ids currently loaded, for the health/diagnostics view. Never exposes key material. */
export function keyRingStatus(): { currentKeyId: string | null; loadedKeyIds: string[] } {
  if (!initialised) initSecretBox();
  return { currentKeyId: currentKey?.id ?? null, loadedKeyIds: [...keyRing.keys()] };
}
