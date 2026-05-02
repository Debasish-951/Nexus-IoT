import { Router, type IRouter } from "express";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { db, telemetryTable, assetsTable, attributesTable } from "@workspace/db";
import {
  IngestPayloadBody,
  IngestBatchBody,
  GetTelemetryParams,
  GetTelemetryQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function processPayload(payload: {
  deviceId: string;
  assetId?: string | null;
  timestamp?: Date | string | null;
  timestampUnix?: number | null;
  metrics?: Record<string, unknown>;
}) {
  let assetId = payload.assetId;

  // If no assetId, try to find asset by deviceId as identifier
  if (!assetId) {
    const [asset] = await db
      .select({ id: assetsTable.id })
      .from(assetsTable)
      .where(eq(assetsTable.identifier, payload.deviceId));
    assetId = asset?.id;
  }

  if (!assetId || !payload.metrics) {
    return { recordsWritten: 0, assetId: null };
  }

  let ts: Date;
  if (payload.timestampUnix) {
    ts = new Date(payload.timestampUnix * 1000);
  } else if (payload.timestamp) {
    ts = new Date(payload.timestamp as string);
  } else {
    ts = new Date();
  }

  const records = Object.entries(payload.metrics).map(([metric, value]) => ({
    assetId,
    deviceId: payload.deviceId,
    metric,
    value,
    timestamp: ts,
    quality: "good",
  }));

  if (records.length > 0) {
    await db.insert(telemetryTable).values(records as any[]);

    // Update matching dynamic attributes
    for (const [metric, value] of Object.entries(payload.metrics)) {
      await db
        .update(attributesTable)
        .set({ value, timestamp: ts })
        .where(
          and(
            eq(attributesTable.assetId, assetId as string),
            eq(attributesTable.tagName, `${payload.deviceId}.${metric}`)
          )
        );
    }
  }

  return { recordsWritten: records.length, assetId };
}

router.post("/ingest/payload", async (req, res): Promise<void> => {
  const parsed = IngestPayloadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await processPayload({
    deviceId: parsed.data.deviceId,
    assetId: parsed.data.assetId ?? null,
    timestamp: parsed.data.timestamp ?? null,
    timestampUnix: parsed.data.timestampUnix ?? null,
    metrics: parsed.data.metrics as Record<string, unknown> ?? {},
  });

  res.json({
    success: true,
    recordsWritten: result.recordsWritten,
    assetId: result.assetId,
    message: `Ingested ${result.recordsWritten} metric(s)`,
  });
});

router.post("/ingest/batch", async (req, res): Promise<void> => {
  const parsed = IngestBatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let successCount = 0;
  let failureCount = 0;

  for (const payload of parsed.data) {
    try {
      await processPayload({
        deviceId: payload.deviceId,
        assetId: payload.assetId ?? null,
        timestamp: payload.timestamp ?? null,
        timestampUnix: payload.timestampUnix ?? null,
        metrics: payload.metrics as Record<string, unknown> ?? {},
      });
      successCount++;
    } catch {
      failureCount++;
    }
  }

  res.json({
    success: failureCount === 0,
    totalRecords: parsed.data.length,
    successCount,
    failureCount,
  });
});

router.get("/telemetry/:assetId", async (req, res): Promise<void> => {
  const params = GetTelemetryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const query = GetTelemetryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions = [eq(telemetryTable.assetId, params.data.assetId)];

  if (query.data.metric) {
    conditions.push(eq(telemetryTable.metric, query.data.metric));
  }
  if (query.data.from) {
    conditions.push(gte(telemetryTable.timestamp, new Date(query.data.from as string)));
  }
  if (query.data.to) {
    conditions.push(lte(telemetryTable.timestamp, new Date(query.data.to as string)));
  }

  const records = await db
    .select()
    .from(telemetryTable)
    .where(and(...conditions))
    .orderBy(desc(telemetryTable.timestamp))
    .limit(query.data.limit ?? 100);

  res.json(records);
});

export default router;
