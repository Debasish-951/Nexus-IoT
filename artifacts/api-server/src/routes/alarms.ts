import { Router, type IRouter } from "express";
import { respondInvalid } from "../lib/respond";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { db, alarmsTable, alarmHistoryTable } from "@workspace/db";
import {
  ListAlarmsQueryParams,
  AcknowledgeAlarmParams,
  ListAlarmHistoryQueryParams,
} from "@workspace/api-zod";
import { logActivity } from "./activity_log";
import { broadcast } from "../lib/ws-broadcast";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router: IRouter = Router();

router.get("/alarms", async (req, res): Promise<void> => {
  const query = ListAlarmsQueryParams.safeParse(req.query);
  if (!query.success) {
    respondInvalid(req, res, query.error);
    return;
  }

  const conditions = [];
  if (query.data.status) {
    conditions.push(eq(alarmsTable.status, query.data.status));
  }
  if (query.data.severity) {
    conditions.push(eq(alarmsTable.severity, query.data.severity));
  }

  // Bounded: the list used to return every alarm ever raised. Newest first, so
  // the default window always holds the current ones. The response stays an array.
  const limit = Math.min(Math.max(Math.trunc(query.data.limit ?? 500), 1), 5000);
  const alarms = await db
    .select()
    .from(alarmsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alarmsTable.triggeredAt))
    .limit(limit);

  res.json(alarms);
});

router.post("/alarms/:id/acknowledge", async (req, res): Promise<void> => {
  const params = AcknowledgeAlarmParams.safeParse(req.params);
  if (!params.success) {
    respondInvalid(req, res, params.error);
    return;
  }

  // Only an ACTIVE alarm can be acknowledged. Without the status condition a
  // cleared alarm was put back to "acknowledged", which reopened it, and could
  // collide with the one-open-alarm-per-rule index (a 500).
  const now = new Date();
  const [alarm] = await db
    .update(alarmsTable)
    .set({ status: "acknowledged", acknowledgedAt: now })
    .where(and(eq(alarmsTable.id, params.data.id), eq(alarmsTable.status, "active")))
    .returning();

  if (!alarm) {
    const [existing] = await db.select({ status: alarmsTable.status })
      .from(alarmsTable).where(eq(alarmsTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "Alarm not found" });
      return;
    }
    res.status(409).json({
      error: `Cannot acknowledge — current status is '${existing.status}'`,
      code: "alarm_not_active",
    });
    return;
  }

  // Keep the history record in step, so the Alarm History page does not go on
  // showing an acknowledged alarm as unacknowledged.
  await db.update(alarmHistoryTable)
    .set({ status: "acknowledged", acknowledgedAt: now })
    .where(and(eq(alarmHistoryTable.alarmId, alarm.id), eq(alarmHistoryTable.status, "active")));

  void logActivity("alarm.acknowledged", "alarm", alarm.id, alarm.name, null, req);
  broadcast("alarm", {
    event: "acknowledged",
    alarmId: alarm.id,
    ruleName: alarm.name,
    severity: alarm.severity,
    assetId: alarm.assetId,
    assetName: alarm.assetName,
  });
  res.json(alarm);
});

// Acknowledge a specific alarm-history record (and its linked active alarm)
router.post("/alarms/history/:id/acknowledge", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [historyRecord] = await db
    .select()
    .from(alarmHistoryTable)
    .where(eq(alarmHistoryTable.id, id));

  if (!historyRecord) { res.status(404).json({ error: "Alarm history record not found" }); return; }
  if (historyRecord.status !== "active") {
    res.status(409).json({ error: `Cannot acknowledge — current status is '${historyRecord.status}'` });
    return;
  }

  const now = new Date();

  // Update history record status to acknowledged. Conditional on it still being
  // active, so two operators acknowledging at once cannot both succeed.
  const [updated] = await db
    .update(alarmHistoryTable)
    .set({ status: "acknowledged", acknowledgedAt: now })
    .where(and(eq(alarmHistoryTable.id, id), eq(alarmHistoryTable.status, "active")))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Cannot acknowledge — the record is no longer active", code: "alarm_not_active" });
    return;
  }

  // Also update the linked active alarm if it still exists and is active
  await db
    .update(alarmsTable)
    .set({ status: "acknowledged", acknowledgedAt: now })
    .where(and(
      eq(alarmsTable.id, historyRecord.alarmId),
      eq(alarmsTable.status, "active"),
    ));

  void logActivity("alarm.acknowledged", "alarm", historyRecord.alarmId, historyRecord.name, "via alarm history", req);
  broadcast("alarm", {
    event: "acknowledged",
    alarmId: historyRecord.alarmId,
    ruleName: historyRecord.name,
    severity: historyRecord.severity,
    assetId: historyRecord.assetId,
    assetName: historyRecord.assetName,
  });
  res.json(updated);
});

router.get("/alarms/history", async (req, res): Promise<void> => {
  const query = ListAlarmHistoryQueryParams.safeParse(req.query);
  if (!query.success) {
    respondInvalid(req, res, query.error);
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
