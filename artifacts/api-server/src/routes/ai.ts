import { Router, type IRouter } from "express";
import { eq, and, or, ilike, sql, desc, gte, inArray } from "drizzle-orm";
import {
  db,
  assetsTable,
  telemetryTable,
  alarmsTable,
  alarmHistoryTable,
  brokersTable,
  usersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Config ────────────────────────────────────────────────────────────────────
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// llama-3.3-70b-versatile = best free Groq model for tool use.
// Override via GROQ_MODEL env if desired (e.g. llama-3.1-8b-instant for speed).
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const MAX_TOOL_ROUNDS = 6; // safety cap on the agentic loop

const SYSTEM_PROMPT = `You are the AI Assistant for an industrial IoT platform called Integrated Suite.
You answer questions about physical assets (machines/sensors), their telemetry (time-series readings), and alarms.

RULES:
- Answer ONLY from the data returned by the tools. Never invent numbers, asset names, or values.
- To reference an asset by name (e.g. "Pump-101", "Fan"), first call resolve_asset to get its id.
- Call tools to gather the data you need, then give a clear, concise answer.
- Always cite concrete numbers, units, and timestamps from the tool results.
- If the tools return no data for a question, say so plainly — do not guess.
- You are READ-ONLY. You cannot change, acknowledge, or delete anything. If asked to, explain that you can only report.
- For "needs maintenance" / "recommendations" questions, rank assets using available signals
  (active alarms, recent alarm history, data freshness/staleness, rate-of-change in metrics) and
  state clearly that this is a heuristic ranking, not a machine-learning failure prediction.
- Keep answers focused. Use short paragraphs or bullet points.`;

// ── Tool implementations (all READ-ONLY) ────────────────────────────────────────

async function resolveAsset(args: { query: string }) {
  const q = `%${(args.query ?? "").trim()}%`;
  const rows = await db
    .select({
      id: assetsTable.id,
      name: assetsTable.name,
      identifier: assetsTable.identifier,
      maintenanceMode: assetsTable.maintenanceMode,
    })
    .from(assetsTable)
    .where(or(ilike(assetsTable.name, q), ilike(assetsTable.identifier, q)))
    .limit(10);
  return { matches: rows };
}

async function listAssets() {
  const rows = await db
    .select({
      id: assetsTable.id,
      name: assetsTable.name,
      identifier: assetsTable.identifier,
      parentId: assetsTable.parentId,
      childCount: assetsTable.childCount,
      maintenanceMode: assetsTable.maintenanceMode,
    })
    .from(assetsTable)
    .orderBy(assetsTable.name)
    .limit(500);
  return { count: rows.length, assets: rows };
}

async function listMetrics(args: { assetId: string }) {
  const rows = await db
    .selectDistinct({ metric: telemetryTable.metric })
    .from(telemetryTable)
    .where(eq(telemetryTable.assetId, args.assetId))
    .limit(100);
  return { metrics: rows.map((r) => r.metric) };
}

async function getLatestTelemetry(args: { assetId: string }) {
  // Latest reading per metric for the asset.
  const rows = await db.execute<{
    metric: string;
    value: unknown;
    quality: string | null;
    timestamp: string;
  }>(sql`
    SELECT DISTINCT ON (metric) metric, value, quality, timestamp
    FROM telemetry
    WHERE asset_id = ${args.assetId}
    ORDER BY metric, timestamp DESC
  `);
  return { latest: rows.rows };
}

async function queryTelemetry(args: { assetId: string; metric: string; hours?: number }) {
  const hours = Math.min(Math.max(args.hours ?? 24, 1), 24 * 30);
  const since = new Date(Date.now() - hours * 3600_000);
  const rows = await db
    .select({
      value: telemetryTable.value,
      timestamp: telemetryTable.timestamp,
    })
    .from(telemetryTable)
    .where(
      and(
        eq(telemetryTable.assetId, args.assetId),
        eq(telemetryTable.metric, args.metric),
        gte(telemetryTable.timestamp, since),
      ),
    )
    .orderBy(desc(telemetryTable.timestamp))
    .limit(200);
  return { metric: args.metric, hours, count: rows.length, points: rows };
}

async function aggregateTelemetry(args: { assetId: string; metric: string; hours?: number }) {
  const hours = Math.min(Math.max(args.hours ?? 24, 1), 24 * 30);
  const since = new Date(Date.now() - hours * 3600_000);
  // Only aggregate numeric values.
  const rows = await db.execute<{
    n: number; avg: number | null; min: number | null; max: number | null;
    first_ts: string | null; last_ts: string | null;
  }>(sql`
    SELECT
      COUNT(*)::int AS n,
      AVG((value#>>'{}')::numeric) AS avg,
      MIN((value#>>'{}')::numeric) AS min,
      MAX((value#>>'{}')::numeric) AS max,
      MIN(timestamp) AS first_ts,
      MAX(timestamp) AS last_ts
    FROM telemetry
    WHERE asset_id = ${args.assetId}
      AND metric = ${args.metric}
      AND timestamp >= ${since}
      AND jsonb_typeof(value) = 'number'
  `);
  return { metric: args.metric, hours, stats: rows.rows[0] ?? null };
}

async function assetHealth(args: { assetId: string }) {
  const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, args.assetId));
  if (!asset) return { error: "asset not found" };

  const [alarmCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(alarmsTable)
    .where(and(eq(alarmsTable.assetId, args.assetId), eq(alarmsTable.status, "active")));

  const latest = await getLatestTelemetry({ assetId: args.assetId });
  const lastSeen = latest.latest.reduce<string | null>((acc, r) => {
    const ts = r.timestamp as string;
    return !acc || ts > acc ? ts : acc;
  }, null);

  const activeAlarms = alarmCount?.count ?? 0;
  const stale = lastSeen ? Date.now() - new Date(lastSeen).getTime() > 30 * 60_000 : true;
  const health = activeAlarms > 0 ? "alarm" : stale ? "stale" : "ok";

  return {
    assetId: asset.id,
    name: asset.name,
    health,
    activeAlarms,
    maintenanceMode: asset.maintenanceMode,
    lastSeen,
    latestMetrics: latest.latest,
  };
}

async function getAlarms(args: { status?: string; severity?: string }) {
  const conds = [];
  if (args.status) conds.push(eq(alarmsTable.status, args.status));
  else conds.push(inArray(alarmsTable.status, ["active", "acknowledged"]));
  if (args.severity) conds.push(eq(alarmsTable.severity, args.severity));

  const rows = await db
    .select({
      name: alarmsTable.name,
      assetName: alarmsTable.assetName,
      severity: alarmsTable.severity,
      status: alarmsTable.status,
      message: alarmsTable.message,
      triggeredAt: alarmsTable.triggeredAt,
    })
    .from(alarmsTable)
    .where(conds.length === 1 ? conds[0] : and(...conds))
    .orderBy(desc(alarmsTable.triggeredAt))
    .limit(100);
  return { count: rows.length, alarms: rows };
}

async function getAlarmHistory(args: { hours?: number }) {
  const hours = Math.min(Math.max(args.hours ?? 168, 1), 24 * 90);
  const since = new Date(Date.now() - hours * 3600_000);
  const rows = await db
    .select({
      name: alarmHistoryTable.name,
      assetName: alarmHistoryTable.assetName,
      severity: alarmHistoryTable.severity,
      status: alarmHistoryTable.status,
      triggeredAt: alarmHistoryTable.triggeredAt,
      clearedAt: alarmHistoryTable.clearedAt,
    })
    .from(alarmHistoryTable)
    .where(gte(alarmHistoryTable.triggeredAt, since))
    .orderBy(desc(alarmHistoryTable.triggeredAt))
    .limit(200);
  return { hours, count: rows.length, history: rows };
}

async function fleetSummary() {
  const [assets] = await db.select({ c: sql<number>`count(*)::int` }).from(assetsTable);
  const [users] = await db.select({ c: sql<number>`count(*)::int` }).from(usersTable);
  const [connectedBrokers] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(brokersTable)
    .where(eq(brokersTable.status, "connected"));
  const bySeverity = await db
    .select({ severity: alarmsTable.severity, c: sql<number>`count(*)::int` })
    .from(alarmsTable)
    .where(eq(alarmsTable.status, "active"))
    .groupBy(alarmsTable.severity);
  const [recent] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(telemetryTable)
    .where(gte(telemetryTable.timestamp, new Date(Date.now() - 5 * 60_000)));

  return {
    totalAssets: assets?.c ?? 0,
    totalUsers: users?.c ?? 0,
    connectedBrokers: connectedBrokers?.c ?? 0,
    activeAlarmsBySeverity: bySeverity,
    telemetryRatePerMin: (recent?.c ?? 0) / 5,
  };
}

// ── Tool registry: executor + JSON-schema definition for the model ──────────────
type ToolFn = (args: any) => Promise<unknown>;

const TOOLS: Record<string, { fn: ToolFn; def: any }> = {
  resolve_asset: {
    fn: resolveAsset,
    def: {
      name: "resolve_asset",
      description: "Find assets by (partial) name or identifier. Use this to turn an asset name like 'Pump-101' into an asset id before calling other tools.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Asset name or identifier (partial allowed)" } },
        required: ["query"],
      },
    },
  },
  list_assets: {
    fn: listAssets,
    def: {
      name: "list_assets",
      description: "List all assets with id, name, identifier, child count, and maintenance status.",
      parameters: { type: "object", properties: {} },
    },
  },
  list_metrics: {
    fn: listMetrics,
    def: {
      name: "list_metrics",
      description: "List the distinct telemetry metric names that exist for one asset.",
      parameters: {
        type: "object",
        properties: { assetId: { type: "string", description: "Asset UUID" } },
        required: ["assetId"],
      },
    },
  },
  get_latest_telemetry: {
    fn: getLatestTelemetry,
    def: {
      name: "get_latest_telemetry",
      description: "Get the most recent reading for each metric of an asset.",
      parameters: {
        type: "object",
        properties: { assetId: { type: "string", description: "Asset UUID" } },
        required: ["assetId"],
      },
    },
  },
  query_telemetry: {
    fn: queryTelemetry,
    def: {
      name: "query_telemetry",
      description: "Get raw time-series points for one metric of one asset over the last N hours (max 200 points).",
      parameters: {
        type: "object",
        properties: {
          assetId: { type: "string", description: "Asset UUID" },
          metric: { type: "string", description: "Metric name, e.g. vibration, temperature" },
          hours: { type: "number", description: "Look-back window in hours (default 24)" },
        },
        required: ["assetId", "metric"],
      },
    },
  },
  aggregate_telemetry: {
    fn: aggregateTelemetry,
    def: {
      name: "aggregate_telemetry",
      description: "Get count, average, min, max of a numeric metric for one asset over the last N hours. Use for trends and comparisons.",
      parameters: {
        type: "object",
        properties: {
          assetId: { type: "string", description: "Asset UUID" },
          metric: { type: "string", description: "Metric name" },
          hours: { type: "number", description: "Look-back window in hours (default 24)" },
        },
        required: ["assetId", "metric"],
      },
    },
  },
  asset_health: {
    fn: assetHealth,
    def: {
      name: "asset_health",
      description: "Get a health summary for one asset: ok/alarm/stale status, active alarm count, last-seen time, maintenance mode, and latest metric values.",
      parameters: {
        type: "object",
        properties: { assetId: { type: "string", description: "Asset UUID" } },
        required: ["assetId"],
      },
    },
  },
  get_alarms: {
    fn: getAlarms,
    def: {
      name: "get_alarms",
      description: "List current alarms. Optionally filter by status (active|acknowledged|cleared) or severity (critical|high|medium|low|info). Defaults to active+acknowledged.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "active|acknowledged|cleared" },
          severity: { type: "string", description: "critical|high|medium|low|info" },
        },
      },
    },
  },
  get_alarm_history: {
    fn: getAlarmHistory,
    def: {
      name: "get_alarm_history",
      description: "List historical alarm records over the last N hours (default 168 = 7 days). Use to find which assets alarm most often.",
      parameters: {
        type: "object",
        properties: { hours: { type: "number", description: "Look-back window in hours (default 168)" } },
      },
    },
  },
  fleet_summary: {
    fn: fleetSummary,
    def: {
      name: "fleet_summary",
      description: "Get platform-wide counts: total assets, users, connected brokers, active alarms by severity, and telemetry ingest rate per minute.",
      parameters: { type: "object", properties: {} },
    },
  },
};

const TOOL_SPECS = Object.values(TOOLS).map((t) => ({ type: "function", function: t.def }));

// ── Groq tool-use agent loop ────────────────────────────────────────────────────
async function callGroq(messages: any[]): Promise<any> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      messages,
      tools: TOOL_SPECS,
      tool_choice: "auto",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Groq API ${resp.status}: ${text}`);
  }
  return resp.json();
}

router.post("/ai/chat", async (req, res): Promise<void> => {
  if (!process.env.GROQ_API_KEY) {
    res.status(503).json({
      error: "AI Assistant not configured. Set GROQ_API_KEY in your .env (free key from https://console.groq.com).",
    });
    return;
  }

  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  // Optional prior turns: [{ role: "user"|"assistant", content }]
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m: any) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];

  const toolTrace: { tool: string; args: unknown }[] = [];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const data = await callGroq(messages);
      const msg = data?.choices?.[0]?.message;
      if (!msg) {
        res.status(502).json({ error: "Empty response from model" });
        return;
      }

      const toolCalls = msg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        res.json({ answer: msg.content ?? "", steps: toolTrace, model: GROQ_MODEL });
        return;
      }

      // Append the assistant turn carrying the tool calls.
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });

      // Execute each requested tool and append the results.
      for (const call of toolCalls) {
        const name = call.function?.name;
        let args: any = {};
        try {
          args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }
        let result: unknown;
        const tool = name ? TOOLS[name] : undefined;
        if (!tool) {
          result = { error: `unknown tool: ${name}` };
        } else {
          try {
            result = await tool.fn(args);
            toolTrace.push({ tool: name, args });
          } catch (err: any) {
            result = { error: err?.message ?? "tool execution failed" };
          }
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    // Loop exhausted — ask for a final answer without tools.
    const finalData = await callGroq([
      ...messages,
      { role: "user", content: "Give your best final answer now from the data already gathered." },
    ]);
    const finalMsg = finalData?.choices?.[0]?.message?.content ?? "I couldn't complete that within the step limit.";
    res.json({ answer: finalMsg, steps: toolTrace, model: GROQ_MODEL, truncated: true });
  } catch (err: any) {
    logger.error({ err: err?.message }, "AI chat failed");
    res.status(502).json({ error: err?.message ?? "AI request failed" });
  }
});

export default router;
