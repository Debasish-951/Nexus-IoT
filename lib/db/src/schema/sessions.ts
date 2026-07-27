import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Server-side session store for human logins.
 *
 * Deliberately opaque-token-in-a-row rather than a stateless JWT: the
 * requirement calls for session timeout, "sign out everywhere", and immediate
 * revocation when an admin suspends an account. All three are trivial with a
 * row and awkward with a JWT.
 *
 * As with auth_tokens, only the SHA-256 of the cookie value is stored.
 */
export const sessionsTable = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    /** Paired CSRF secret — the double-submit cookie value for this session. */
    csrfToken: text("csrf_token").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Slides forward on every authenticated request (idle timeout). */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** min(lastSeen + idleTtl, createdAt + absoluteTtl). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Hard cap — never extended past this, however active the session is. */
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** logout | password_reset | password_changed | admin_revoked | status_changed */
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);

export type Session = typeof sessionsTable.$inferSelect;
