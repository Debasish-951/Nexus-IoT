import { Router, type IRouter, type Request } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db, apiClientsTable, assetsTable } from "@workspace/db";
import {
  CreateApiClientBody,
  UpdateApiClientBody,
  UpdateApiClientParams,
  DeleteApiClientParams,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";
import { logActivity } from "./activity_log";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router: IRouter = Router();

/**
 * Resolve the caller's project scope.
 *
 * A user restricted to specific projects (users.access_overrides.allowedProjects)
 * sees only the API clients belonging to those projects. Everyone else — an
 * unrestricted user, or a machine caller — sees them all.
 *
 * This is what makes a project-scoped credential a shared team resource: the
 * project head assigns people to the project once, and every one of them then
 * sees that project's client and its ingest endpoint, without anybody being
 * issued a personal key.
 */
function projectFilter(req: Request): { restricted: boolean; allowed: Set<string> } {
  const access = req.principal?.access;
  if (!access?.restrictProjects) return { restricted: false, allowed: new Set() };
  return { restricted: true, allowed: new Set(access.allowedProjects) };
}

/** Decorate a row with its project name and dedicated ingest path. */
function decorate(client: typeof apiClientsTable.$inferSelect, projectNames: Map<string, string>) {
  return {
    ...client,
    projectName: client.projectId ? projectNames.get(client.projectId) ?? null : null,
    ingestUrl: `/api/ingest/k/${client.clientId}/payload`,
  };
}

/** Root-level assets are the platform's "projects" (same rule the Users page uses). */
async function loadProjectNames(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: assetsTable.id, name: assetsTable.name })
    .from(assetsTable)
    .where(isNull(assetsTable.parentId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ── List ───────────────────────────────────────────────────────────────────────
router.get("/api-clients", async (req, res): Promise<void> => {
  const [clients, projectNames] = await Promise.all([
    db.select().from(apiClientsTable).orderBy(apiClientsTable.name),
    loadProjectNames(),
  ]);

  const { restricted, allowed } = projectFilter(req);
  const visible = restricted
    // A project-restricted user does not see unassigned/platform-wide clients:
    // those are administrative, and their secrets are not that team's business.
    ? clients.filter((c) => c.projectId && allowed.has(c.projectId))
    : clients;

  res.json(visible.map((c) => decorate(c, projectNames)));
});

/**
 * Projects available to assign a client to — used by the API Client form.
 * Mirrors the caller's own project scope, so a restricted user cannot attach a
 * credential to a project they have no access to.
 */
router.get("/api-clients/projects", async (req, res): Promise<void> => {
  const rows = await db
    .select({ id: assetsTable.id, name: assetsTable.name })
    .from(assetsTable)
    .where(isNull(assetsTable.parentId))
    .orderBy(assetsTable.name);

  const { restricted, allowed } = projectFilter(req);
  res.json(restricted ? rows.filter((r) => allowed.has(r.id)) : rows);
});

// ── Create ─────────────────────────────────────────────────────────────────────
router.post("/api-clients", async (req, res): Promise<void> => {
  const parsed = CreateApiClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Parse expiresAt and allowedIps from body manually (not in generated Zod yet)
  const body = req.body as Record<string, unknown>;
  const expiresAt   = body.expiresAt   ? new Date(body.expiresAt as string)   : null;
  const allowedIps  = Array.isArray(body.allowedIps) ? (body.allowedIps as string[]) : [];
  const description = typeof body.description === "string" ? body.description : null;

  const projectId = typeof body.projectId === "string" && UUID_RE.test(body.projectId)
    ? body.projectId
    : null;
  if (projectId) {
    const { restricted, allowed } = projectFilter(req);
    if (restricted && !allowed.has(projectId)) {
      res.status(403).json({
        error: "You do not have access to that project.",
        code: "project_forbidden",
      });
      return;
    }
    const [project] = await db
      .select({ id: assetsTable.id })
      .from(assetsTable)
      .where(and(eq(assetsTable.id, projectId), isNull(assetsTable.parentId)));
    if (!project) {
      res.status(400).json({
        error: "That project does not exist, or is not a root-level asset.",
        code: "invalid_project",
      });
      return;
    }
  }

  const [client] = await db
    .insert(apiClientsTable)
    .values({
      name:        parsed.data.name,
      description,
      clientId:    randomUUID(),
      clientSecret: randomUUID(),
      tags:        parsed.data.tags  ?? [],
      scopes:      parsed.data.scopes ?? [],
      // Owning project. Validated below so a client cannot be attached to a
      // project the caller has no access to.
      projectId,
      allowedIps,
      ...(expiresAt ? { expiresAt } : {}),
      status:      "active",
    })
    .returning();

  void logActivity("api_client.created", "api_client", client.id, client.name, null, req);
  res.status(201).json(client);
});

// ── Update ─────────────────────────────────────────────────────────────────────
router.put("/api-clients/:id", async (req, res): Promise<void> => {
  const params = UpdateApiClientParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateApiClientBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const body = req.body as Record<string, unknown>;
  const updateData: Record<string, unknown> = {};

  if (parsed.data.name    !== undefined) updateData.name    = parsed.data.name;
  if (parsed.data.tags    !== undefined) updateData.tags    = parsed.data.tags;
  if (parsed.data.scopes  !== undefined) updateData.scopes  = parsed.data.scopes;
  if (parsed.data.status  !== undefined) updateData.status  = parsed.data.status;

  // Extra fields not yet in generated Zod
  if (typeof body.description === "string") updateData.description = body.description;
  if (Array.isArray(body.allowedIps))       updateData.allowedIps  = body.allowedIps;
  if (body.expiresAt !== undefined) {
    updateData.expiresAt = body.expiresAt ? new Date(body.expiresAt as string) : null;
  }

  // Reassigning the owning project changes who can see the credential, so it
  // gets the same validation as create: real root-level asset, and within the
  // caller's own project scope. `null` detaches it back to platform-wide.
  if (body.projectId !== undefined) {
    const next = typeof body.projectId === "string" && UUID_RE.test(body.projectId)
      ? body.projectId
      : null;
    if (next) {
      const { restricted, allowed } = projectFilter(req);
      if (restricted && !allowed.has(next)) {
        res.status(403).json({ error: "You do not have access to that project.", code: "project_forbidden" });
        return;
      }
      const [project] = await db
        .select({ id: assetsTable.id })
        .from(assetsTable)
        .where(and(eq(assetsTable.id, next), isNull(assetsTable.parentId)));
      if (!project) {
        res.status(400).json({ error: "That project does not exist, or is not a root-level asset.", code: "invalid_project" });
        return;
      }
    }
    updateData.projectId = next;
  }

  const [client] = await db
    .update(apiClientsTable)
    .set(updateData)
    .where(eq(apiClientsTable.id, params.data.id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }
  res.json(client);
});

// ── Rotate secret ──────────────────────────────────────────────────────────────
router.post("/api-clients/:id/rotate-secret", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const newSecret = randomUUID();

  const [client] = await db
    .update(apiClientsTable)
    .set({ clientSecret: newSecret, secretRotatedAt: new Date() })
    .where(eq(apiClientsTable.id, id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }

  void logActivity("api_client.secret_rotated", "api_client", client.id, client.name, null, req);
  // Return the new secret plaintext ONCE — caller must store it
  res.json({ ...client, clientSecret: newSecret });
});

// ── Revoke ─────────────────────────────────────────────────────────────────────
router.post("/api-clients/:id/revoke", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [client] = await db
    .update(apiClientsTable)
    .set({ status: "revoked" })
    .where(eq(apiClientsTable.id, id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }
  void logActivity("api_client.revoked", "api_client", client.id, client.name, null, req);
  res.json(client);
});

// ── Restore (un-revoke) ────────────────────────────────────────────────────────
router.post("/api-clients/:id/restore", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [client] = await db
    .update(apiClientsTable)
    .set({ status: "active" })
    .where(eq(apiClientsTable.id, id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }
  void logActivity("api_client.restored", "api_client", client.id, client.name, null, req);
  res.json(client);
});

// ── Delete ─────────────────────────────────────────────────────────────────────
router.delete("/api-clients/:id", async (req, res): Promise<void> => {
  const params = DeleteApiClientParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [client] = await db
    .delete(apiClientsTable)
    .where(eq(apiClientsTable.id, params.data.id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }
  void logActivity("api_client.deleted", "api_client", client.id, client.name, null, req);
  res.sendStatus(204);
});

export default router;
