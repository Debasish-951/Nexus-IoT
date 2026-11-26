import { createHmac, randomBytes } from "node:crypto";

/**
 * Sign-in lockout per (account, source network) (audit 23 Nov 2026, M-1).
 *
 * The old lockout was per ACCOUNT: five wrong passwords from anywhere locked the
 * account for everyone, and the live-session check then ended the owner's open
 * sessions. Anyone who knew a username could do that to any user, again and
 * again, administrators included.
 *
 * Now:
 *   - Wrong passwords lock only the pair (account, network the guesses came
 *     from: IPv4 /24, IPv6 /64). The owner signing in from their own network is
 *     not affected by a stranger's guesses.
 *   - A much higher account-wide threshold (AUTH_LOCKOUT_ACCOUNT_THRESHOLD) still
 *     locks the account itself in the database, against guessing spread over many
 *     networks. Together with the per-account rate limit this keeps distributed
 *     guessing as slow as before.
 *   - A lock never ends sessions that are already signed in (middleware/principal.ts).
 *
 * Kept in memory: a restart clears the per-network locks, but not the durable
 * account-wide lock or the rate-limit and spray protections. Keys are HMACs
 * under a per-process salt, so a heap dump holds no addresses.
 */

const SALT = randomBytes(32);
const MAX_ENTRIES = 50_000;

interface Entry { failures: number; lockedUntil: number; seen: number }
const entries = new Map<string, Entry>();

function keyFor(userId: string, network: string): string {
  const digest = createHmac("sha256", SALT).update(network).digest("base64url").slice(0, 22);
  return `${userId}|${digest}`;
}

function sweep(now: number, windowMs: number): void {
  if (entries.size < MAX_ENTRIES) return;
  for (const [k, e] of entries) {
    if (e.lockedUntil <= now && now - e.seen > windowMs) entries.delete(k);
  }
  // Still full (a flood of distinct networks): drop the oldest half.
  if (entries.size >= MAX_ENTRIES) {
    const keys = [...entries.keys()].slice(0, Math.floor(entries.size / 2));
    for (const k of keys) entries.delete(k);
  }
}

/** Milliseconds this network must still wait before signing in to this account; 0 when not locked. */
export function sourceLockRemainingMs(userId: string, network: string, now = Date.now()): number {
  const e = entries.get(keyFor(userId, network));
  return e && e.lockedUntil > now ? e.lockedUntil - now : 0;
}

/**
 * Count one wrong password from this network. Returns true when this failure
 * locked the pair. Failures older than the lock duration are forgotten, so a
 * user who mistypes now and then never accumulates towards a lock.
 */
export function registerSourceFailure(
  userId: string,
  network: string,
  threshold: number,
  durationMs: number,
  now = Date.now(),
): boolean {
  if (threshold <= 0) return false;
  sweep(now, durationMs);
  const key = keyFor(userId, network);
  const prev = entries.get(key);
  const stale = !prev || (prev.lockedUntil <= now && now - prev.seen > durationMs);
  const failures = (stale ? 0 : prev!.failures) + 1;
  const lock = failures >= threshold;
  entries.set(key, { failures: lock ? 0 : failures, lockedUntil: lock ? now + durationMs : stale ? 0 : prev!.lockedUntil, seen: now });
  return lock;
}

/** Clear this network's count for the account (after a correct password). */
export function clearSourceFailures(userId: string, network: string): void {
  entries.delete(keyFor(userId, network));
}

/** Clear every network's count for the account (administrator unlock, password reset). */
export function clearAllSourceLocks(userId: string): void {
  const prefix = `${userId}|`;
  for (const k of entries.keys()) if (k.startsWith(prefix)) entries.delete(k);
}

/** Test hook. */
export function resetLoginLockoutsForTests(): void {
  entries.clear();
}
