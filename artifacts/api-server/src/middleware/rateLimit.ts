import type { Request, Response, NextFunction } from "express";
import { clientIp, recordSecurityEvent } from "../lib/security-log";

/**
 * Per-IP sliding-window rate limiter for the unauthenticated auth endpoints.
 *
 * Layered *under* per-account lockout: lockout stops one account being guessed,
 * this stops one source spraying many accounts (which lockout alone cannot see).
 *
 * In-memory, matching the existing per-client limiter in apiKeyAuth.ts. That is
 * correct for the current single-instance deployment; behind more than one
 * instance this becomes per-instance and must move to Redis. Called out in
 * docs/security/auth-upgrade.md §1.6.
 */

interface Bucket { hits: number[]; }

const stores = new Map<string, Map<string, Bucket>>();

// Bound memory: an attacker rotating source IPs must not grow the map forever.
const MAX_KEYS_PER_STORE = 10_000;

function storeFor(name: string): Map<string, Bucket> {
  let store = stores.get(name);
  if (!store) { store = new Map(); stores.set(name, store); }
  return store;
}

export interface RateLimitOptions {
  /** Distinct bucket namespace, e.g. "login". */
  name: string;
  max: number;
  windowMs: number;
  /** Defaults to the client IP. Return null to skip limiting for this request. */
  keyFor?: (req: Request) => string | null;
  /** Event type recorded when the limit trips. */
  eventType?: "login.rate_limited";
}

export function ipRateLimit(options: RateLimitOptions) {
  const { name, max, windowMs } = options;
  const store = storeFor(name);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (max <= 0) { next(); return; }

    const key = options.keyFor ? options.keyFor(req) : clientIp(req);
    if (!key) { next(); return; }

    const now = Date.now();
    const bucket = store.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

    if (bucket.hits.length >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - bucket.hits[0])) / 1000));
      store.set(key, bucket);

      if (options.eventType) {
        recordSecurityEvent({
          type: options.eventType,
          outcome: "failure",
          reason: "rate_limited",
          detail: { bucket: name, limit: max, windowMs },
          req,
        });
      }

      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        error: "Too many attempts. Please wait and try again.",
        code: "rate_limited",
        retryAfter: retryAfterSec,
      });
      return;
    }

    bucket.hits.push(now);
    store.set(key, bucket);

    if (store.size > MAX_KEYS_PER_STORE) sweep(store, windowMs);
    next();
  };
}

/** Clear a key after a successful attempt so a legitimate user is not penalised. */
export function resetRateLimit(name: string, key: string | null): void {
  if (key) storeFor(name).delete(key);
}

function sweep(store: Map<string, Bucket>, windowMs: number): void {
  const now = Date.now();
  for (const [key, bucket] of store) {
    if (bucket.hits.every((t) => now - t >= windowMs)) store.delete(key);
  }
  // Still oversized after sweeping (a genuine distributed flood): drop the
  // oldest half rather than growing without bound. Worst case an attacker
  // buys themselves a reset — lockout and the DB-backed event log still apply.
  if (store.size > MAX_KEYS_PER_STORE) {
    const keys = [...store.keys()].slice(0, Math.floor(store.size / 2));
    for (const key of keys) store.delete(key);
  }
}

// Periodic sweep so idle buckets do not linger between bursts.
const sweeper = setInterval(() => {
  for (const store of stores.values()) sweep(store, 3_600_000);
}, 300_000);
sweeper.unref?.();
