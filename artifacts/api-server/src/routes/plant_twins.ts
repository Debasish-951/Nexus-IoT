import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db, pool, assetsTable, plantTwinsTable } from "@workspace/db";
import { z } from "zod";
import { logActivity } from "./activity_log";
import { validate } from "../middleware/validate";
import { recordSecurityEvent } from "../lib/security-log";
import { isSuperAdmin } from "../lib/viz-access";
import { assetScope } from "../lib/project-access";
import { logger } from "../lib/logger";
import { PLANT_SCENE_JSON_LIMITS } from "../lib/validation";
import { isStaleWrite, mayUseNoProject, wouldCreateCycle } from "../lib/twin-rules";
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
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Everything but the scene. A scene can hold a 2D twin's background image (up to
 * about 900 KB), so lists, moves and folder deletes read only these columns;
 * the hierarchy fields are picked out of the JSON by the database.
 */
const t = plantTwinsTable;
const META = {
  id: t.id,
  name: t.name,
  projectId: t.projectId,
  ownerId: t.ownerId,
  updatedAt: t.updatedAt,
  sceneKind: sql<string | null>`${t.scene} ->> 'kind'`,
  parentId: sql<string | null>`CASE WHEN jsonb_typeof(${t.scene} -> 'parent') = 'string' THEN ${t.scene} ->> 'parent' END`,
  forType: sql<string | null>`CASE WHEN jsonb_typeof(${t.scene} -> 'forType') = 'string' THEN ${t.scene} ->> 'forType' END`,
  machines: sql<number>`CASE WHEN jsonb_typeof(${t.scene} -> 'items') = 'array' THEN jsonb_array_length(${t.scene} -> 'items') ELSE 0 END`.mapWith(Number),
};
type Meta = { id: string; name: string; projectId: string | null; ownerId: string | null; updatedAt: Date; sceneKind: string | null; parentId: string | null; forType: string | null; machines: number };

/** Two folder moves at once could otherwise each pass the cycle check and build a loop together. */
const lockTree = (tx: Tx) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('plant_twins_tree'))`);
/** `scene.parent` set in place, without reading the scene into the API. */
const withParent = (parent: string | null): SQL =>
  sql`jsonb_set(${t.scene}, '{parent}', ${parent === null ? sql`'null'::jsonb` : sql`to_jsonb(${parent}::text)`})`;

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
const SCENE_LIMITS = PLANT_SCENE_JSON_LIMITS;

const canEdit = (req: Request, row: { ownerId: string | null }) => isSuperAdmin(req.principal) || (!!row.ownerId && row.ownerId === req.principal!.user.id);

async function canSee(req: Request, row: { projectId: string | null }): Promise<boolean> {
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
 * (P&ID), "asset" (machines from the library), "image" (2D twin: a drawing or
 * photo with mapped readings) or "folder" (a node of the Live
 * Twin hierarchy; holds no scene of its own).
 */
function kindOf(scene: unknown): string {
  const k = (scene as { kind?: unknown })?.kind;
  return k === "machine" || k === "process" || k === "asset" || k === "image" || k === "folder" ? k : "plant";
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
 * Reads the hierarchy columns only, never the scenes.
 */
async function parentProblem(req: Request, id: string | null, parentId: string, ex: Pick<Tx, "select"> = db): Promise<string | null> {
  if (id && parentId === id) return "A folder cannot contain itself.";
  const rows = await ex.select({ id: t.id, projectId: t.projectId, sceneKind: META.sceneKind, parentId: META.parentId }).from(t);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parent = byId.get(parentId);
  if (!parent || kindOf({ kind: parent.sceneKind }) !== "folder" || !(await canSee(req, parent))) return "That folder does not exist.";
  if (id && wouldCreateCycle((x) => byId.get(x)?.parentId || null, id, parentId)) return "A folder cannot be moved into its own subfolder.";
  return null;
}

function metaOf(row: Row): Meta {
  return {
    id: row.id, name: row.name, projectId: row.projectId ?? null, ownerId: row.ownerId ?? null, updatedAt: row.updatedAt,
    sceneKind: kindOf(row.scene), parentId: parentOf(row.scene), forType: forTypeOf(row.scene), machines: machineCount(row.scene),
  };
}

/** `scene` is included when given (a full row) and left out of list entries. */
function toClient(req: Request, m: Meta, scene?: unknown) {
  return {
    id: m.id,
    name: m.name,
    kind: kindOf({ kind: m.sceneKind }),
    projectId: m.projectId ?? null,
    machines: m.machines,
    parentId: m.parentId || null,
    forType: m.forType || null,
    updatedAt: m.updatedAt,
    canEdit: canEdit(req, m),
    ...(scene !== undefined ? { scene: scene ?? {} } : {}),
  };
}
const fullToClient = (req: Request, row: Row) => toClient(req, metaOf(row), row.scene ?? {});

// ── Read ─────────────────────────────────────────────────────────────────────
router.get("/plant-twins", async (req, res): Promise<void> => {
  const [rows, scope] = await Promise.all([
    db.select(META).from(plantTwinsTable).orderBy(desc(plantTwinsTable.updatedAt)),
    assetScope(req),
  ]);
  res.json(rows
    .filter((r) => !r.projectId || !scope || scope.roots.has(r.projectId))
    .map((r) => toClient(req, r)));
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
  res.json(fullToClient(req, row));
});

// ── Create ───────────────────────────────────────────────────────────────────
router.post("/plant-twins", validate({ body: CreatePlantTwinBody, jsonLimits: SCENE_LIMITS }), async (req, res): Promise<void> => {
  const body = req.body as z.infer<typeof CreatePlantTwinBody>;
  const projectId = body.projectId ?? null;
  if (projectId && !(await canUseProject(req, projectId))) {
    deny(req, res, "plant_twin_project_denied", "You cannot add a twin to that project.");
    return;
  }
  if (!mayUseNoProject(!!(await assetScope(req)), undefined, projectId)) {
    deny(req, res, "plant_twin_all_projects_denied", "Only a user who may open every project can add a twin that shows in all projects. Open a project first.");
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
  res.status(201).json(fullToClient(req, row));
});

// ── Update ───────────────────────────────────────────────────────────────────
//
// Optimistic locking, as viz_nodes does: the editor sends the `updatedAt` it
// loaded as `expectedUpdatedAt`, and a write over a newer version is refused
// with 409 instead of replacing it. A client that does not send it (an older
// browser tab during an upgrade) is accepted as before, and logged.
//
// `updatedAt` is the version of the scene: renames, project changes and folder
// moves leave it as it is, so they never make an open editor's next save fail.
// They do not touch what the editor writes (a scene save keeps the stored folder).
router.put("/plant-twins/:id", validate({ params: PlantTwinParams, body: UpdatePlantTwinBody, jsonLimits: SCENE_LIMITS }), async (req, res): Promise<void> => {
  const { id } = req.params as z.infer<typeof PlantTwinParams>;
  const { expectedUpdatedAt, ...body } = req.body as z.infer<typeof UpdatePlantTwinBody>;
  const [row] = await db.select(META).from(plantTwinsTable).where(eq(plantTwinsTable.id, id));
  if (!row || !(await canSee(req, row))) { res.status(404).json({ error: "Twin not found" }); return; }
  if (!canEdit(req, row)) { deny(req, res, "plant_twin_edit_denied", "Only the owner or an administrator can change this twin."); return; }
  if (body.projectId && body.projectId !== row.projectId && !(await canUseProject(req, body.projectId))) {
    deny(req, res, "plant_twin_project_denied", "You cannot move this twin to that project.");
    return;
  }
  if (!mayUseNoProject(!!(await assetScope(req)), row.projectId, body.projectId)) {
    deny(req, res, "plant_twin_all_projects_denied", "Only a user who may open every project can show a twin in all projects.");
    return;
  }
  const changes = body.name !== undefined || body.projectId !== undefined || body.scene !== undefined || body.parentId !== undefined;
  if (!changes) {
    const [full] = await db.select().from(plantTwinsTable).where(eq(plantTwinsTable.id, id));
    if (!full) { res.status(404).json({ error: "Twin not found" }); return; }
    res.json(fullToClient(req, full));
    return;
  }
  if (body.scene !== undefined && expectedUpdatedAt === undefined) {
    logger.warn({ twinId: id, userId: req.principal?.user.id }, "plant twin scene saved without expectedUpdatedAt (older client): no conflict check");
  }
  const moving = typeof body.parentId === "string";
  const outcome = await db.transaction(async (tx) => {
    if (moving) await lockTree(tx);
    // Locked between the check and the write, so two saves racing each other cannot both pass.
    const [cur] = await tx.select(META).from(plantTwinsTable).where(eq(plantTwinsTable.id, id)).for("update");
    if (!cur) return { status: "missing" as const };
    if (isStaleWrite(cur.updatedAt, expectedUpdatedAt)) return { status: "conflict" as const, updatedAt: cur.updatedAt };
    if (moving) {
      const problem = await parentProblem(req, cur.id, body.parentId!, tx);
      if (problem) return { status: "parent" as const, problem };
    }
    const set: PgUpdateSetSource<typeof plantTwinsTable> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.projectId !== undefined) set.projectId = body.projectId;
    if (body.scene !== undefined) {
      // A scene save from the editor does not carry the hierarchy fields: keep
      // them, and apply a move (parentId) on top of the scene being written.
      const parent = body.parentId !== undefined ? body.parentId : (cur.parentId || null);
      const forType = cur.forType || forTypeOf(body.scene);
      set.scene = { ...(body.scene as Record<string, unknown>), parent, ...(forType ? { forType } : {}) };
    } else {
      if (body.parentId !== undefined) set.scene = withParent(body.parentId);
      set.updatedAt = sql`${plantTwinsTable.updatedAt}`;
    }
    const [updated] = await tx.update(plantTwinsTable).set(set).where(eq(plantTwinsTable.id, id)).returning();
    return { status: "ok" as const, row: updated };
  });
  if (outcome.status === "missing" || (outcome.status === "ok" && !outcome.row)) { res.status(404).json({ error: "Twin not found" }); return; }
  if (outcome.status === "conflict") {
    res.status(409).json({
      error: "This twin was changed somewhere else after you opened it. Open it again to see the latest version; your changes were not saved.",
      code: "plant_twin_conflict",
      updatedAt: outcome.updatedAt,
    });
    return;
  }
  if (outcome.status === "parent") { res.status(400).json({ error: outcome.problem, code: "plant_twin_parent_invalid" }); return; }
  const updated = outcome.row;
  // Scene saves happen as the user edits; log renames and project moves, not every drag.
  if (body.name !== undefined || body.projectId !== undefined) {
    await logActivity("plant_twin.updated", "visualization", updated.id, updated.name, null, req);
  }
  if (body.parentId !== undefined && body.parentId !== (row.parentId || null)) {
    await logActivity("plant_twin.moved", "visualization", updated.id, updated.name, body.parentId ? `into folder ${body.parentId}` : "to top level", req);
  }
  res.json(fullToClient(req, updated));
});

// ── Delete ───────────────────────────────────────────────────────────────────
router.delete("/plant-twins/:id", validate({ params: PlantTwinParams }), async (req, res): Promise<void> => {
  const { id } = req.params as z.infer<typeof PlantTwinParams>;
  const [row] = await db.select(META).from(plantTwinsTable).where(eq(plantTwinsTable.id, id));
  if (!row || !(await canSee(req, row))) { res.status(404).json({ error: "Twin not found" }); return; }
  if (!canEdit(req, row)) { deny(req, res, "plant_twin_delete_denied", "Only the owner or an administrator can delete this twin."); return; }
  const folder = kindOf({ kind: row.sceneKind }) === "folder";
  // One transaction: a folder is never gone while its contents still point at it.
  await db.transaction(async (tx) => {
    if (folder) await lockTree(tx);
    await tx.delete(plantTwinsTable).where(eq(plantTwinsTable.id, id));
    // Deleting a folder keeps what was inside it: its twins and subfolders move up
    // one level. Done in the database, so no scene is read; their version is kept.
    if (folder) {
      await tx.update(plantTwinsTable)
        .set({ scene: withParent(row.parentId || null), updatedAt: sql`${plantTwinsTable.updatedAt}` })
        .where(sql`${plantTwinsTable.scene} ->> 'parent' = ${id}`);
    }
  });
  await logActivity("plant_twin.deleted", "visualization", id, row.name, null, req);
  res.status(204).end();
});

export default router;
