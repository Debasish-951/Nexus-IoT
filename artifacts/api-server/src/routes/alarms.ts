import { Router, type IRouter } from "express";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { db, alarmsTable, alarmHistoryTable } from "@workspace/db";
import {
  ListAlarmsQueryParams,
  AcknowledgeAlarmParams,
  ListAlarmHistoryQueryParams,
} from "@workspace/api-zod";
import { logActivity } from "./activity_log";

const router: IRouter = Router();

router.get("/alarms", async (req, res): Promise<void> => {
  const query = ListAlarmsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions = [];
  if (query.data.status) {
    conditions.push(eq(alarmsTable.status, query.data.status));
  }
  if (query.data.severity) {
    conditions.push(eq(alarmsTable.severity, query.data.severity));
  }

  const alarms = await db
    .select()
    .from(alarmsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alarmsTable.triggeredAt));

  res.json(alarms);
});

router.post("/alarms/:id/acknowledge", async (req, res): Promise<void> => {
  const params = AcknowledgeAlarmParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [alarm] = await db
    .update(alarmsTable)
    .set({ status: "acknowledged", acknowledgedAt: new Date() })
    .where(eq(alarmsTable.id, params.data.id))
    .returning();

  if (!alarm) {
    res.status(404).json({ error: "Alarm not found" });
    return;
  }

  void logActivity("alarm.acknowledged", "alarm", alarm.id, alarm.name, null, req);
  res.json(alarm);
});

router.get("/alarms/history", async (req, res): Promise<void> => {
  const query = ListAlarmHistoryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions = [];
  if (query.data.assetId) {
    conditions.push(eq(alarmHistoryTable.assetId, query.data.assetId));
  }
  if (query.data.from) {
    conditions.push(gte(alarmHistoryTable.triggeredAt, query.data.from as unknown as Date));
  }
  if (query.data.to) {
    conditions.push(lte(alarmHistoryTable.triggeredAt, query.data.to as unknown as Date));
  }

  const history = await db
    .select()
    .from(alarmHistoryTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alarmHistoryTable.triggeredAt))
    .limit(query.data.limit ?? 50);

  res.json(history);
});

export default router;
