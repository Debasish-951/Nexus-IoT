import { pgTable, text, timestamp, jsonb, index, uuid, boolean, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { assetsTable } from "./assets";

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
  /**
   * The user who owns this dashboard. Null for rows created before ownership
   * existed and for owners since deleted; only a top administrator can reach those.
   */
  ownerId: uuid("owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  /**
   * The project a top-level node belongs to; nested nodes follow their top-level
   * node. Null means unassigned, which shows in every project.
   */
  projectId: uuid("project_id").references(() => assetsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // Every read walks the tree by parent; without this the node list is a full
  // scan on every Visualization page load.
  index("viz_nodes_parent_idx").on(table.parentId),
  index("viz_nodes_owner_idx").on(table.ownerId),
]);

/**
 * Access a Super Admin or Company Admin has granted one user on a dashboard someone else owns.
 * A grant also covers every dashboard nested under that node; see
 * artifacts/api-server/src/lib/viz-access.ts.
 */
export const vizNodeSharesTable = pgTable("viz_node_shares", {
  nodeId: text("node_id").notNull().references(() => vizNodesTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  canRead: boolean("can_read").notNull().default(true),
  canWrite: boolean("can_write").notNull().default(false),
  canDelete: boolean("can_delete").notNull().default(false),
  grantedBy: uuid("granted_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  primaryKey({ columns: [table.nodeId, table.userId] }),
  index("viz_node_shares_user_idx").on(table.userId),
]);

export type VizNodeRow = typeof vizNodesTable.$inferSelect;
