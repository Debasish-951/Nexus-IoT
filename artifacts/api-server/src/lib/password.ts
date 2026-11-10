import crypto from "node:crypto";
import { promisify } from "node:util";
import { authConfig } from "./auth-config";

const scrypt = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing.
 *
 * scrypt from node:crypto rather than bcrypt/argon2, for three reasons:
 *   1. OWASP lists scrypt as an acceptable password hash with these parameters.
 *   2. Zero new dependencies — the workspace pins `minimumReleaseAge: 1440`, and
 *      bcrypt/argon2 are native modules needing a per-OS compile, which makes
 *      installs fragile across the platforms this repo is developed and run on.
 *   3. The stored format is self-describing and versioned, so migrating to
 *      argon2id later is a change to `hashPassword` only — `verifyPassword`
 *      keeps reading old hashes.
 *
 * Stored format:  scrypt$N$r$p$<salt base64>$<hash base64>
 */

// OWASP-documented equivalent of the (2^17, 8, 1) baseline, at half the peak
// memory: (2^16, 8, 2). ~64 MiB per hash — sized so a burst of logins cannot
// exhaust a small container.
const SCRYPT_N = 65_536;
const SCRYPT_r = 8;
const SCRYPT_p = 2;
const KEY_LEN = 64;
const SALT_LEN = 16;
// Node's default maxmem (32 MiB) is below what these parameters need
// (128 * N * r ≈ 64 MiB); without this every hash throws.
const MAX_MEM = 192 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LEN);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LEN, {
    N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, maxmem: MAX_MEM,
  });
  return [
    "scrypt", SCRYPT_N, SCRYPT_r, SCRYPT_p,
    salt.toString("base64"), derived.toString("base64"),
  ].join("$");
}

/**
 * Constant-time verification. Returns false — never throws — for malformed or
 * legacy (cleartext) stored values, so a corrupt row cannot 500 the login route
 * and a pre-upgrade cleartext password can never be matched.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Refuse absurd parameters from a tampered row — they would be a DoS vector.
  if (N > 1_048_576 || r > 32 || p > 16) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  try {
    const salt = Buffer.from(parts[4], "base64");
    const actual = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N, r, p, maxmem: MAX_MEM,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Burn a comparable amount of CPU on the "user does not exist" branch so login
 * response time does not disclose whether an account exists (OWASP ASVS V2.2.1).
 */
export async function dummyVerify(): Promise<void> {
  try {
    await scrypt("timing-equalisation", "timing-equalisation-salt", KEY_LEN, {
      N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, maxmem: MAX_MEM,
    });
  } catch {
    /* never let the equaliser break the request */
  }
}

/** True when a stored value predates this upgrade (i.e. is cleartext). */
export function isLegacyHash(stored: string | null): boolean {
  return !!stored && !stored.startsWith("scrypt$");
}

/**
 * Does `password` equal a pre-upgrade cleartext value?
 *
 * NEVER an authentication check: a legacy value cannot sign anyone in. Login
 * uses it only to decide whether the caller may be told the account must be
 * re-activated, which is account state that must not reach someone who does
 * not hold the credential. Both sides are hashed first so the comparison is
 * constant-time whatever their lengths.
 */
export function legacyCredentialMatches(password: string, stored: string | null): boolean {
  if (!stored || !isLegacyHash(stored)) return false;
  const a = crypto.createHash("sha256").update(password, "utf8").digest();
  const b = crypto.createHash("sha256").update(stored, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Generate a temporary password for an administrator to hand to a user.
 *
 * Shape: `Xkm7-Rpq2-Vwd9` — four-character groups separated by hyphens.
 * Chosen so it survives being read aloud, retyped, or copied out of a chat
 * window, which is what actually happens to temporary passwords in practice.
 *
 * The alphabet omits characters that are routinely misread: O/0, I/l/1, S/5,
 * B/8, Z/2. Every character comes from `crypto.randomInt`, which is uniform and
 * unbiased — `Math.random()` would be neither, and this value is a credential.
 *
 * Guaranteed to satisfy the configured policy: the groups supply upper, lower
 * and digit, the hyphens supply the required symbol, and the total length
 * (14 with the default 3 groups) clears a 12-character minimum. If the deployed
 * minimum is longer, more groups are added until it fits.
 */
export function generateTemporaryPassword(): string {
  const UPPER = "ACDEFHJKLMNPQRTUVWXY";  // no B, G, I, O, S, Z
  const LOWER = "abcdefghjkmnpqrtuvwxy"; // no i, l, o, s, z
  const DIGIT = "34679";                 // no 0, 1, 2, 5, 8

  const pick = (alphabet: string) => alphabet[crypto.randomInt(alphabet.length)];

  const group = (): string => {
    // Each group: one upper, one digit, two lower — then shuffled, so the
    // character classes are not in a predictable position.
    const chars = [pick(UPPER), pick(DIGIT), pick(LOWER), pick(LOWER)];
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
  };

  const groups: string[] = [];
  do {
    groups.push(group());
  } while (groups.join("-").length < Math.max(authConfig.password.minLength, 12));

  return groups.join("-");
}

/** True when an admin-issued temporary password has passed its expiry. */
export function isPasswordExpired(passwordExpiresAt: Date | null): boolean {
  return !!passwordExpiresAt && passwordExpiresAt.getTime() <= Date.now();
}

// ── Password policy ──────────────────────────────────────────────────────────

/** Words that must not appear in a password for this product. */
const PRODUCT_WORDS = ["integrated", "suite", "websynergies", "web synergies", "nexus", "iot", "nexusiot"];

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  blockCommon: boolean;
  blockContextual: boolean;
  /** Human-readable rules, rendered by the activation/reset UI. */
  description: string[];
}

export function getPasswordPolicy(): PasswordPolicy {
  const p = authConfig.password;
  const description = [
    `At least ${p.minLength} characters`,
    ...(p.requireUppercase ? ["One uppercase letter (A–Z)"] : []),
    ...(p.requireLowercase ? ["One lowercase letter (a–z)"] : []),
    ...(p.requireDigit ? ["One number (0–9)"] : []),
    ...(p.requireSymbol ? ["One symbol (!@#$…)"] : []),
    ...(p.blockContextual ? ["Must not contain your name, username, or email"] : []),
  ];
  return {
    minLength: p.minLength,
    maxLength: p.maxLength,
    requireUppercase: p.requireUppercase,
    requireLowercase: p.requireLowercase,
    requireDigit: p.requireDigit,
    requireSymbol: p.requireSymbol,
    blockCommon: false,
    blockContextual: p.blockContextual,
    description,
  };
}

export interface PasswordContext {
  username?: string | null;
  email?: string | null;
  fullName?: string | null;
}

/**
 * Validate a candidate password against the configured policy.
 * Returns every failure at once so the UI can show a complete checklist rather
 * than making the user guess one rule at a time.
 */
export function validatePassword(password: string, context: PasswordContext = {}): string[] {
  const p = authConfig.password;
  const errors: string[] = [];

  if (typeof password !== "string" || password.length === 0) {
    return ["Password is required"];
  }
  if (password.length < p.minLength) errors.push(`Password must be at least ${p.minLength} characters`);
  if (password.length > p.maxLength) errors.push(`Password must be at most ${p.maxLength} characters`);
  if (p.requireUppercase && !/[A-Z]/.test(password)) errors.push("Password must contain an uppercase letter");
  if (p.requireLowercase && !/[a-z]/.test(password)) errors.push("Password must contain a lowercase letter");
  if (p.requireDigit && !/[0-9]/.test(password)) errors.push("Password must contain a number");
  if (p.requireSymbol && !/[^A-Za-z0-9]/.test(password)) errors.push("Password must contain a symbol");
  if (/^\s|\s$/.test(password)) errors.push("Password must not begin or end with whitespace");

  const lower = password.toLowerCase();

  if (p.blockContextual) {
    const needles = [
      context.username,
      context.email?.split("@")[0],
      ...(context.fullName?.split(/\s+/) ?? []),
      ...PRODUCT_WORDS,
    ]
      .filter((s): s is string => typeof s === "string" && s.length >= 4)
      .map((s) => s.toLowerCase());

    if (needles.some((n) => lower.includes(n))) {
      errors.push("Password must not contain your name, username, email, or the product name");
    }
  }

  return errors;
}
