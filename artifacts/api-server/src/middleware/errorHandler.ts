import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";
import { toPublicError, correlationIdOf, isExpected, logContext } from "../lib/errors";

/**
 * Correlation id, attached before anything can fail.
 *
 * Mounted first so the id exists for every log line a request produces, not just
 * the error at the end — which is what makes it possible to reconstruct what a
 * user was doing before the failure, rather than seeing the failure alone.
 *
 * Returned on EVERY response, not only errors. A user reporting "the page was
 * slow" or "the number looked wrong" has no error to quote otherwise, and those
 * are the reports that are hardest to trace.
 *
 * An inbound `X-Correlation-Id` is accepted so a trace can span the SPA, nginx
 * and this process — but it is validated and truncated rather than trusted. It
 * ends up in log files, and an unbounded client-controlled string in a log is
 * how log injection and log-viewer XSS start.
 */
export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers["x-correlation-id"];
  const raw = Array.isArray(inbound) ? inbound[0] : inbound;

  if (typeof raw === "string" && /^[A-Za-z0-9-]{8,64}$/.test(raw)) {
    req.correlationId = raw;
  }
  const id = correlationIdOf(req);

  res.setHeader("X-Correlation-Id", id);
  next();
}

/**
 * The last stop for anything thrown or rejected in a route.
 *
 * Express 5 forwards rejected async handlers here automatically, so a route that
 * simply lets a database error propagate ends up with a safe response and a
 * complete log entry — which is the reason most route-level `try/catch` blocks
 * in this codebase could be deleted rather than fixed.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const id = correlationIdOf(req);
  const expected = isExpected(err);

  // The log gets everything: stack, Postgres code, constraint name, who was
  // signed in. The response gets none of it. That asymmetry is the whole point —
  // the information is not destroyed, it is moved somewhere access-controlled.
  const entry = {
    correlationId: id,
    method: req.method,
    // Query strings can carry identifiers and filters; the path alone is enough
    // to locate the route and does not risk logging a token someone appended.
    path: req.path,
    status: (err as { status?: number })?.status ?? 500,
    userId: req.principal?.user.id ?? null,
    username: req.principal?.user.username ?? null,
    apiClientId: req.apiClient?.id ?? null,
    ...logContext(err),
    err,
  };

  if (expected) {
    // A 4xx from a user mistake is not an incident. Logged without a stack so it
    // does not drown the entries that need attention.
    logger.info({ ...entry, err: undefined, reason: (err as Error)?.message }, "request rejected");
  } else {
    logger.error(entry, "unhandled error");
  }

  if (res.headersSent) {
    // Too late to change the body; the log above is the only record. Ending the
    // response prevents a half-written one hanging the client.
    res.end();
    return;
  }

  const { status, body } = toPublicError(err, id);
  res.status(status).json(body);
}

/**
 * 404 for anything that reached the end of the router.
 *
 * Deliberately says nothing about WHY. Distinguishing "no such route" from "that
 * route exists but not for this method" is a free map of the API surface.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: "The requested endpoint does not exist.",
    code: "not_found",
    correlationId: correlationIdOf(req),
  });
}
