import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, vizNodesTable } from "@workspace/db";
import { z } from "zod";
import { logActivity } from "./activity_log";
import { validate } from "../middleware/validate";
import {
  CreateVizNodeBody, UpdateVizNodeBody, VizNodeParams, ImportVizNodesBody, ImportVizNode,
} from "../schemas/common";

/**
 * Visualization hierarchy + the dashboard held by each node.
 *
 * Replaces the browser-local `wsviz:*` localStorage keys. See the schema file
 * for why that had to move.
 *
 * Hand-written rather than generated, matching viz_dashboards: these shapes are
 * free-form JSON the canvas owns, and putting the widget array into the OpenAPI
 * contract would mean regenerating the client every time a widget gains a config
 * field.
 */

const router: IRouter = Router();

type NodeRow = typeof vizNodesTable.$inferSelect;

function toClient(row: NodeRow) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId ?? null,
    widgets: Array.isArray(row.widgets) ? row.widgets : [],
    updatedAt: row.updatedAt,
  };
}

// Id and name rules live in schemas/common.ts and are enforced by `validate`
// before a handler runs. The hand-rolled `validId`/`cleanName` helpers that used
// to sit here were removed rather than kept alongside: two copies of the same
// rule is how the two quietly stop agreeing, and the truncating version here
// would silently store a different name than the one the schema rejected.

// ── Read ─────────────────────────────────────────────────────────────────────
router.get("/viz-nodes", async (_req, res): Promise<void> => {
  const rows = await db.select().from(vizNodesTable).orderBy(vizNodesTable.name);
  res.json(rows.map(toClient));
});

// ── Create ───────────────────────────────────────────────────────────────────
router.post("/viz-nodes", validate({ body: CreateVizNodeBody }), async (req, res): Promise<void> => {
  const body = req.body as z.infer<typeof CreateVizNodeBody>;

  // The client generates the id so it can update its own tree optimistically
  // without waiting for a round trip; it is honoured when supplied.
  const id = body.id ?? `vn-${crypto.randomUUID()}`;
  const parentId = body.parentId ?? null;

  const [row] = await db.insert(vizNodesTable)
    .values({ id, name: body.name, parentId, widgets: body.widgets ?? [] })
    // Creating a node that already exists is not an error worth failing a UI
    // over — it means a retry or a double-submit. Keep what is there.
    .onConflictDoNothing()
    .returning();

  if (!row) {
    const [existing] = await db.select().from(vizNodesTable).where(eq(vizNodesTable.id, id));
    res.status(200).json(toClient(existing));
    return;
  }
  await logActivity("viz.node.created", "visualization", row.id, row.name, null, req);
  res.status(201).json(toClient(row));
});

// ── Update (rename, re-parent, or save the dashboard) ────────────────────────
router.put("/viz-nodes/:id", validate({ params: VizNodeParams, body: UpdateVizNodeBody }), async (req, res): Promise<void> => {
  const { id } = req.params as z.infer<typeof VizNodeParams>;
  const body = req.body as z.infer<typeof UpdateVizNodeBody>;
  const update: Partial<typeof vizNodesTable.$inferInsert> = {};

  if (body.name !== undefined) update.name = body.name;
  if ("parentId" in body) update.parentId = body.parentId ?? null;
  if (body.widgets !== undefined) update.widgets = body.widgets;

  if (Object.keys(update).length === 0) { res.status(400).json({ error: "nothing to update" }); return; }

  // A node cannot be its own parent. Deeper cycles are prevented in the UI,
  // which only offers ancestors that are not in the moved node's own subtree.
  if (update.parentId === id) { res.status(400).json({ error: "a node cannot be its own parent" }); return; }

  const [row] = await db.update(vizNodesTable).set(update).where(eq(vizNodesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Node not found" }); return; }

  // Only structural edits are logged. A dashboard save happens on every layout
  // tweak, and logging those would bury every other entry in the activity feed.
  if (update.name !== undefined || "parentId" in update) {
    await logActivity("viz.node.updated", "visualization", row.id, row.name, null, req);
  }
  res.json(toClient(row));
});

// ── Delete (node + its whole subtree) ────────────────────────────────────────
router.delete("/viz-nodes/:id", validate({ params: VizNodeParams }), async (req, res): Promise<void> => {
  const { id } = req.params as z.infer<typeof VizNodeParams>;
  const all = await db.select({ id: vizNodesTable.id, parentId: vizNodesTable.parentId, name: vizNodesTable.name }).from(vizNodesTable);

  const [target] = all.filter((n) => n.id === id);
  if (!target) { res.status(404).json({ error: "Node not found" }); return; }

  // Collect the subtree iteratively. `seen` doubles as the cycle guard: a
  // corrupted parent chain must not spin here.
  const doomed = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const n of all) {
      if (n.parentId === cur && !doomed.has(n.id)) { doomed.add(n.id); stack.push(n.id); }
    }
  }

  await db.delete(vizNodesTable).where(inArray(vizNodesTable.id, [...doomed]));
  await logActivity("viz.node.deleted", "visualization", id, target.name, `${doomed.size} node(s) in subtree`, req);
  res.json({ success: true, deleted: doomed.size });
});

// ── One-time import of a browser's localStorage dashboards ───────────────────
//
// Runs once per browser (the client keeps the "already migrated" flag). Existing
// ids are left untouched rather than overwritten, so two people migrating the
// same shared tree cannot clobber each other's newer edits with their own stale
// copy — first writer wins, and the second import is a no-op.
router.post("/viz-nodes/import", validate({ body: ImportVizNodesBody }), async (req, res): Promise<void> => {
  const { nodes: incoming } = req.body as z.infer<typeof ImportVizNodesBody>;
  if (incoming.length === 0) { res.json({ imported: 0, skipped: 0 }); return; }

  // Per-node validation. A node that fails is skipped and REPORTED rather than
  // failing the batch — see the note on ImportVizNodesBody for why an import is
  // the one place where all-or-nothing is the wrong answer.
  const existing = new Set((await db.select({ id: vizNodesTable.id }).from(vizNodesTable)).map((r) => r.id));

  const values: Array<{ id: string; name: string; parentId: string | null; widgets: unknown[] }> = [];
  const rejected: Array<{ index: number; reason: string }> = [];

  incoming.forEach((raw, index) => {
    const parsed = ImportVizNode.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ index, reason: parsed.error.issues[0]?.message ?? "invalid node" });
      return;
    }
    if (existing.has(parsed.data.id)) return;   // already on the server: first writer wins
    values.push({
      id: parsed.data.id,
      name: parsed.data.name,
      parentId: parsed.data.parentId ?? null,
      widgets: parsed.data.widgets ?? [],
    });
  });

  if (values.length > 0) {
    await db.insert(vizNodesTable).values(values).onConflictDoNothing();
    await logActivity("viz.imported", "visualization", null, "Visualization hierarchy", `${values.length} node(s) imported from browser storage`, req);
  }
  res.json({
    imported: values.length,
    skipped: incoming.length - values.length - rejected.length,
    // Surfaced rather than swallowed: if a dashboard did not come across, the
    // user needs to be able to find out which one and why.
    rejected: rejected.length,
    ...(rejected.length > 0 ? { rejectedDetail: rejected.slice(0, 20) } : {}),
  });
});

export default router;
