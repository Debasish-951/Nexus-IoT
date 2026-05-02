import { Router, type IRouter } from "express";
import { desc, eq, and, count } from "drizzle-orm";
import { db, activityLogsTable } from "@workspace/db";
import type { Request } from "express";

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
    await db.insert(activityLogsTable).values({
      action,
      category,
      actorName: (req?.headers["x-actor-name"] as string) ?? "system",
      actorRole: (req?.headers["x-actor-role"] as string) ?? "system",
      actorUsername: (req?.headers["x-actor-username"] as string) ?? null,
      targetId,
      targetName,
      detail,
    });
  } catch {
  }
}

router.get("/activity-log", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const offset = Number(req.query.offset ?? 0);
  const category = req.query.category as string | undefined;
  const actorName = req.query.actorName as string | undefined;

  const conditions = [
    ...(category ? [eq(activityLogsTable.category, category)] : []),
    ...(actorName ? [eq(activityLogsTable.actorName, actorName)] : []),
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
