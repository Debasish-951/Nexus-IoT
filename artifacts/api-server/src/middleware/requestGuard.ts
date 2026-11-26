import type { Request, Response, NextFunction } from "express";
import { checkJsonStructure, DEFAULT_JSON_LIMITS, PLANT_SCENE_JSON_LIMITS, type JsonLimits } from "../lib/validation";
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

/**
 * Routes whose own validate() allows more keys than the global floor. Without
 * this the guard refused a Live Twin scene of 20,000 to 40,000 keys that the
 * plant-twin route itself accepts (audit M-15). Only the key count is raised.
 */
const PLANT_TWIN_SAVE = /^\/api\/plant-twins(?:\/[^/]+)?\/?$/;
export function guardLimitsFor(method: string, path: string): JsonLimits {
  if ((method === "POST" || method === "PUT") && PLANT_TWIN_SAVE.test(path)) {
    return { ...GLOBAL_LIMITS, maxKeys: Math.max(GLOBAL_LIMITS.maxKeys, PLANT_SCENE_JSON_LIMITS.maxKeys) };
  }
  return GLOBAL_LIMITS;
}

export function requestGuard(req: Request, res: Response, next: NextFunction): void {
  // GET/HEAD/DELETE carry no body worth walking; express.json leaves `{}`.
  const body: unknown = req.body;
  if (!body || typeof body !== "object") { next(); return; }

  const result = checkJsonStructure(body, guardLimitsFor(req.method, req.path));
  if (result.ok) { next(); return; }

  // Too big is not an attack: a large plant or dashboard can be refused here
  // honestly. It is answered with the same 400 but not recorded as a security event.
  if (result.kind === "size") {
    logger.info(
      { path: req.path, method: req.method, reason: result.error },
      "request body refused: larger than the structural guard allows",
    );
    res.status(400).json({
      error: "The request body was rejected: " + result.error,
      code: "malformed_body",
    });
    return;
  }

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
