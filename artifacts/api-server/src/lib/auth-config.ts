/**
 * Single source of truth for every authentication/authorisation tunable.
 *
 * Everything is environment-driven with a safe default, so a fresh checkout
 * boots with sensible production-grade settings and an operator can tighten
 * (or, for a documented rollback, loosen) any one of them without a code change.
 */

const isProd = process.env.NODE_ENV === "production";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export const authConfig = {
  isProd,

  /**
   * Master switch for route authorisation. Set false to recover from an
   * over-tight permission table without a redeploy — see the rollback strategy
   * in docs/security/auth-upgrade.md. Authentication still runs and still
   * logs; only the allow/deny decision is bypassed.
   */
  enforce: bool("AUTH_ENFORCE", true),
  /** Narrower escape hatch: keep authorisation on, but let unauthenticated reads through. */
  sessionRequired: bool("AUTH_SESSION_REQUIRED", true),

  /** Origin used to build activation/reset links in outbound email. */
  publicUrl: (process.env.AUTH_PUBLIC_URL ?? "http://localhost:5173").replace(/\/+$/, ""),
  /** Browser origins allowed to make credentialed requests. */
  corsOrigins: list("CORS_ORIGINS", [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]),

  session: {
    cookieName: "is_session",
    csrfCookieName: "is_csrf",
    csrfHeaderName: "x-csrf-token",
    /** Idle timeout — slides forward on every authenticated request. */
    idleTtlMs: num("AUTH_SESSION_IDLE_MINUTES", 30) * 60_000,
    /** Hard ceiling — never extended, however active the session is. */
    absoluteTtlMs: num("AUTH_SESSION_ABSOLUTE_HOURS", 12) * 3_600_000,
    /** Persist the cookie across browser restarts ("Remember me"). */
    rememberMeTtlMs: num("AUTH_SESSION_REMEMBER_DAYS", 14) * 86_400_000,
    secure: bool("AUTH_COOKIE_SECURE", isProd),
    sameSite: "lax" as const,
  },

  tokens: {
    activationTtlMs: num("AUTH_ACTIVATION_TTL_HOURS", 72) * 3_600_000,
    passwordResetTtlMs: num("AUTH_PASSWORD_RESET_TTL_MINUTES", 60) * 60_000,
  },

  lockout: {
    /** Consecutive failures before the account is locked. 0 disables lockout. */
    threshold: num("AUTH_LOCKOUT_THRESHOLD", 5),
    durationMs: num("AUTH_LOCKOUT_MINUTES", 15) * 60_000,
  },

  apiKey: {
    /**
     * Requests per minute allowed per API client (machine callers: gateways,
     * SCADA bridges, scripts). Counted per client, so one project's gateway can
     * never consume another's budget.
     *
     * Default raised from the original hardcoded 120 (2/second), which a single
     * real telemetry gateway already ran at 98% of. Exceeding it returns 429, and
     * a rejected ingest post is lost data unless the gateway retries — so the
     * ceiling needs headroom for normal operation, not to sit on the boundary.
     *
     * 0 disables the limit (deliberate operator choice, e.g. load testing).
     */
    rateLimitRpm: num("INGEST_RATE_LIMIT_RPM", 1200),
  },

  rateLimit: {
    login: { max: num("AUTH_RL_LOGIN_MAX", 10), windowMs: num("AUTH_RL_LOGIN_WINDOW_MINUTES", 5) * 60_000 },
    forgot: { max: num("AUTH_RL_FORGOT_MAX", 5), windowMs: num("AUTH_RL_FORGOT_WINDOW_MINUTES", 60) * 60_000 },
    token: { max: num("AUTH_RL_TOKEN_MAX", 20), windowMs: num("AUTH_RL_TOKEN_WINDOW_MINUTES", 15) * 60_000 },
  },

  password: {
    minLength: num("AUTH_PASSWORD_MIN_LENGTH", 8),
    maxLength: num("AUTH_PASSWORD_MAX_LENGTH", 128),
    requireUppercase: bool("AUTH_PASSWORD_REQUIRE_UPPERCASE", true),
    requireLowercase: bool("AUTH_PASSWORD_REQUIRE_LOWERCASE", true),
    requireDigit: bool("AUTH_PASSWORD_REQUIRE_DIGIT", true),
    requireSymbol: bool("AUTH_PASSWORD_REQUIRE_SYMBOL", true),
    /** Reject passwords containing the username/email local-part/product name. */
    blockContextual: bool("AUTH_PASSWORD_BLOCK_CONTEXTUAL", true),
  },

  email: {
    /** console | smtp | webhook */
    transport: (process.env.AUTH_EMAIL_TRANSPORT ?? "console").toLowerCase(),
    from: process.env.AUTH_EMAIL_FROM ?? "Integrated Suite <no-reply@localhost>",
    /** Admin address surfaced in emails as the escalation contact. */
    supportAddress: process.env.AUTH_SUPPORT_EMAIL ?? "",
    productName: process.env.AUTH_PRODUCT_NAME ?? "Integrated Suite",
    webhookUrl: process.env.AUTH_EMAIL_WEBHOOK_URL ?? "",
    webhookAuthHeader: process.env.AUTH_EMAIL_WEBHOOK_AUTH ?? "",
    smtp: {
      host: process.env.SMTP_HOST ?? "",
      port: num("SMTP_PORT", 587),
      secure: bool("SMTP_SECURE", false),
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
    },
    /** Guard-rail: refuse to boot in production with the log-only transport. */
    allowConsoleInProd: bool("AUTH_EMAIL_ALLOW_CONSOLE", false),
  },
} as const;

/**
 * Fail fast on configurations that are unsafe rather than merely unusual.
 * Called from index.ts before the server starts listening.
 */
export function assertAuthConfigSane(): void {
  const fatal: string[] = [];
  const warn: string[] = [];

  if (isProd) {
    if (authConfig.email.transport === "console" && !authConfig.email.allowConsoleInProd) {
      fatal.push(
        "AUTH_EMAIL_TRANSPORT=console in production would print activation links to the server " +
        "log instead of emailing them. Set AUTH_EMAIL_TRANSPORT=smtp|webhook, or " +
        "AUTH_EMAIL_ALLOW_CONSOLE=true to accept the risk deliberately.",
      );
    }
    if (!authConfig.session.secure) warn.push("AUTH_COOKIE_SECURE=false in production — session cookies will be sent over plain HTTP.");
    if (!authConfig.enforce) fatal.push("AUTH_ENFORCE=false in production — route authorisation is disabled.");
    if (authConfig.publicUrl.startsWith("http://")) warn.push(`AUTH_PUBLIC_URL is plain HTTP (${authConfig.publicUrl}) — activation links will not be TLS-protected.`);
  }

  if (authConfig.email.transport === "smtp" && !authConfig.email.smtp.host) {
    fatal.push("AUTH_EMAIL_TRANSPORT=smtp but SMTP_HOST is not set.");
  }
  if (authConfig.email.transport === "webhook" && !authConfig.email.webhookUrl) {
    fatal.push("AUTH_EMAIL_TRANSPORT=webhook but AUTH_EMAIL_WEBHOOK_URL is not set.");
  }
  if (!["console", "smtp", "webhook"].includes(authConfig.email.transport)) {
    fatal.push(`Unknown AUTH_EMAIL_TRANSPORT "${authConfig.email.transport}" — expected console|smtp|webhook.`);
  }

  for (const w of warn) console.warn(`⚠️  auth-config: ${w}`);
  if (fatal.length > 0) {
    for (const f of fatal) console.error(`❌  auth-config: ${f}`);
    throw new Error("Refusing to start with an unsafe authentication configuration.");
  }
}
