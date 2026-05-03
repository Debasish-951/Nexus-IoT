import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, vizDashboardsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/viz-dashboards", async (_req, res): Promise<void> => {
  const rows = await db.select().from(vizDashboardsTable).orderBy(vizDashboardsTable.createdAt);
  res.json(rows.map(dbToClient));
});

router.post("/viz-dashboards", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const roleAccess = Array.isArray(body.roleAccess) ? (body.roleAccess as string[]) : ["admin", "engineer", "operator", "viewer"];
  const widgets    = Array.isArray(body.widgets)    ? body.widgets    : [];
  const assetFilter = typeof body.assetFilter === "string" ? body.assetFilter : null;
  const [row] = await db.insert(vizDashboardsTable).values({
    name, roleFilter: roleAccess.join(","), assetFilter, widgets,
  }).returning();
  res.status(201).json(dbToClient(row));
});

router.put("/viz-dashboards/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;
  const update: Partial<typeof vizDashboardsTable.$inferInsert> = {};
  if (typeof body.name === "string")          update.name        = body.name.trim();
  if (Array.isArray(body.roleAccess))         update.roleFilter  = (body.roleAccess as string[]).join(",");
  if ("assetFilter" in body)                  update.assetFilter = typeof body.assetFilter === "string" ? body.assetFilter : null;
  if (Array.isArray(body.widgets))            update.widgets     = body.widgets;
  if (Object.keys(update).length === 0) { res.json({}); return; }
  const [row] = await db.update(vizDashboardsTable).set(update).where(eq(vizDashboardsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Dashboard not found" }); return; }
  res.json(dbToClient(row));
});

router.delete("/viz-dashboards/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  await db.delete(vizDashboardsTable).where(eq(vizDashboardsTable.id, id));
  res.json({ success: true });
});

function dbToClient(row: typeof vizDashboardsTable.$inferSelect) {
  return {
    id:          row.id,
    name:        row.name,
    assetFilter: row.assetFilter ?? null,
    roleAccess:  row.roleFilter ? row.roleFilter.split(",") : ["admin", "engineer", "operator", "viewer"],
    widgets:     Array.isArray(row.widgets) ? row.widgets : [],
    createdAt:   row.createdAt,
    updatedAt:   row.updatedAt,
  };
}

export default router;
