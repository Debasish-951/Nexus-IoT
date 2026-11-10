import { Router, type IRouter } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { ActivityLogQuery } from "../schemas/common";
import { desc, eq, and, count, inArray } from "drizzle-orm";
import { db, activityLogsTable } from "@workspace/db";
import type { Request } from "express";
import { broadcast } from "../lib/ws-broadcast";
import { assetScope } from "../lib/project-access";

const router: IRouter = Router();

export async function logActivity(
  action: string,
  category: string,
  targetId: string | null,
  targetName: string | null,
  detail: string | null,
  req?: Request,
): Promise<void> {
  try {
    const [entry] = await db.insert(activityLogsTable).values({
      action,
      category,
      actorName: (req?.headers["x-actor-name"] as string) ?? "system",
      actorRole: (req?.headers["x-actor-role"] as string) ?? "system",
      actorUsername: (req?.headers["x-actor-username"] as string) ?? null,
      targetId,
      targetName,
      detail,
    }).returning();

    if (entry) {
      broadcast("activity_log", {
        ...entry,
        timestamp: entry.timestamp.toISOString(),
      });
    }
  } catch {
  }
}

router.get("/activity-log", validate({ query: ActivityLogQuery }), async (req, res): Promise<void> => {
  const { limit = 100, offset = 0, category, actorName } = req.query as z.infer<typeof ActivityLogQuery>;

  // A project-restricted user sees only entries about assets in their projects,
  // the same rule the live feed applies (lib/ws-broadcast.ts). Entries about
  // users, brokers or API clients carry no project and are withheld from them.
  const scope = await assetScope(req);
  if (scope && scope.assetIds.size === 0) { res.json({ entries: [], total: 0 }); return; }

  const conditions = [
    ...(category ? [eq(activityLogsTable.category, category)] : []),
    ...(actorName ? [eq(activityLogsTable.actorName, actorName)] : []),
    ...(scope ? [inArray(activityLogsTable.targetId, [...scope.assetIds])] : []),
  ];

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [entries, [{ total }]] = await Promise.all([
    db
      .select()
      .from(activityLogsTable)
      .where(where)
      .orderBy(desc(activityLogsTable.timestamp))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(activityLogsTable).where(where),
  ]);

  res.json({ entries, total: Number(total) });
});

export default router;
