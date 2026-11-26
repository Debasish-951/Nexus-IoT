import { Router, type IRouter } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { BrokerHistoryQuery, IdParams } from "../schemas/common";
import { eq, desc } from "drizzle-orm";
import { db, brokerEventsTable } from "@workspace/db";
import { isTopAdminRole } from "../lib/rbac";
import { publicBrokerMessage } from "../lib/broker-target";

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

  // Raw connection errors name internal hosts and ports (a port-scan oracle);
  // only administrators see them (audit 23 Nov 2026, M-7).
  if (isTopAdminRole(req.principal?.user.role)) { res.json(events); return; }
  res.json(events.map((e) => ({ ...e, message: publicBrokerMessage(e.message) })));
});

export default router;
