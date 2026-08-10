import type { Request, Response } from "express";
import type { ZodError } from "zod";
import { correlationIdOf } from "./errors";

/**
 * Uniform 400 for a schema failure.
 *
 * Replaces `res.status(400).json({ error: parsed.error.message })`, which was
 * the pattern in nine route files. `ZodError.message` is not a sentence — it is
 * `JSON.stringify` of the entire issue tree, so that response returned the field
 * path, the expected type, the received type and the validation rule for every
 * failing field at once. That is a readable description of the internal schema,
 * handed out on request, and it changes shape whenever the schema does.
 *
 * The replacement says which field is wrong and what is wrong with it, and
 * nothing about how validation is implemented. It matches the shape the
 * `validate()` middleware already returns, so the frontend has one error format
 * to handle rather than two.
 */
export function respondInvalid(req: Request, res: Response, error: ZodError, code = "invalid_request"): void {
  res.status(400).json({
    error: "The request could not be accepted because some values were not valid.",
    code,
    errors: error.issues.slice(0, 25).map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join(".") : "(root)",
      message:
        issue.code === "unrecognized_keys"
          ? `unexpected field${issue.keys.length > 1 ? "s" : ""}: ${issue.keys.join(", ")}`
          : issue.message,
    })),
    correlationId: correlationIdOf(req),
  });
}
