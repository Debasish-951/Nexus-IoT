import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * The Visualization section's own hierarchy, and the dashboard each node holds.
 *
 * This used to live entirely in the browser's localStorage (`wsviz:hierarchy`
 * and `wsviz:widgets:<nodeId>`), which meant a dashboard someone built could not
 * be seen by a colleague, did not survive a cache clear or a different machine,
 * was in no backup, and — worst of the four — silently stopped saving once the
 * ~5MB localStorage quota was reached, because every write swallowed its own
 * QuotaExceededError. Moving the data here fixes all four at once.
 *
 * Deliberately separate from `viz_dashboards`, which backs the Dashboard
 * Explorer: that table models a standalone named dashboard with role/asset
 * filters, whereas these are nodes in a user-defined tree. Overloading one table
 * for both would have meant columns that are meaningless for half its rows.
 */
export const vizNodesTable = pgTable("viz_nodes", {
  /**
   * Text, not uuid, because ids are minted client-side as `vn-<random>` and the
   * localStorage import has to preserve them — a node's id is the key its
   * widgets were stored under, so regenerating it on import would orphan every
   * dashboard being migrated.
   */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /**
   * Self-referential, but intentionally NOT a foreign key: subtree deletion is
   * done explicitly in the route so it can report how many nodes it removed, and
   * a stray parentId must degrade to "shows at the top level" rather than
   * blocking the write. The frontend's tree walk already guards against cycles.
   */
  parentId: text("parent_id"),
  /** The node's dashboard: the widget array exactly as the canvas serialises it. */
  widgets: jsonb("widgets").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // Every read walks the tree by parent; without this the node list is a full
  // scan on every Visualization page load.
  index("viz_nodes_parent_idx").on(table.parentId),
]);

export type VizNodeRow = typeof vizNodesTable.$inferSelect;
