import { Router, type IRouter } from "express";
import { db, vizDashboardsTable } from "@workspace/db";

/**
 * Legacy dashboards, superseded by viz_nodes (routes/viz_nodes.ts).
 *
 * Create, update and delete were removed: they had no owner check, no input
 * validation and no activity logging, so anyone with Visualization write could
 * rewrite or delete anyone's dashboard, and nothing in the app called them any
 * more (the Analytics & KPI page that did is no longer routed).
 *
 * The list stays, reduced to id and name, only because the Access Control
 * editor (pages/Users.tsx) still reads it to offer its dashboard restriction.
 * Widgets are not returned: no caller needs them, and they name assets and
 * metrics. Remove this route, and its rule in middleware/authorize.ts, once the
 * editor stops asking.
 */
const router: IRouter = Router();

router.get("/viz-dashboards", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ id: vizDashboardsTable.id, name: vizDashboardsTable.name })
    .from(vizDashboardsTable)
    .orderBy(vizDashboardsTable.createdAt);
  res.json(rows);
});

export default router;
