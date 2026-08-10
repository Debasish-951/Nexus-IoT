import type { Request } from "express";
import { rateLimit } from "./rateLimit";
import { authConfig } from "../lib/auth-config";

/**
 * The two limiters that apply to the API as a whole.
 *
 * They are mounted at different points in the chain on purpose — see app.ts.
 */

/**
 * Stage 1: flood guard, mounted FIRST, ahead of session and API-key resolution.
 *
 * Both of those do a database round trip, so a limiter placed after them can
 * still be used to generate unbounded database load: the attacker gets rejected,
 * but only after the query has run. This one rejects on nothing but the source
 * address, before any I/O happens.
 *
 * The ceiling is deliberately far above real usage. It is not a policy, it is a
 * backstop; the per-user and per-endpoint limits downstream do the actual work.
 */
export const floodGuard = rateLimit({
  name: "flood",
  limits: {
    ip: authConfig.rateLimit.flood,
    subnet: {
      max: authConfig.rateLimit.flood.max * authConfig.rateLimit.subnetMultiplier,
      windowMs: authConfig.rateLimit.flood.windowMs,
    },
  },
  eventType: "ratelimit.tripped",
  message: "Too many requests from your network. Please slow down.",
});

/**
 * Stage 2: per-principal limiting, mounted AFTER authentication.
 *
 * Keys on the user id when there is a session, so the limit follows the account
 * rather than the address — one user cannot escape it by changing network, and a
 * whole office behind one NAT is not throttled as if it were a single client.
 * Unauthenticated requests fall back to the IP dimension, which is all there is
 * to key on.
 *
 * Exclusions, both deliberate:
 *
 *   - Machine callers (`req.apiClient`) are limited per client in apiKeyAuth,
 *     with a much higher ceiling sized for telemetry. Applying this limiter to
 *     them as well would silently re-impose a lower cap on ingest and drop
 *     readings — and a rejected ingest post is lost data, not a retried page.
 *   - `/auth/*` has its own stricter limiters. Counting those requests here too
 *     would mean a user locked out of login also loses their API budget.
 */
export const apiRateLimit = rateLimit({
  name: "api",
  limits: {
    user: authConfig.rateLimit.api,
    ip: authConfig.rateLimit.api,
    subnet: {
      max: authConfig.rateLimit.api.max * authConfig.rateLimit.subnetMultiplier,
      windowMs: authConfig.rateLimit.api.windowMs,
    },
  },
  skip: (req: Request) => !!req.apiClient || req.path.startsWith("/auth/"),
  // An export builds and serialises an entire dataset; a hundred of those is not
  // the same load as a hundred reads of one asset, and a single budget that
  // cannot tell them apart has to be set wrong for one of the two.
  cost: (req: Request) => (req.path.startsWith("/export") ? authConfig.rateLimit.exportCost : 1),
  eventType: "ratelimit.tripped",
});
