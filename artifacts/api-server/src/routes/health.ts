import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Readiness: answers 200 only when the database responds. /healthz only shows
 * that the process is up, so monitoring pointed at it stayed green during a
 * database outage while every request failed.
 */
router.get("/readyz", async (_req, res): Promise<void> => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: "ok", database: "ok" });
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "readiness check: database unavailable");
    res.status(503).json({ status: "unavailable", database: "unreachable" });
  }
});

export default router;
