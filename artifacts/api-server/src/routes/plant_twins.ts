import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { db, pool, assetsTable, plantTwinsTable } from "@workspace/db";
import { z } from "zod";
import { logActivity } from "./activity_log";
import { validate } from "../middleware/validate";
import { recordSecurityEvent } from "../lib/security-log";
import { isSuperAdmin } from "../lib/viz-access";
import { assetScope } from "../lib/project-access";
import {
  CreatePlantTwinBody, UpdatePlantTwinBody, PlantTwinParams, PlantTwinValuesBody,
} from "../schemas/common";

/**
 * 3D plant twins (Live Twin → "3D plant twins").
 *
 * Who may do what:
 * - See a twin: Visualization read (ROUTE_RULES), and the twin's project must be
 *   one this user may open. A twin with no project shows to everyone with read.
 * - Create: Visualization write (ROUTE_RULES).
 * - Change or delete: the owner, or a Super Admin / Company Admin. Checked here,
 *   because it depends on the row.
 * - Live values: only for assets inside the caller's projects; others are dropped.
 *
 * Hand-written, like viz_nodes: the scene is free-form JSON the 3D editor owns.
 */
const router: IRouter = Router();
type Row = typeof plantTwinsTable.$inferSelect;

/**
 * The table is new; an installation that has not run `db push` yet gets a
 * message saying what to do instead of an anonymous 500.
 */
let tableReady = false;
router.use("/plant-twins", (_req, res, next) => {
  if (tableReady) { next(); return; }
  db.select({ id: plantTwinsTable.id }).from(plantTwinsTable).limit(1)
    .then(() => { tableReady = true; next(); })
    .catch((err: { code?: string; cause?: { code?: string } }) => {
      if (err?.code === "42P01" || err?.cause?.code === "42P01") {
        res.status(503).json({ error: "3D plant twins are not set up on this server yet: the plant_twins table is missing. An administrator must run `pnpm --filter @workspace/db run push`.", code: "plant_twins_table_missing" });
        return;
      }
      next(err);
    });
});

/** A large plant has far more keys than a dashboard; depth and string limits stay as they are. */
const SCENE_LIMITS = { maxKeys: 40_000, maxArrayLength: 5000 };

const canEdit = (req: Request, row: Row) => isSuperAdmin(req.principal) || (!!row.ownerId && row.ownerId === req.principal!.user.id);

async function canSee(req: Request, row: Row): Promise<boolean> {
  if (!row.projectId) return true;
  const scope = await assetScope(req);
  return !scope || scope.roots.has(row.projectId);
}

/** A twin may name only a real project (root asset) this user may open. */
async function canUseProject(req: Request, projectId: string): Promise<boolean> {
  const [project] = await db.select({ parentId: assetsTable.parentId }).from(assetsTable).where(eq(assetsTable.id, projectId));
  if (!project || project.parentId) return false;
  const scope = await assetScope(req);
  return !scope || scope.roots.has(projectId);
}

function deny(req: Request, res: Response, reason: string, message: string): void {
  recordSecurityEvent({
    type: "authz.denied", outcome: "failure", reason,
    userId: req.principal?.user.id ?? null, username: req.principal?.user.username ?? null,
    detail: { method: req.method, path: req.path }, req,
  });
  res.status(403).json({ error: message, code: "plant_twin_access_denied" });
}

function machineCount(scene: unknown): number {
  const items = (scene as { items?: unknown })?.items;
  return Array.isArray(items) ? items.length : 0;
}

/**
 * "plant" (whole plant, Builder), "machine" (detailed pump skid), "process"
 * (P&ID), "asset" (machines from the library) or "folder" (a node of the Live
 * Twin hierarchy; holds no scene of its own).
 */
function kindOf(scene: unknown): string {
  const k = (scene as { kind?: unknown })?.kind;
  return k === "machine" || k === "process" || k === "asset" || k === "folder" ? k : "plant";
}

/** Hierarchy fields live in the scene document, so they need no extra column. */
function parentOf(scene: unknown): string | null {
  const p = (scene as { parent?: unknown })?.parent;
  return typeof p === "string" && p ? p : null;
}
function forTypeOf(scene: unknown): string | null {
  const t = (scene as { forType?: unknown })?.forType;
  return typeof t === "string" && t ? t : null;
}

/**
 * Checks a new parent: it must be a folder the caller can see, and must not be
 * the twin itself or one of its own descendants. Returns an error message or null.
 */
async function parentProblem(req: Request, id: string | null, parentId: string): Promise<string | null> {
  if (id && parentId === id) return "A folder cannot contain itself.";
  const rows = await db.select().from(plantTwinsTable);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parent = byId.get(parentId);
  if (!parent || kindOf(parent.scene) !== "folder" || !(await canSee(req, parent))) return "That folder does not exist.";
  let cur: string | null = parentId;
  for (let i = 0; cur && i < 200; i++) {
    if (cur === id) return "A folder cannot be moved into its own subfolder.";
    cur = parentOf(byId.get(cur)?.scene);
  }
  return null;
}

function toClient(req: Request, row: Row, withScene: boolean) {
  return {
    id: row.id,
    name: row.name,
    kind: kindOf(row.scene),
    projectId: row.projectId ?? null,
    machines: machineCount(row.scene),
    parentId: parentOf(row.scene),
    forType: forTypeOf(row.scene),
    updatedAt: row.updatedAt,
    canEdit: canEdit(req, row),
    ...(withScene ? { scene: row.scene ?? {} } : {}),
  };
}

// ── Read ─────────────────────────────────────────────────────────────────────
router.get("/plant-twins", async (req, res): Promise<void> => {
  const [rows, scope] = await Promise.all([
    db.select().from(plantTwinsTable).orderBy(desc(plantTwinsTable.updatedAt)),
    assetScope(req),
  ]);
  res.json(rows
    .filter((r) => !r.projectId || !scope || scope.roots.has(r.projectId))
    .map((r) => toClient(req, r, false)));
});

/**
 * Latest reading for each asset + metric pair. A POST only because the list can
 * be long; it changes nothing. Pairs outside the caller's projects are dropped,
 * not refused, so one moved asset does not blank the whole twin.
 */
router.post("/plant-twins/values", validate({ body: PlantTwinValuesBody }), async (req, res): Promise<void> => {
  const { pairs } = req.body as z.infer<typeof PlantTwinValuesBody>;
  const scope = await assetScope(req);
  const seen = new Set<string>();
  const wanted = pairs.filter((p) => {
    const k = `${p.assetId}\u0000${p.metric}`;
    if (seen.has(k) || (scope && !scope.assetIds.has(p.assetId))) return false;
    seen.add(k);
    return true;
  });
  if (!wanted.length) { res.json([]); return; }
  // One indexed lookup per pair (idx_telemetry_asset_metric_ts), not a scan.
  const { rows } = await pool.query<{ asset_id: string; metric: string; value: unknown; timestamp: Date }>(
    `SELECT p.asset_id, p.metric, l.value, l."timestamp"
       FROM unnest($1::uuid[], $2::text[]) AS p(asset_id, metric)
       CROSS JOIN LATERAL (
         SELECT t.value, t."timestamp" FROM telemetry t
          WHERE t.asset_id = p.asset_id AND t.metric = p.metric
          ORDER BY t."timestamp" DESC LIMIT 1
       ) l`,
    [wanted.map((p) => p.assetId), wanted.map((p) => p.metric)],
  );
  res.json(rows.map((r) => {
    const n = typeof r.value === "number" ? r.value : Number(r.value);
    return { assetId: r.asset_id, metric: r.metric, value: Number.isFinite(n) ? n : null, ts: r.timestamp };
  }));
});

router.get("/plant-twins/:id", validate({ params: PlantTwinParams }), async (req, res): Promise<void> => {
  const { id } = req.params as z.infer<typeof PlantTwinParams>;
  const [row] = await db.select().from(plantTwinsTable).where(eq(plantTwinsTable.id, id));
  if (!row || !(await canSee(req, row))) { res.status(404).json({ error: "Twin not found" }); return; }
  res.json(toClient(req, row, true));
});

// ── Create ───────────────────────────────────────────────────────────────────
router.post("/plant-twins", validate({ body: CreatePlantTwinBody, jsonLimits: SCENE_LIMITS }), async (req, res): Promise<void> => {
  const body = req.body as z.infer<typeof CreatePlantTwinBody>;
  const projectId = body.projectId ?? null;
  if (projectId && !(await canUseProject(req, projectId))) {
    deny(req, res, "plant_twin_project_denied", "You cannot add a twin to that project.");
    return;
  }
  const newParent = parentOf(body.scene);
  if (newParent) {
    const problem = await parentProblem(req, null, newParent);
    if (problem) { res.status(400).json({ error: problem, code: "plant_twin_parent_invalid" }); return; }
  }
  const id = body.id ?? `pt-${crypto.randomUUID()}`;
  const [row] = await db.insert(plantTwinsTable)
    .values({ id, name: body.name, projectId, scene: body.scene, ownerId: req.principal!.user.id })
    .onConflictDoNothing()
    .returning();
  if (!row) { res.status(409).json({ error: "That id is already in use.", code: "id_conflict" }); return; }
  await logActivity("plant_twin.created", "visualization", row.id, row.name, `${machineCount(row.scene)} machine(s)`, req);
  res.status(201).json(toClient(req, row, true));
});

// ── Update ───────────────────────────────────────────────────────────────────
router.put("/plant-twins/:id", validate({ params: PlantTwinParams, body: UpdatePlantTwinBody, jsonLimits: SCENE_LIMITS }), async (req, res): Promise<void> => {
  const { id } = req.params as z.infer<typeof PlantTwinParams>;
  const body = req.body as z.infer<typeof UpdatePlantTwinBody>;
  const [row] = await db.select().from(plantTwinsTable).where(eq(plantTwinsTable.id, id));
  if (!row || !(await canSee(req, row))) { res.status(404).json({ error: "Twin not found" }); return; }
  if (!canEdit(req, row)) { deny(req, res, "plant_twin_edit_denied", "Only the owner or an administrator can change this twin."); return; }
  if (body.projectId && body.projectId !== row.projectId && !(await canUseProject(req, body.projectId))) {
    deny(req, res, "plant_twin_project_denied", "You cannot move this twin to that project.");
    return;
  }
  if (body.parentId) {
    const problem = await parentProblem(req, row.id, body.parentId);
    if (problem) { res.status(400).json({ error: problem, code: "plant_twin_parent_invalid" }); return; }
  }
  const patch: Partial<typeof plantTwinsTable.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.projectId !== undefined) patch.projectId = body.projectId;
  // A scene save from the editor does not carry the hierarchy fields: keep them,
  // and apply a move (parentId) on top of whichever scene is being written.
  if (body.scene !== undefined || body.parentId !== undefined) {
    const base = (body.scene ?? row.scene ?? {}) as Record<string, unknown>;
    const parent = body.parentId !== undefined ? body.parentId : parentOf(row.scene);
    const forType = forTypeOf(row.scene) ?? forTypeOf(base);
    patch.scene = { ...base, parent, ...(forType ? { forType } : {}) };
  }
  if (!Object.keys(patch).length) { res.json(toClient(req, row, true)); return; }
  const [updated] = await db.update(plantTwinsTable).set(patch).where(eq(plantTwinsTable.id, id)).returning();
  // Scene saves happen as the user edits; log renames and project moves, not every drag.
  if (body.name !== undefined || body.projectId !== undefined) {
    await logActivity("plant_twin.updated", "visualization", updated.id, updated.name, null, req);
  }
  if (body.parentId !== undefined && body.parentId !== parentOf(row.scene)) {
    await logActivity("plant_twin.moved", "visualization", updated.id, updated.name, body.parentId ? `into folder ${body.parentId}` : "to top level", req);
  }
  res.json(toClient(req, updated, true));
});

// ── Delete ───────────────────────────────────────────────────────────────────
router.delete("/plant-twins/:id", validate({ params: PlantTwinParams }), async (req, res): Promise<void> => {
  const { id } = req.params as z.infer<typeof PlantTwinParams>;
  const [row] = await db.select().from(plantTwinsTable).where(eq(plantTwinsTable.id, id));
  if (!row || !(await canSee(req, row))) { res.status(404).json({ error: "Twin not found" }); return; }
  if (!canEdit(req, row)) { deny(req, res, "plant_twin_delete_denied", "Only the owner or an administrator can delete this twin."); return; }
  await db.delete(plantTwinsTable).where(eq(plantTwinsTable.id, id));
  // Deleting a folder keeps what was inside it: its twins and subfolders move up one level.
  if (kindOf(row.scene) === "folder") {
    const up = parentOf(row.scene);
    const children = (await db.select().from(plantTwinsTable)).filter((r) => parentOf(r.scene) === id);
    for (const c of children) {
      await db.update(plantTwinsTable).set({ scene: { ...((c.scene ?? {}) as Record<string, unknown>), parent: up } }).where(eq(plantTwinsTable.id, c.id));
    }
  }
  await logActivity("plant_twin.deleted", "visualization", id, row.name, null, req);
  res.status(204).end();
});

export default router;
