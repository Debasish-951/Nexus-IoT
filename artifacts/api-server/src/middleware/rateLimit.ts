import type { Request, Response, NextFunction } from "express";
import { recordSecurityEvent, type SecurityEventType } from "../lib/security-log";
import { clientAddress, subnetKey, warnOnUntrustedForwardHeader } from "../lib/client-ip";
import { RateLimitStore, registerStore, type Decision } from "../lib/rate-limit-store";
import { authConfig } from "../lib/auth-config";
import { logger } from "../lib/logger";

/**
 * Request rate limiting.
 *
 * Layered, because no single dimension is sufficient on its own:
 *
 *   per IP       stops one host hammering one endpoint
 *   per subnet   stops the same host using 256 addresses it rented for £2,
 *                and stops an IPv6 client walking its own /64
 *   per account  stops a password spray reaching one account from 10,000 IPs —
 *                the dimension the attacker cannot rotate, because the target
 *                username is the one thing they must keep constant
 *   per user     stops an authenticated user (or a stolen session) abusing the
 *                expensive endpoints, which per-IP limits miss entirely when
 *                the traffic comes from a normal office address
 *   global       catches low-and-slow spraying that is under every individual
 *                ceiling but anomalous in aggregate
 *
 * All configured dimensions must pass. The 429 reports the longest wait, so a
 * caller retrying at exactly `Retry-After` is not immediately rejected again by
 * a different dimension.
 */

export type Dimension = "ip" | "subnet" | "user" | "account" | "client";

export interface Limit {
  max: number;
  windowMs: number;
}

export interface LimiterSpec {
  /** Counter namespace. Distinct names never share budget. */
  name: string;
  limits: Partial<Record<Dimension, Limit>>;
  /**
   * Extracts the account being acted upon — the username in a login body, the
   * email in a password-reset request. Enables the `account` dimension.
   */
  accountFrom?: (req: Request) => string | null | undefined;
  /** Units this request consumes. Lets one budget cover cheap and costly routes. */
  cost?: number | ((req: Request) => number);
  /** Skip entirely (e.g. machine callers with their own limiter). */
  skip?: (req: Request) => boolean;
  eventType?: SecurityEventType;
  /** Message returned on 429. */
  message?: string;
}

// ── Spray detection ──────────────────────────────────────────────────────────
//
// A distributed brute force is invisible to every per-key counter by
// construction: the attacker's whole strategy is to stay under each one. What it
// cannot hide is the aggregate — a sustained, unusual number of authentication
// FAILURES across the whole system.
//
// Crossing the threshold puts the process into "spray mode" for a period, which
// divides every auth-related ceiling. Deliberately narrow: it tightens only the
// auth limiters, never general API traffic, so an attack cannot be used to
// disrupt signed-in users going about their work. It also fires an audit event,
// because the useful response to a spray is a human looking at it.
let sprayUntil = 0;
let sprayFailures: number[] = [];

export function isSprayMode(): boolean {
  return Date.now() < sprayUntil;
}

/** Called on every authentication failure, wherever it originates. */
export function recordAuthFailure(req?: Request): void {
  const { max, windowMs, tightenMs } = authConfig.rateLimit.spray;
  if (max <= 0) return;

  const now = Date.now();
  sprayFailures.push(now);
  if (sprayFailures.length > max * 4) {
    sprayFailures = sprayFailures.filter((t) => now - t < windowMs);
  }

  if (isSprayMode()) return; // already tightened; do not keep re-arming or logging

  const recent = sprayFailures.filter((t) => now - t < windowMs);
  sprayFailures = recent;
  if (recent.length < max) return;

  sprayUntil = now + tightenMs;
  logger.warn(
    { failures: recent.length, windowMs, tightenMs },
    "possible distributed credential attack — authentication rate limits tightened",
  );
  recordSecurityEvent({
    type: "auth.spray_detected",
    outcome: "failure",
    reason: "auth_failure_velocity",
    detail: { failures: recent.length, windowMs, tightenedForMs: tightenMs },
    req,
  });
}

/** Ceilings are divided while a spray is in progress. */
function effectiveMax(max: number, tighten: boolean): number {
  if (!tighten || !isSprayMode()) return max;
  return Math.max(1, Math.floor(max / authConfig.rateLimit.spray.divisor));
}

// ── The limiter ──────────────────────────────────────────────────────────────

const stores = new Map<string, RateLimitStore>();
function storeFor(name: string, windowMs: number): RateLimitStore {
  let s = stores.get(name);
  if (!s) {
    s = registerStore(new RateLimitStore(name), Math.max(windowMs * 2, 600_000));
    stores.set(name, s);
  }
  return s;
}

function keyFor(dim: Dimension, req: Request, spec: LimiterSpec): string | null {
  switch (dim) {
    case "ip":     return clientAddress(req);
    case "subnet": return subnetKey(clientAddress(req));
    case "user":   return req.principal?.user.id ?? null;
    case "client": return req.apiClient?.id ?? null;
    case "account": {
      const raw = spec.accountFrom?.(req);
      // Normalised so "Admin", "admin " and "ADMIN" share one bucket — otherwise
      // case variation alone multiplies the attacker's budget.
      return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase().slice(0, 320) : null;
    }
  }
}

/**
 * Whether this limiter's ceilings tighten during a spray. True for anything
 * keyed on an account or guarding credentials; false for ordinary API traffic.
 */
function tightensUnderSpray(spec: LimiterSpec): boolean {
  return spec.limits.account !== undefined || spec.name.startsWith("auth:");
}

export function rateLimit(spec: LimiterSpec) {
  const dims = Object.entries(spec.limits) as Array<[Dimension, Limit]>;
  const tighten = tightensUnderSpray(spec);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (spec.skip?.(req)) { next(); return; }

    warnOnUntrustedForwardHeader(req);

    const cost = typeof spec.cost === "function" ? spec.cost(req) : spec.cost ?? 1;

    // Two passes. Every dimension is checked before ANY is charged, so a request
    // rejected by the last dimension has not already consumed budget from the
    // earlier ones — otherwise a blocked caller would still burn down the
    // shared subnet allowance for everyone behind the same NAT.
    const active: Array<{ dim: Dimension; key: string; limit: Limit; max: number; store: RateLimitStore }> = [];
    let worst: (Decision & { dim: Dimension }) | null = null;

    for (const [dim, limit] of dims) {
      if (limit.max <= 0) continue;             // 0 disables this dimension
      const key = keyFor(dim, req, spec);
      if (!key) continue;                        // dimension not applicable here
      const max = effectiveMax(limit.max, tighten);
      const store = storeFor(`${spec.name}:${dim}`, limit.windowMs);
      const d = store.peek(key, max, limit.windowMs, cost);
      if (!d.allowed && (!worst || d.retryAfter > worst.retryAfter)) worst = { ...d, dim };
      active.push({ dim, key, limit, max, store });
    }

    if (worst) {
      res.setHeader("Retry-After", String(worst.retryAfter));
      setLimitHeaders(res, worst);
      if (spec.eventType) {
        recordSecurityEvent({
          type: spec.eventType,
          outcome: "failure",
          reason: "rate_limited",
          username: spec.accountFrom?.(req) ?? null,
          userId: req.principal?.user.id ?? null,
          // The dimension is recorded but the KEY is not: it is either already in
          // the event's own ip/username columns or it is somebody else's
          // identifier that this request has no business naming.
          detail: { limiter: spec.name, dimension: worst.dim, limit: worst.limit, sprayMode: isSprayMode() },
          req,
        });
      }
      res.status(429).json({
        error: spec.message ?? "Too many requests. Please slow down and try again.",
        code: "rate_limited",
        retryAfter: worst.retryAfter,
      });
      return;
    }

    let tightest: Decision | null = null;
    for (const a of active) {
      const d = a.store.hit(a.key, a.max, a.limit.windowMs, cost);
      if (!tightest || d.remaining < tightest.remaining) tightest = d;
    }
    if (tightest) setLimitHeaders(res, tightest);

    next();
  };
}

/**
 * Advertise the budget on every response, not only on the 429.
 *
 * A well-behaved integration can then slow down BEFORE it is rejected, which is
 * the difference between a gateway that paces itself and one that discovers the
 * limit by losing telemetry. Both the RFC draft names and the widely-deployed
 * X- names are sent; clients in the wild look for either.
 */
function setLimitHeaders(res: Response, d: Decision): void {
  if (res.headersSent) return;
  res.setHeader("RateLimit-Limit", String(d.limit));
  res.setHeader("RateLimit-Remaining", String(d.remaining));
  res.setHeader("RateLimit-Reset", String(d.reset));
  res.setHeader("X-RateLimit-Limit", String(d.limit));
  res.setHeader("X-RateLimit-Remaining", String(d.remaining));
  res.setHeader("X-RateLimit-Reset", String(d.reset));
}

/**
 * Clear a caller's counters for one limiter after a genuine success.
 *
 * Failed attempts are what we are limiting; a user who mistypes twice and then
 * signs in correctly should not spend the next 5 minutes near the ceiling. The
 * account and IP dimensions are cleared together because a successful sign-in
 * is evidence about the pair, not about either alone.
 */
export function resetLimiter(name: string, req: Request, account?: string | null): void {
  const ip = clientAddress(req);
  stores.get(`${name}:ip`)?.reset(ip);
  stores.get(`${name}:subnet`)?.reset(subnetKey(ip));
  if (account?.trim()) stores.get(`${name}:account`)?.reset(account.trim().toLowerCase().slice(0, 320));
  if (req.principal?.user.id) stores.get(`${name}:user`)?.reset(req.principal.user.id);
}

// ── Backwards-compatible shim ────────────────────────────────────────────────
//
// The original single-dimension helper. Kept so any caller not yet migrated
// keeps working, but it now routes through the layered limiter and therefore
// picks up subnet coverage and the standard headers for free.
export function ipRateLimit(options: {
  name: string;
  max: number;
  windowMs: number;
  keyFor?: (req: Request) => string | null;
  eventType?: SecurityEventType;
}) {
  return rateLimit({
    name: options.name,
    limits: {
      ip: { max: options.max, windowMs: options.windowMs },
      subnet: { max: options.max * authConfig.rateLimit.subnetMultiplier, windowMs: options.windowMs },
    },
    eventType: options.eventType,
  });
}

/** @deprecated use resetLimiter — kept so existing call sites still compile. */
export function resetRateLimit(name: string, key: string | null): void {
  if (key) stores.get(`${name}:ip`)?.reset(key);
}
