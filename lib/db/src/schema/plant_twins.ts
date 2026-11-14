import { pgTable, text, timestamp, jsonb, index, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { assetsTable } from "./assets";

/**
 * 3D plant twins: the Live Twin page's "3D plant twins" mode.
 *
 * Each row is one plant laid out by process: areas, sub-processes and machines,
 * the settings of each machine model, where it stands on the floor, which asset
 * and metric drive each moving part, and the pipes and cables between machines.
 * The page owns that shape, so it is stored as one JSON document (`scene`) rather
 * than spread over tables, the same choice viz_nodes makes for widget arrays.
 * A scene names assets only by id; the readings themselves stay in `telemetry`.
 *
 * The image twins of the same page are still per-browser (localStorage) and are
 * unaffected by this table.
 */
export const plantTwinsTable = pgTable("plant_twins", {
  /** Text, minted client-side as `pt-<random>`, so the editor can save optimistically. */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** The project (root asset) this twin belongs to. Null shows in every project. */
  projectId: uuid("project_id").references(() => assetsTable.id, { onDelete: "set null" }),
  /** Only the owner, or a Super Admin / Company Admin, may change or delete it. */
  ownerId: uuid("owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  /** The scene document exactly as the 3D editor serialises it. */
  scene: jsonb("scene").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("plant_twins_project_idx").on(table.projectId),
  index("plant_twins_owner_idx").on(table.ownerId),
]);

export type PlantTwinRow = typeof plantTwinsTable.$inferSelect;
