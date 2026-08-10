import { Router, type IRouter } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { BrokerHistoryQuery, IdParams } from "../schemas/common";
import { eq, desc } from "drizzle-orm";
import { db, brokerEventsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/brokers/:id/history", validate({ params: IdParams, query: BrokerHistoryQuery }), async (req, res): Promise<void> => {
  const { id } = req.params as z.infer<typeof IdParams>;
  const { limit = 100 } = req.query as z.infer<typeof BrokerHistoryQuery>;

  const events = await db
    .select()
    .from(brokerEventsTable)
    .where(eq(brokerEventsTable.brokerId, id))
    .orderBy(desc(brokerEventsTable.timestamp))
    .limit(limit);

  res.json(events);
});

export default router;
