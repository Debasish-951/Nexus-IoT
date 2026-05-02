import { Router, type IRouter } from "express";
import { eq, sql, desc, gte } from "drizzle-orm";
import { db, assetsTable, alarmsTable, brokersTable, usersTable, telemetryTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const [assetCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assetsTable);

  const [activeAlarmCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(alarmsTable)
    .where(eq(alarmsTable.status, "active"));

  const [criticalAlarmCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(alarmsTable)
    .where(eq(alarmsTable.severity, "critical"));

  const [connectedBrokers] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(brokersTable)
    .where(eq(brokersTable.status, "connected"));

  const [userCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable);

  // Telemetry rate: records in last 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const [recentTelemetry] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(telemetryTable)
    .where(gte(telemetryTable.timestamp, fiveMinAgo));

  const [lastTelemetry] = await db
    .select({ timestamp: telemetryTable.timestamp })
    .from(telemetryTable)
    .orderBy(desc(telemetryTable.timestamp))
    .limit(1);

  res.json({
    totalAssets: assetCount?.count ?? 0,
    activeAlarms: activeAlarmCount?.count ?? 0,
    criticalAlarms: criticalAlarmCount?.count ?? 0,
    connectedBrokers: connectedBrokers?.count ?? 0,
    totalUsers: userCount?.count ?? 0,
    telemetryRate: ((recentTelemetry?.count ?? 0) / 5),
    lastIngestionAt: lastTelemetry?.timestamp ?? null,
  });
});

router.get("/dashboard/recent-telemetry", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const records = await db
    .select()
    .from(telemetryTable)
    .orderBy(desc(telemetryTable.timestamp))
    .limit(limit);

  res.json(records);
});

router.get("/dashboard/alarm-stats", async (req, res): Promise<void> => {
  const stats = await db
    .select({
      severity: alarmsTable.severity,
      count: sql<number>`count(*)::int`,
    })
    .from(alarmsTable)
    .where(eq(alarmsTable.status, "active"))
    .groupBy(alarmsTable.severity);

  const result = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const row of stats) {
    if (row.severity in result) {
      result[row.severity as keyof typeof result] = row.count;
    }
  }

  res.json(result);
});

export default router;
