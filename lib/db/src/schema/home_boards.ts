import { pgTable, text, timestamp, uuid, jsonb, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * What Home shows. Scope is `company` (scopeId "company") or `project` (scopeId is
 * the root asset's id). A project is a root-level asset, as everywhere else.
 *
 * Each widget keeps a link to the Visualization widget it was sent from, plus the
 * last copy of that widget, so Home still renders if the source is later deleted.
 */
export const homeBoardsTable = pgTable("home_boards", {
  scope: text("scope").notNull(),
  scopeId: text("scope_id").notNull(),
  widgets: jsonb("widgets").notNull().default([]),
  /** The layout before the last change, for undo. A publish reaches everyone at once. */
  previousWidgets: jsonb("previous_widgets"),
  updatedBy: uuid("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  primaryKey({ columns: [table.scope, table.scopeId] }),
]);

export type HomeBoard = typeof homeBoardsTable.$inferSelect;
