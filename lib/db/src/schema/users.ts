import { pgTable, text, timestamp, uuid, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Per-user access grants that override the role defaults.
 *
 * This is the same shape the Users → Access Control editor used to keep in
 * `localStorage["iot_access_v3"]`. It now lives on the row so it is
 * authoritative, portable across browsers, auditable, and — most importantly —
 * readable by the API when it authorises a request.
 */
export interface UserAccessOverrides {
  /** module key → true|false (simple) or { r, w, d } (granular) */
  modules?: Record<string, boolean | { r: boolean; w: boolean; d: boolean }>;
  restrictProjects?: boolean;
  allowedProjects?: string[];
  restrictDashboards?: boolean;
  allowedDashboards?: string[];
  restrictAnalytics?: boolean;
  allowedAnalytics?: string[];
  /**
   * API-client scopes this user is permitted to GRANT when creating a credential.
   *
   * Not the user's own access — it is the ceiling on what a credential they mint
   * may do. Ingest-only users can hand a gateway a write key without also being
   * able to hand out a key that reads every asset and alarm in the platform.
   *
   * `undefined` inherits the role default (see ROLE_API_SCOPE_DEFAULTS in
   * rbac.ts). An empty array means the user may create no credentials at all.
   */
  apiScopes?: string[];
}

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  role: text("role").notNull().default("viewer"), // super_admin|company_admin|admin|engineer|operator|viewer
  // invited → active → (suspended|inactive). Accounts are born `invited`: an
  // account can never be usable without going through the activation flow.
  status: text("status").notNull().default("invited"),

  // ── Credentials ─────────────────────────────────────────────────────────────
  /** scrypt$N$r$p$salt_b64$hash_b64 — never cleartext. NULL until activation. */
  /** Simultaneous logins allowed for this user. Only a Super Admin or Company Admin can change it. */
  maxSessions: integer("max_sessions").notNull().default(3),

  passwordHash: text("password_hash"),
  passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
  /**
   * Forces a password change before the account can do anything else.
   * Set by an admin-issued temporary password; cleared when the user picks
   * their own. Enforced in middleware/authorize.ts, not just in the UI.
   */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  /**
   * Hard expiry for an admin-issued temporary password.
   *
   * NULL for a normal, user-chosen password — those do not expire on a clock.
   * When set and in the past, the credential is dead: login is refused even if
   * the password is typed correctly, and the account needs a new temporary
   * password or an activation link.
   */
  passwordExpiresAt: timestamp("password_expires_at", { withTimezone: true }),

  // ── Onboarding provenance ───────────────────────────────────────────────────
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  invitedBy: uuid("invited_by"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),

  // ── Account protection ──────────────────────────────────────────────────────
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  /** Set when the failure threshold trips. Auto-heals — no admin edit needed. */
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLogin: timestamp("last_login", { withTimezone: true }),
  lastLoginIp: text("last_login_ip"),

  // ── Authorisation ───────────────────────────────────────────────────────────
  accessOverrides: jsonb("access_overrides").$type<UserAccessOverrides>().notNull().default({}),

  // ── Enterprise seams (schema only — no runtime implementation yet) ──────────
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  /** TOTP shared secret. Encrypt at rest before enabling MFA in production. */
  mfaSecret: text("mfa_secret"),
  /** local | oidc | azuread | saml — lets an SSO-provisioned user skip the password flow. */
  authProvider: text("auth_provider").notNull().default("local"),
  /** Subject claim from the external IdP, for JIT provisioning / account linking. */
  externalId: text("external_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const USER_STATUSES = ["invited", "active", "suspended", "inactive"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
