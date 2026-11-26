import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, assetsTable, usersTable, vizNodesTable, vizNodeSharesTable } from "@workspace/db";
import { z } from "zod";
import { logActivity } from "./activity_log";
import { diffFields } from "../lib/audit-core";
import { markAudited } from "../lib/audit-context";
import { validate } from "../middleware/validate";
import { recordSecurityEvent } from "../lib/security-log";
import { hasModuleAccess } from "../lib/rbac";
import { isSuperAdmin, loadVizAccess, ownsInChain, NO_ACCESS, type VizNodeAccess } from "../lib/viz-access";
import { assetScope } from "../lib/project-access";
import { tagsForViewer } from "../lib/viz-tags";
import { wouldCreateCycle } from "../lib/twin-rules";
import {
  CreateVizNodeBody, UpdateVizNodeBody, VizNodeParams, ImportVizNodesBody, ImportVizNode,
  VizNodeShareParams, PutVizNodeShareBody,
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

/**
 * A parent this user cannot see is reported as null. The tree only renders nodes
 * it can reach from the top level, so a dashboard shared out of the middle of
 * someone's tree would otherwise disappear.
 */
function toClient(row: NodeRow, access: VizNodeAccess, parentVisible: boolean, projectId: string | null = row.projectId ?? null) {
  return {
    id: row.id,
    name: row.name,
    parentId: parentVisible ? row.parentId ?? null : null,
    projectId,
    widgets: Array.isArray(row.widgets) ? row.widgets : [],
    updatedAt: row.updatedAt,
    access,
  };
}

/** Recorded because this replaces the check `authorize` would otherwise have logged. */
function deny(req: Request, res: Response, reason: string, message: string): void {
  recordSecurityEvent({
    type: "authz.denied", outcome: "failure", reason,
    userId: req.principal?.user.id ?? null, username: req.principal?.user.username ?? null,
    detail: { method: req.method, path: req.path }, req,
  });
  res.status(403).json({ error: message, code: "dashboard_access_denied" });
}

/** A node may name only a real project that this user is allowed to open. */
async function canUseProject(req: Request, projectId: string): Promise<boolean> {
  const [project] = await db.select({ parentId: assetsTable.parentId }).from(assetsTable).where(eq(assetsTable.id, projectId));
  if (!project || project.parentId) return false;
  const scope = await assetScope(req);
  return !scope || scope.roots.has(projectId);
}

// Id and name rules live in schemas/common.ts and are enforced by `validate`
// before a handler runs. The hand-rolled `validId`/`cleanName` helpers that used
// to sit here were removed rather than kept alongside: two copies of the same
// rule is how the two quietly stop agreeing, and the truncating version here
// would silently store a different name than the one the schema rejected.

// ── Read ─────────────────────────────────────────────────────────────────────
router.get("/viz-nodes", async (req, res): Promise<void> => {
  const [rows, access] = await Promise.all([
    db.select().from(vizNodesTable).orderBy(vizNodesTable.name),
    loadVizAccess(req.principal!),
  ]);
  const canRead = (id: string | null) => !!id && !!access.get(id)?.read;
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Nested nodes follow their top-level node. `seen` guards against a cycle,
  // since parentId carries no foreign key.
  const projectOf = (row: NodeRow): string | null => {
    let cur = row;
    const seen = new Set([cur.id]);
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
      cur = byId.get(cur.parentId)!;
      seen.add(cur.id);
    }
    return cur.projectId ?? null;
  };
  res.json(rows
    .filter((r) => canRead(r.id))
    .map((r) => toClient(r, access.get(r.id)!, canRead(r.parentId), projectOf(r))));
});

// ── Tags the Combined Value widget can add together ──────────────────────────
router.get("/viz-tags", async (req, res): Promise<void> => {
  res.json(await tagsForViewer(await assetScope(req)));
});

// ── Create ───────────────────────────────────────────────────────────────────
router.post("/viz-nodes", validate({ body: CreateVizNodeBody }), async (req, res): Promise<void> => {
  const body = req.body as z.infer<typeof CreateVizNodeBody>;

  // The client generates the id so it can update its own tree optimistically
  // without waiting for a round trip; it is honoured when supplied.
  const id = body.id ?? `vn-${crypto.randomUUID()}`;
  const parentId = body.parentId ?? null;

  const access = await loadVizAccess(req.principal!);
  const allowed = parentId
    ? !!access.get(parentId)?.write
    : isSuperAdmin(req.principal) || hasModuleAccess(req.principal!.access, "visualization", "write");
  if (!allowed) {
    deny(req, res, "viz_create_denied", "You do not have permission to create a dashboard here.");
    return;
  }
  const projectId = parentId ? null : body.projectId ?? null;
  if (projectId && !(await canUseProject(req, projectId))) {
    deny(req, res, "viz_project_denied", "You cannot add a dashboard to that project.");
    return;
  }

  const [row] = await db.insert(vizNodesTable)
    .values({ id, name: body.name, parentId, projectId, widgets: body.widgets ?? [], ownerId: req.principal!.user.id })
    // Creating a node that already exists is not an error worth failing a UI
    // over — it means a retry or a double-submit. Keep what is there.
    .onConflictDoNothing()
    .returning();

  if (!row) {
    // Ids are client-supplied, so this must not hand back a dashboard the caller
    // cannot read just because they guessed its id.
    const existingAccess = access.get(id);
    if (!existingAccess?.read) {
      res.status(409).json({ error: "That id is already in use.", code: "id_conflict" });
      return;
    }
    const [existing] = await db.select().from(vizNodesTable).where(eq(vizNodesTable.id, id));
    res.status(200).json(toClient(existing, existingAccess, !!existing.parentId && !!access.get(existing.parentId)?.read));
    return;
  }
  await logActivity("viz.node.created", "visualization", row.id, row.name, null, req);
  res.status(201).json(toClient(row, { read: true, write: true, delete: true, owner: true }, !!parentId && !!access.get(parentId)?.read));
});

// ── Update (rename, re-parent, or save the dashboard) ────────────────────────
//
// Optimistic concurrency: a client may send the `updatedAt` it last read as
// `expectedUpdatedAt`. If the row has changed since, the write is refused with
// 409 instead of silently replacing a colleague's newer dashboard with a stale
// copy. Optional, so a client that does not send it keeps last-write-wins.
const UpdateVizNodeBodyWithVersion = UpdateVizNodeBody.extend({
  expectedUpdatedAt: z.string().max(64).refine((s) => !Number.isNaN(Date.parse(s)), "must be a timestamp").optional(),
});

router.put("/viz-nodes/:id", validate({ params: VizNodeParams, body: UpdateVizNodeBodyWithVersion }), async (req, res): Promise<void> => {
  const { id } = req.params as z.infer<typeof VizNodeParams>;
  const { expectedUpdatedAt, ...body } = req.body as z.infer<typeof UpdateVizNodeBodyWithVersion>;
  const update: Partial<typeof vizNodesTable.$inferInsert> = {};

  if (body.name !== undefined) update.name = body.name;
  if ("parentId" in body) update.parentId = body.parentId ?? null;
  if (body.widgets !== undefined) update.widgets = body.widgets;
  if (body.projectId !== undefined) update.projectId = body.projectId;

  if (Object.keys(update).length === 0) { res.status(400).json({ error: "nothing to update" }); return; }

  // A node cannot be its own parent. Deeper cycles are prevented in the UI,
  // which only offers ancestors that are not in the moved node's own subtree.
  if (update.parentId === id) { res.status(400).json({ error: "a node cannot be its own parent" }); return; }

  const access = await loadVizAccess(req.principal!);
  const current = access.get(id) ?? NO_ACCESS;
  // The same answer as a missing node: no way to discover what others have built.
  if (!current.read) { res.status(404).json({ error: "Node not found" }); return; }
  if (!current.write) {
    deny(req, res, "viz_write_denied", "You have read-only access to this dashboard.");
    return;
  }
  if (update.parentId && !access.get(update.parentId)?.write) {
    deny(req, res, "viz_move_denied", "You do not have permission to move a dashboard there.");
    return;
  }
  // Moving needs ownership, not just a grant (L-2): see ownsInChain.
  if ("parentId" in update && !isSuperAdmin(req.principal)) {
    const nodes = await db.select({ id: vizNodesTable.id, parentId: vizNodesTable.parentId, ownerId: vizNodesTable.ownerId }).from(vizNodesTable);
    const before = nodes.find((n) => n.id === id);
    if (before && (before.parentId ?? null) !== (update.parentId ?? null) && !ownsInChain(nodes, id, req.principal!.user.id)) {
      deny(req, res, "viz_move_not_owner", "Only the owner of this dashboard can move it.");
      return;
    }
  }
  if (update.projectId !== undefined) {
    const [node] = await db.select({ parentId: vizNodesTable.parentId }).from(vizNodesTable).where(eq(vizNodesTable.id, id));
    if (node?.parentId) { res.status(400).json({ error: "Only a top-level dashboard can be assigned to a project." }); return; }
    if (update.projectId && !(await canUseProject(req, update.projectId))) {
      deny(req, res, "viz_project_denied", "You cannot assign a dashboard to that project.");
      return;
    }
  }

  // Moving a node under one of its own descendants would cut that subtree off
  // in a loop that no tree view can reach (audit L-23).
  if (update.parentId) {
    const tree = await db.select({ id: vizNodesTable.id, parentId: vizNodesTable.parentId }).from(vizNodesTable);
    const parents = new Map(tree.map((n) => [n.id, n.parentId]));
    if (wouldCreateCycle((x) => parents.get(x), id, update.parentId)) {
      res.status(400).json({ error: "A dashboard cannot be moved into one of its own sub-dashboards.", code: "viz_node_cycle" });
      return;
    }
  }

  const [beforeNode] = await db.select({ name: vizNodesTable.name, parentId: vizNodesTable.parentId, projectId: vizNodesTable.projectId })
    .from(vizNodesTable).where(eq(vizNodesTable.id, id));
  let row: NodeRow | undefined;
  if (expectedUpdatedAt === undefined) {
    [row] = await db.update(vizNodesTable).set(update).where(eq(vizNodesTable.id, id)).returning();
  } else {
    // The row is locked between the check and the write, so two saves racing
    // each other cannot both pass the check. Compared as JS dates on both sides:
    // the client's value is the server's own earlier serialisation of this column.
    const expected = new Date(expectedUpdatedAt).getTime();
    const outcome = await db.transaction(async (tx) => {
      const [cur] = await tx.select({ updatedAt: vizNodesTable.updatedAt }).from(vizNodesTable)
        .where(eq(vizNodesTable.id, id)).for("update");
      if (!cur) return { conflict: false as const, row: undefined };
      if (cur.updatedAt.getTime() !== expected) return { conflict: true as const, updatedAt: cur.updatedAt };
      const [updated] = await tx.update(vizNodesTable).set(update).where(eq(vizNodesTable.id, id)).returning();
      return { conflict: false as const, row: updated };
    });
    if (outcome.conflict) {
      res.status(409).json({
        error: "This dashboard was changed somewhere else after you opened it.",
        code: "viz_node_conflict",
        updatedAt: outcome.updatedAt,
      });
      return;
    }
    row = outcome.row;
  }
  if (!row) { res.status(404).json({ error: "Node not found" }); return; }

  // Only structural edits are logged. A dashboard save happens on every layout
  // tweak, and logging those would bury every other entry in the activity feed.
  if (update.name !== undefined || "parentId" in update || "projectId" in update) {
    await logActivity("viz.node.updated", "visualization", row.id, row.name, null, req, {
      changes: diffFields(beforeNode as unknown as Record<string, unknown>, row as unknown as Record<string, unknown>, { only: ["name", "parentId", "projectId"].filter((k) => k in update) }),
    });
  } else {
    // A layout save: deliberately not recorded (see above), nor by the safety net.
    markAudited();
  }
  res.json(toClient(row, current, !!row.parentId && !!access.get(row.parentId)?.read));
});

// ── Delete (node + its whole subtree) ────────────────────────────────────────
router.delete("/viz-nodes/:id", validate({ params: VizNodeParams }), async (req, res): Promise<void> => {
  const { id } = req.params as z.infer<typeof VizNodeParams>;
  const all = await db.select({ id: vizNodesTable.id, parentId: vizNodesTable.parentId, name: vizNodesTable.name }).from(vizNodesTable);

  const [target] = all.filter((n) => n.id === id);
  const access = (await loadVizAccess(req.principal!)).get(id) ?? NO_ACCESS;
  if (!target || !access.read) { res.status(404).json({ error: "Node not found" }); return; }
  // Access is inherited, so permission on this node covers its whole subtree.
  if (!access.delete) {
    deny(req, res, "viz_delete_denied", "You do not have permission to delete this dashboard.");
    return;
  }

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
  const access = await loadVizAccess(req.principal!);

  const values: Array<{ id: string; name: string; parentId: string | null; widgets: unknown[]; ownerId: string }> = [];
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
      // An imported node must not attach itself to a tree this user cannot edit.
      // A parent that does not exist yet is kept: browsers upload nodes one at a time.
      parentId: parsed.data.parentId && (!existing.has(parsed.data.parentId) || access.get(parsed.data.parentId)?.write)
        ? parsed.data.parentId
        : null,
      widgets: parsed.data.widgets ?? [],
      ownerId: req.principal!.user.id,
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

// ── Sharing (Super Admin or Company Admin only) ───────────────────────────────────────────────
function refuseUnlessSuperAdmin(req: Request, res: Response): boolean {
  if (isSuperAdmin(req.principal)) return false;
  deny(req, res, "viz_share_not_super_admin", "Only a Super Admin or Company Admin can manage dashboard access.");
  return true;
}

router.get("/viz-nodes/:id/shares", validate({ params: VizNodeParams }), async (req, res): Promise<void> => {
  if (refuseUnlessSuperAdmin(req, res)) return;
  const { id } = req.params as z.infer<typeof VizNodeParams>;
  const [node] = await db
    .select({ ownerId: vizNodesTable.ownerId, ownerName: usersTable.fullName })
    .from(vizNodesTable)
    .leftJoin(usersTable, eq(usersTable.id, vizNodesTable.ownerId))
    .where(eq(vizNodesTable.id, id));
  if (!node) { res.status(404).json({ error: "Node not found" }); return; }

  const shares = await db.select().from(vizNodeSharesTable).where(eq(vizNodeSharesTable.nodeId, id));
  res.json({
    ownerId: node.ownerId,
    ownerName: node.ownerName,
    shares: shares.map((s) => ({ userId: s.userId, read: s.canRead, write: s.canWrite, delete: s.canDelete })),
  });
});

router.put(
  "/viz-nodes/:id/shares/:userId",
  validate({ params: VizNodeShareParams, body: PutVizNodeShareBody }),
  async (req, res): Promise<void> => {
    if (refuseUnlessSuperAdmin(req, res)) return;
    const { id, userId } = req.params as z.infer<typeof VizNodeShareParams>;
    const body = req.body as z.infer<typeof PutVizNodeShareBody>;

    const [node] = await db.select({ name: vizNodesTable.name }).from(vizNodesTable).where(eq(vizNodesTable.id, id));
    if (!node) { res.status(404).json({ error: "Node not found" }); return; }
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId));
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Writing or deleting something you cannot see makes no sense, so both imply read.
    const grant = {
      canRead: body.read || body.write || body.delete,
      canWrite: body.write,
      canDelete: body.delete,
      grantedBy: req.principal!.user.id,
    };
    if (!grant.canRead) {
      await db.delete(vizNodeSharesTable).where(and(eq(vizNodeSharesTable.nodeId, id), eq(vizNodeSharesTable.userId, userId)));
    } else {
      await db.insert(vizNodeSharesTable)
        .values({ nodeId: id, userId, ...grant })
        .onConflictDoUpdate({ target: [vizNodeSharesTable.nodeId, vizNodeSharesTable.userId], set: grant });
    }
    await logActivity("viz.node.shared", "visualization", id, node.name,
      `user=${userId} read=${grant.canRead} write=${grant.canWrite} delete=${grant.canDelete}`, req);
    res.json({ userId, read: grant.canRead, write: grant.canWrite, delete: grant.canDelete });
  },
);

router.delete("/viz-nodes/:id/shares/:userId", validate({ params: VizNodeShareParams }), async (req, res): Promise<void> => {
  if (refuseUnlessSuperAdmin(req, res)) return;
  const { id, userId } = req.params as z.infer<typeof VizNodeShareParams>;
  await db.delete(vizNodeSharesTable).where(and(eq(vizNodeSharesTable.nodeId, id), eq(vizNodeSharesTable.userId, userId)));
  await logActivity("viz.node.unshared", "visualization", id, null, `user=${userId}`, req);
  res.json({ success: true });
});

export default router;
