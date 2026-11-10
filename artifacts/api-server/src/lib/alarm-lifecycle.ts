import { and, eq, inArray } from "drizzle-orm";
import { db, alarmsTable, alarmHistoryTable } from "@workspace/db";
import { broadcast } from "./ws-broadcast";

/**
 * Close every open alarm a rule has raised, on every asset.
 *
 * Only enabled rules are evaluated, so an alarm left open when its rule is
 * disabled, deleted or redefined could never clear: the bell and the critical
 * banner stayed on with no way to end them. Called from the alarm rule routes.
 *
 * Returns the number of alarms closed.
 */
export async function closeOpenAlarmsForRule(ruleId: string, ruleName: string): Promise<number> {
  const clearedAt = new Date();
  const closed = await db
    .update(alarmsTable)
    .set({ status: "cleared", clearedAt })
    .where(and(eq(alarmsTable.ruleId, ruleId), inArray(alarmsTable.status, ["active", "acknowledged"])))
    .returning({ id: alarmsTable.id, assetId: alarmsTable.assetId, assetName: alarmsTable.assetName, severity: alarmsTable.severity });
  if (closed.length === 0) return 0;

  await db
    .update(alarmHistoryTable)
    .set({ status: "cleared", clearedAt })
    .where(inArray(alarmHistoryTable.alarmId, closed.map((a) => a.id)));

  for (const a of closed) {
    broadcast("alarm", {
      event: "cleared", alarmId: a.id, ruleName, severity: a.severity,
      assetId: a.assetId, assetName: a.assetName, timestamp: clearedAt.toISOString(),
      reason: "rule_changed",
    });
  }
  return closed.length;
}
