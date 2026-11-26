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

  /**
   * Allow alarm webhooks and data destinations to target loopback, link-local
   * and private-network addresses.
   *
   * Off by default because those URLs are user-supplied and the SERVER makes the
   * request — which otherwise lets a signed-in user reach the management
   * network, services on localhost, or a cloud metadata endpoint they could not
   * reach from their own browser (see lib/outbound-url.ts).
   *
   * Turn it on for an on-premise deployment that legitimately posts to a host on
   * its own network, e.g. a plant historian.
   */
  allowPrivateWebhookTargets: bool("ALLOW_PRIVATE_WEBHOOK_TARGETS", false),

  /**
   * MQTT broker endpoints (lib/broker-target.ts). Brokers usually sit on the
   * plant LAN, so private addresses are allowed unless this is set false.
   * Link-local (cloud metadata), multicast and reserved ranges are always refused.
   */
  allowPrivateBrokerTargets: bool("ALLOW_PRIVATE_BROKER_TARGETS", true),
  /** A broker on this same machine (localhost / 127.0.0.1). Refused unless set true. */
  allowLoopbackBrokerTargets: bool("ALLOW_LOOPBACK_BROKER_TARGETS", false),

  /**
   * Accept an API client secret in the query string (`?key=…`).
   *
   * OFF by default. The application's own log strips query strings (see the pino
   * serializer in app.ts), but nginx's default `access_log` records the full
   * request line — so a key sent this way is written to disk in cleartext on the
   * proxy, survives in log rotation and backups, and is visible to anyone with
   * log access.
   *
   * It exists because some field gateways (Node-RED subflows, PLC HTTP blocks,
   * SCADA bridges) expose only a URL field, and refusing them leaves no way to
   * authenticate at all. Turn it on where such a device is in use, and configure
   * nginx to strip the parameter — see docs/operations/vm-deployment-checklist.md.
   */
  allowApiKeyInQuery: bool("API_KEY_ALLOW_QUERY_PARAM", false),

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
    /**
     * Since the 23 Nov 2026 audit (M-1) `threshold` locks only the pair (account,
     * source network /24 or /64), so a stranger cannot lock the owner out. This
     * account-wide threshold, counted over every network, still locks the account
     * itself against guessing spread across networks. 0 disables the account-wide lock.
     */
    accountThreshold: num("AUTH_LOCKOUT_ACCOUNT_THRESHOLD", 25),
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

  /**
   * Reverse-proxy hops to trust when deriving the client IP.
   *
   * Must equal the number of proxies actually in front of this process. Too low
   * behind nginx and every user shares one rate-limit bucket; too high and the
   * client can forge the address the limits key on. See lib/client-ip.ts.
   */
  trustProxy: num("TRUST_PROXY", isProd ? 1 : 0),

  rateLimit: {
    // Credential endpoints. Low ceilings: a human types a password a handful of
    // times, so anything above this is a script.
    login: { max: num("AUTH_RL_LOGIN_MAX", 10), windowMs: num("AUTH_RL_LOGIN_WINDOW_MINUTES", 5) * 60_000 },
    forgot: { max: num("AUTH_RL_FORGOT_MAX", 5), windowMs: num("AUTH_RL_FORGOT_WINDOW_MINUTES", 60) * 60_000 },
    token: { max: num("AUTH_RL_TOKEN_MAX", 20), windowMs: num("AUTH_RL_TOKEN_WINDOW_MINUTES", 15) * 60_000 },
    /**
     * One-time codes. Stricter than a password: a 6-digit code has a millionth
     * chance per guess, so an attacker only needs volume. Applied per account,
     * which is what makes rotating IPs useless against it.
     */
    otp: { max: num("AUTH_RL_OTP_MAX", 5), windowMs: num("AUTH_RL_OTP_WINDOW_MINUTES", 10) * 60_000 },
    /**
     * Per-ACCOUNT ceiling for credential attempts, independent of source IP.
     * The dimension a distributed attack cannot rotate — the target username is
     * fixed by definition. Set above the lockout threshold so account lockout
     * (which is durable, in the database) remains the first control to fire.
     */
    account: { max: num("AUTH_RL_ACCOUNT_MAX", 12), windowMs: num("AUTH_RL_ACCOUNT_WINDOW_MINUTES", 15) * 60_000 },
    /**
     * Self-service password change, per signed-in user. Each attempt verifies the
     * current password with a 64 MiB scrypt, and a hijacked session could
     * otherwise guess the current password without limit and without touching
     * the login lockout. Cleared on success.
     */
    changePassword: { max: num("AUTH_RL_CHANGE_PASSWORD_MAX", 5), windowMs: num("AUTH_RL_CHANGE_PASSWORD_WINDOW_MINUTES", 15) * 60_000 },
    /**
     * AI Advisor questions, per user. Each question makes several calls to the
     * external model and spends the installation's shared Groq quota, so one
     * user looping on it would stop it for everyone.
     */
    ai: { max: num("AI_RL_MAX", 20), windowMs: num("AI_RL_WINDOW_MINUTES", 10) * 60_000 },

    /**
     * Ordinary authenticated API traffic, keyed per user (falling back to IP).
     * Sized for a busy dashboard — the UI polls several endpoints and opens a
     * WebSocket — not for a scripted crawl of every asset.
     */
    api: { max: num("API_RL_MAX", 600), windowMs: num("API_RL_WINDOW_SECONDS", 60) * 1_000 },
    /**
     * Coarse pre-authentication ceiling, applied before any database work. This
     * is what stops an unauthenticated flood turning into thousands of session
     * lookups; it sits well above real usage and is a flood guard, not a policy.
     */
    flood: { max: num("API_RL_FLOOD_MAX", 1200), windowMs: num("API_RL_FLOOD_WINDOW_SECONDS", 60) * 1_000 },
    /** Cost multiplier for endpoints that generate a full export. */
    exportCost: num("API_RL_EXPORT_COST", 20),

    /**
     * Subnet ceilings are this multiple of the per-IP ceiling: shared enough to
     * let a NATed office through, tight enough that renting a /24 does not
     * multiply an attacker's budget by 256.
     */
    subnetMultiplier: num("API_RL_SUBNET_MULTIPLIER", 6),

    /**
     * Aggregate authentication-failure velocity across ALL accounts and IPs.
     * A distributed spray stays under every individual ceiling by design; the
     * total is the one signal it cannot suppress. Crossing `max` failures in
     * `windowMs` divides the auth ceilings by `divisor` for `tightenMs`.
     * 0 disables.
     */
    spray: {
      max: num("AUTH_RL_SPRAY_MAX", 100),
      windowMs: num("AUTH_RL_SPRAY_WINDOW_MINUTES", 10) * 60_000,
      tightenMs: num("AUTH_RL_SPRAY_TIGHTEN_MINUTES", 30) * 60_000,
      divisor: Math.max(2, num("AUTH_RL_SPRAY_DIVISOR", 4)),
    },
  },

  password: {
    minLength: num("AUTH_PASSWORD_MIN_LENGTH", 12),
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
    // Without a required session every GET is answered anonymously, ahead of the
    // deny-by-default rule table, which exposes users, API clients and telemetry.
    if (!authConfig.sessionRequired) fatal.push("AUTH_SESSION_REQUIRED=false in production — every read would be answered without signing in.");
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
