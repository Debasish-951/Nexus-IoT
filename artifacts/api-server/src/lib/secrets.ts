import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { logger } from "./logger";

/**
 * Central secret loading.
 *
 * ── Why a loader rather than `process.env.X` at each site ────────────────────
 *
 * Reading the environment directly works, but it gives you nowhere to put the
 * three things a secret needs and a config value does not:
 *
 *   1. A file-based source. Every serious secret store — HashiCorp Vault Agent,
 *      Kubernetes Secrets, Docker secrets, the AWS/GCP secret CSI drivers —
 *      delivers material as a FILE, not as an environment variable, because the
 *      environment of a process is readable from `/proc/<pid>/environ`, is
 *      inherited by every child process, and is dumped wholesale by most crash
 *      reporters. Supporting `NAME_FILE` is what makes this application work
 *      with a vault without coupling it to any one vendor's SDK.
 *   2. Fail-fast validation. A missing secret should stop the process at boot
 *      with a clear message, not surface as a confusing auth failure hours later.
 *   3. A guarantee that the VALUE is never logged. Everything here reports
 *      fingerprints and provenance; there is deliberately no code path that
 *      writes a secret to the log, so no future edit can accidentally add one by
 *      logging "the config object".
 *
 * ── Precedence ───────────────────────────────────────────────────────────────
 *
 *   NAME_FILE  (path to a file whose contents are the secret)   ← preferred
 *   NAME       (the value inline)                               ← fallback
 *
 * File wins deliberately. If a deployment has gone to the trouble of mounting a
 * vault-managed file, a stale environment variable left over from an earlier
 * deployment must not silently take precedence over it.
 */

export type SecretSource = "file" | "env" | "default" | "missing";

export interface SecretInfo {
  name: string;
  source: SecretSource;
  /** First 8 hex of SHA-256. Enough to confirm two environments agree, useless to an attacker. */
  fingerprint: string | null;
  length: number;
}

const loaded = new Map<string, SecretInfo>();

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/**
 * Values that must never be accepted in production.
 *
 * These are the placeholders from `.env.example` and the usual copy-paste
 * defaults. A deployment running with one of these has an credential that is
 * public knowledge, and the failure is silent — everything works, which is
 * exactly why it survives to production.
 */
const REJECTED_VALUES = new Set([
  "changeme", "change-me", "secret", "password", "PASSWORD", "test",
  "dev", "development", "insecure", "placeholder", "TODO",
  // Historic: this repository shipped a real SESSION_SECRET in .env.example for
  // several commits. Any deployment still using it is using a published value.
  "CIBDYTC837456g8c738473c4857b38c37458435b384568345683",
]);

export interface SecretOptions {
  /** Refuse to boot without it (in production). */
  required?: boolean;
  /** Used when neither source is present. Never applied in production if `required`. */
  fallback?: string;
  /** Minimum acceptable length — a short "random" secret is not random enough. */
  minLength?: number;
}

/**
 * Read one secret. Returns null when absent and no fallback applies.
 *
 * Results are recorded for the boot report but the VALUE is not retained here —
 * callers hold it, and this module only ever keeps the fingerprint.
 */
export function getSecret(name: string, options: SecretOptions = {}): string | null {
  const filePath = process.env[`${name}_FILE`];
  let value: string | null = null;
  let source: SecretSource = "missing";

  if (filePath && filePath.trim()) {
    try {
      // Trailing newline is stripped: every tool that writes a secret to a file
      // adds one, and a token with "\n" on the end fails authentication in a way
      // that is genuinely difficult to see in a log.
      value = readFileSync(filePath.trim(), "utf8").replace(/\r?\n$/, "");
      source = "file";
    } catch (err) {
      // Deliberately fatal-ish: a configured-but-unreadable secret file is a
      // deployment error. Falling back to the environment here would mean a
      // permissions mistake silently downgrades to a weaker source.
      logger.error(
        { secret: name, path: filePath, err: (err as Error).message },
        "secret file is configured but could not be read",
      );
      throw new Error(`Secret ${name}: ${name}_FILE is set but the file could not be read.`);
    }
  } else if (process.env[name] !== undefined && process.env[name] !== "") {
    value = process.env[name]!;
    source = "env";
  } else if (options.fallback !== undefined) {
    value = options.fallback;
    source = "default";
  }

  loaded.set(name, {
    name,
    source,
    fingerprint: value ? fingerprint(value) : null,
    length: value?.length ?? 0,
  });

  return value;
}

/**
 * Read a secret and validate it, throwing with an actionable message.
 *
 * Validation is only enforced in production: a local checkout must stay usable
 * without a vault, and a developer machine that refuses to boot gets "fixed" by
 * someone disabling the check.
 */
export function requireSecret(name: string, options: SecretOptions = {}): string {
  const value = getSecret(name, options);
  const isProd = process.env.NODE_ENV === "production";

  if (!value) {
    if (!isProd && options.fallback !== undefined) return options.fallback;
    throw new Error(
      `Secret ${name} is not set. Provide it as ${name} in the environment, or ` +
      `mount it as a file and set ${name}_FILE (preferred — see lib/secrets.ts).`,
    );
  }

  if (isProd) {
    if (REJECTED_VALUES.has(value)) {
      throw new Error(
        `Secret ${name} is set to a known placeholder or previously published value. ` +
        `Generate a new one:  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
      );
    }
    if (options.minLength && value.length < options.minLength) {
      throw new Error(
        `Secret ${name} is ${value.length} characters; at least ${options.minLength} is required.`,
      );
    }
  }

  return value;
}

/**
 * What was loaded, and from where. Values are never included.
 *
 * Logged once at boot so an operator can confirm the process picked up the
 * secrets they think it did — the fingerprint makes "is staging using the same
 * key as production?" answerable without anyone reading a secret out loud.
 */
export function secretsReport(): SecretInfo[] {
  return [...loaded.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function logSecretsReport(): void {
  const report = secretsReport();
  if (report.length === 0) return;
  logger.info(
    {
      secrets: report.map((s) => ({
        name: s.name,
        source: s.source,
        fingerprint: s.fingerprint,
        length: s.length,
      })),
    },
    "secrets loaded",
  );

  const fromEnv = report.filter((s) => s.source === "env").map((s) => s.name);
  if (process.env.NODE_ENV === "production" && fromEnv.length > 0) {
    logger.warn(
      { secrets: fromEnv },
      "secrets are being read from environment variables. A process environment is readable " +
      "via /proc/<pid>/environ, is inherited by child processes, and is captured by most crash " +
      "reporters. Prefer mounting them as files and setting <NAME>_FILE.",
    );
  }
}

/**
 * Mask a secret for display.
 *
 * Shows only enough to tell two credentials apart. Used by the API when a
 * response must indicate that a credential EXISTS without disclosing it.
 */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  return `••••••••${value.length > 4 ? value.slice(-4) : ""}`;
}
