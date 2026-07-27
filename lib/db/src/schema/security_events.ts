import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Security / authentication event stream.
 *
 * Serves as BOTH the "login history" and the "security events" log the
 * requirement lists separately — they share every column and differ only by an
 * `eventType` filter, so one table with two views beats two near-identical
 * tables.
 *
 * Distinct from `activity_logs`, which records *business* actions (asset
 * created, alarm acknowledged). This one records *security* facts, carries the
 * source IP and user agent, survives user deletion (`onDelete: set null` keeps
 * the forensic trail), and is expected to have a different retention policy.
 */
export const securityEventsTable = pgTable(
  "security_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    /** Kept denormalised so failed logins for non-existent users are still recorded. */
    username: text("username"),
    /**
     * login.success | login.failure | login.blocked | login.rate_limited |
     * logout | session.expired | account.locked | account.unlocked |
     * user.invited | user.activated | invitation.resent | invitation.expired |
     * password_reset.requested | password_reset.completed | password.changed |
     * authz.denied | email.failed | access.updated
     */
    eventType: text("event_type").notNull(),
    /** success | failure */
    outcome: text("outcome").notNull().default("success"),
    /** Machine-readable cause, e.g. unknown_user, bad_password, locked, activation_pending. */
    reason: text("reason"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** Free-form structured context. Never put secrets or raw tokens in here. */
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("security_events_user_time_idx").on(t.userId, t.createdAt),
    index("security_events_type_time_idx").on(t.eventType, t.createdAt),
    index("security_events_time_idx").on(t.createdAt),
  ],
);

export type SecurityEvent = typeof securityEventsTable.$inferSelect;

/** Event types that constitute "login history" in the Security Center UI. */
export const LOGIN_EVENT_TYPES = [
  "login.success",
  "login.failure",
  "login.blocked",
  "login.rate_limited",
  "logout",
] as const;
