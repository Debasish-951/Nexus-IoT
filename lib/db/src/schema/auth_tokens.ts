import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Single-use, typed, time-boxed tokens for the out-of-band account flows.
 *
 * One table rather than the separate ActivationTokens / PasswordResetTokens
 * pair: the columns are identical and the lifecycle is identical, so a `type`
 * discriminator keeps the schema (and the consume/revoke code) in one place.
 *
 * Only the SHA-256 of the token is stored. The raw value exists exactly once,
 * in the email link — a database read cannot be replayed into an account
 * takeover.
 */
export const authTokensTable = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** activation | password_reset */
    type: text("type").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set the moment the token is redeemed. Enforces single use. */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    /** Set when superseded by a resend or invalidated by an admin action. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Admin who triggered the invitation/reset; NULL for self-service resets. */
    createdBy: uuid("created_by"),
    createdIp: text("created_ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("auth_tokens_user_type_idx").on(t.userId, t.type),
    index("auth_tokens_expires_idx").on(t.expiresAt),
  ],
);

export type AuthToken = typeof authTokensTable.$inferSelect;

export const AUTH_TOKEN_TYPES = ["activation", "password_reset"] as const;
export type AuthTokenType = (typeof AUTH_TOKEN_TYPES)[number];
