import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, brokerEventsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/brokers/:id/history", async (req, res): Promise<void> => {
  const { id } = req.params;
  const limit = Math.min(Number(req.query.limit ?? 100), 500);

  const events = await db
    .select()
    .from(brokerEventsTable)
    .where(eq(brokerEventsTable.brokerId, id))
    .orderBy(desc(brokerEventsTable.timestamp))
    .limit(limit);

  res.json(events);
});

export default router;
