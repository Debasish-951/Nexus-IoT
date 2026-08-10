import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";
import { checkJsonStructure, DEFAULT_JSON_LIMITS, type JsonLimits } from "../lib/validation";
import { recordSecurityEvent } from "../lib/security-log";

/**
 * Centralised request validation.
 *
 * ── The two problems this solves ─────────────────────────────────────────────
 *
 * 1. Validation was per-route and inconsistent. Thirteen route files had none at
 *    all, and the ones that did each hand-rolled their own 400 shape, so the
 *    frontend could not reliably tell a user WHICH field was wrong.
 *
 * 2. `z.object()` in Zod 3 STRIPS unknown keys — it does not reject them. Every
 *    `safeParse` in this codebase therefore accepted `{"name":"x","role":"admin"}`
 *    without complaint, silently discarding `role`. Discarding is safe on its own,
 *    but it means an integration can send a field for months, believe it is being
 *    honoured, and never be told otherwise. `.strict()` turns that into an error.
 *
 * ── How it validates ─────────────────────────────────────────────────────────
 *
 * Allow-list, at three levels:
 *
 *   structure  before any schema runs, the parsed body is walked for depth,
 *              breadth and prototype-polluting keys
 *   shape      every object schema is made `.strict()`, so an undeclared field
 *              is a 400 rather than a silent drop
 *   value      each field's own primitive constrains type, format, length, range
 *
 * The parsed result REPLACES `req.body` / `req.query` / `req.params`. That is
 * what makes the allow-list real rather than advisory: a route handler reading
 * `req.body.whatever` can only ever see a field the schema declared, so a later
 * `{...req.body}` into a database update cannot carry a surprise column. It also
 * means coercions and trimming apply exactly once, at the boundary.
 */

// ── Error shape ──────────────────────────────────────────────────────────────

export interface FieldError {
  /** Dotted path, e.g. "config.series.0.metric". */
  field: string;
  message: string;
}

function toFieldErrors(err: z.ZodError): FieldError[] {
  return err.issues.slice(0, 25).map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message:
      // Zod's default text for an unknown key names the key but not the fix.
      issue.code === "unrecognized_keys"
        ? `unexpected field${issue.keys.length > 1 ? "s" : ""}: ${issue.keys.join(", ")}`
        : issue.message,
  }));
}

/**
 * Recursively force `.strict()` on every object in a schema.
 *
 * Applied here rather than asked of each schema author, because "reject unknown
 * fields" is a property the API should have everywhere, and a rule that depends
 * on remembering to add `.strict()` to each new schema is a rule that will be
 * incomplete within a month. It also lets the GENERATED schemas — which are
 * never hand-edited — gain the behaviour without being touched.
 *
 * Unwraps the wrappers Orval emits (optional, nullable, default, effects) so a
 * nested `z.object()` inside `z.array()` inside `.optional()` is still reached.
 */
function strictify(schema: z.ZodTypeAny, depth = 0): z.ZodTypeAny {
  // Cheap insurance against a pathological or self-referencing schema.
  if (depth > 12) return schema;

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const next: Record<string, z.ZodTypeAny> = {};
    for (const key of Object.keys(shape)) next[key] = strictify(shape[key], depth + 1);
    return z.object(next).strict();
  }
  if (schema instanceof z.ZodArray) {
    return z.array(strictify(schema.element as z.ZodTypeAny, depth + 1));
  }
  if (schema instanceof z.ZodOptional) {
    return strictify(schema.unwrap() as z.ZodTypeAny, depth + 1).optional();
  }
  if (schema instanceof z.ZodNullable) {
    return strictify(schema.unwrap() as z.ZodTypeAny, depth + 1).nullable();
  }
  if (schema instanceof z.ZodDefault) {
    return strictify(schema.removeDefault() as z.ZodTypeAny, depth + 1)
      .default((schema._def as { defaultValue: () => unknown }).defaultValue());
  }
  if (schema instanceof z.ZodUnion) {
    const opts = (schema.options as z.ZodTypeAny[]).map((o) => strictify(o, depth + 1));
    return z.union(opts as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }
  // ZodEffects (from .transform/.superRefine) and everything else are returned
  // untouched: their inner type is already constrained by whoever wrote it, and
  // rebuilding an effect chain here would drop the refinement.
  return schema;
}

// Strictifying walks the whole schema, so do it once per schema object rather
// than on every request.
const strictCache = new WeakMap<z.ZodTypeAny, z.ZodTypeAny>();
function strictOnce(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s = strictCache.get(schema);
  if (!s) { s = strictify(schema); strictCache.set(schema, s); }
  return s;
}

// ── The middleware ───────────────────────────────────────────────────────────

export interface ValidateSpec {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  /**
   * Skip the strictness pass for this schema. For genuinely open-ended payloads
   * — ingest, widget config — where the whole point is that the keys are not
   * known in advance. Structural limits still apply.
   */
  allowUnknown?: boolean;
  /** Override structural limits (ingest batches are legitimately larger). */
  jsonLimits?: Partial<JsonLimits>;
}

export function validate(spec: ValidateSpec) {
  const limits: JsonLimits = { ...DEFAULT_JSON_LIMITS, ...spec.jsonLimits };

  return (req: Request, res: Response, next: NextFunction): void => {
    // 1. Structure, before any schema. A 200-level-deep object must be rejected
    //    on shape alone — running a schema over it first is what would blow the
    //    stack, and the schema is the thing doing the recursing.
    if (spec.body !== undefined && req.body !== undefined && req.body !== null) {
      const structural = checkJsonStructure(req.body, limits);
      if (!structural.ok) {
        reject(req, res, [{ field: "(body)", message: structural.error! }], "malformed_body");
        return;
      }
    }

    // 2. Shape and value.
    for (const target of ["params", "query", "body"] as const) {
      const schema = spec[target];
      if (!schema) continue;

      const effective = spec.allowUnknown ? schema : strictOnce(schema);
      const result = effective.safeParse(req[target]);

      if (!result.success) {
        reject(req, res, toFieldErrors(result.error), `invalid_${target}`);
        return;
      }

      // 3. Replace with the parsed value — the allow-list made real.
      //
      //    `req.query` and `req.params` are getter-only on Express 5, so they
      //    are redefined rather than assigned. Without this the handler would
      //    keep reading the raw, uncoerced values and every constraint above
      //    would be decorative.
      if (target === "body") {
        req.body = result.data;
      } else {
        Object.defineProperty(req, target, {
          value: result.data,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
    }

    next();
  };
}

function reject(req: Request, res: Response, errors: FieldError[], code: string): void {
  // Logged at debug: a 400 is usually a client bug, and logging every one at
  // warn turns a misconfigured integration into a flooded log. The security
  // event below is reserved for the cases that indicate intent.
  logger.debug({ path: req.path, method: req.method, errors }, "request rejected by validation");

  // A payload carrying a prototype-polluting key or absurd nesting is not a
  // typo — nothing generates that by accident. Those go to the audit trail.
  if (code === "malformed_body") {
    recordSecurityEvent({
      type: "input.rejected",
      outcome: "failure",
      reason: "malformed_body",
      userId: req.principal?.user.id ?? null,
      username: req.principal?.user.username ?? null,
      detail: { path: req.path, method: req.method, error: errors[0]?.message },
      req,
    });
  }

  res.status(400).json({
    error: "The request could not be accepted because some values were not valid.",
    code,
    // Field-level detail so the UI can mark the offending input. Deliberately
    // says what is wrong with the value, never echoes the value itself — an
    // error message is a rendering surface like any other.
    errors,
  });
}

/**
 * Body-only shorthand, which is most call sites.
 */
export const validateBody = (schema: z.ZodTypeAny, opts?: Omit<ValidateSpec, "body">) =>
  validate({ ...opts, body: schema });
