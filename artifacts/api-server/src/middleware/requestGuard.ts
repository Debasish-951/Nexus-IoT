import type { Request, Response, NextFunction } from "express";
import { checkJsonStructure, DEFAULT_JSON_LIMITS } from "../lib/validation";
import { recordSecurityEvent } from "../lib/security-log";
import { logger } from "../lib/logger";

/**
 * Baseline structural guard for every request body, mounted app-wide.
 *
 * `validate()` is stricter but only protects the routes it is attached to. This
 * is the floor underneath it: a route added tomorrow without a schema still
 * cannot be sent a prototype-polluting key or an object nested a thousand deep.
 *
 * The distinction matters because the failure mode of per-route validation is
 * silent — nothing tells you a new route has no schema, it just quietly accepts
 * whatever arrives. Defence that has to be remembered is defence that lapses.
 *
 * Limits here are looser than the per-route ones on purpose: this is a backstop
 * for the pathological, not a policy. Ingest legitimately posts large batches,
 * and a guard that broke telemetry would be removed within the day.
 */

const GLOBAL_LIMITS = {
  ...DEFAULT_JSON_LIMITS,
  // Ingest accepts batches, and a dashboard export can be a big object.
  maxKeys: 20_000,
  maxArrayLength: 20_000,
  maxDepth: 20,
};

export function requestGuard(req: Request, res: Response, next: NextFunction): void {
  // GET/HEAD/DELETE carry no body worth walking; express.json leaves `{}`.
  const body: unknown = req.body;
  if (!body || typeof body !== "object") { next(); return; }

  const result = checkJsonStructure(body, GLOBAL_LIMITS);
  if (result.ok) { next(); return; }

  // Nothing produces these by accident. A legitimate client does not nest 20
  // levels deep or send a key called `__proto__`, so this is recorded as a
  // security event rather than a routine 400.
  logger.warn(
    { path: req.path, method: req.method, reason: result.error },
    "request body rejected by structural guard",
  );
  recordSecurityEvent({
    type: "input.rejected",
    outcome: "failure",
    reason: "malformed_body",
    userId: req.principal?.user.id ?? null,
    username: req.principal?.user.username ?? null,
    detail: { path: req.path, method: req.method, error: result.error },
    req,
  });

  res.status(400).json({
    error: "The request body was rejected: " + result.error,
    code: "malformed_body",
  });
}
