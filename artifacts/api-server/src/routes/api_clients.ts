import { Router, type IRouter, type Request, type Response } from "express";
import { respondInvalid } from "../lib/respond";
import { eq, and, isNull } from "drizzle-orm";
import { db, apiClientsTable, assetsTable } from "@workspace/db";
import {
  CreateApiClientBody,
  UpdateApiClientBody,
  UpdateApiClientParams,
  DeleteApiClientParams,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";
import { hashToken } from "../lib/tokens";
import { logActivity } from "./activity_log";
import { diffFields } from "../lib/audit-core";
import { recordSecurityEvent, type SecurityEventType } from "../lib/security-log";
import { normaliseAllowlist } from "../middleware/apiKeyAuth";
import { ungrantableScopes, canCreateApiClients } from "../lib/rbac";
import {
  issueIngestToken, revealIngestToken, assertUrlTokenAllowed, INGEST_SCOPE,
} from "../lib/ingest-token";

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

/** Refuse a restricted user's attempt to create or detach a key to platform-wide. */
function refuseUnassigned(req: Request, res: Response, apiClientId: string | null): void {
  recordSecurityEvent({
    type: "authz.denied",
    outcome: "failure",
    reason: "api_client_unassigned_forbidden",
    userId: req.principal?.user.id ?? null,
    username: req.principal?.user.username ?? null,
    detail: { apiClientId },
    req,
  });
  res.status(403).json({
    error: "Choose one of your projects. Only an unrestricted administrator can create a key for every project.",
    code: "project_required",
  });
}

/**
 * Object-level check for a single API client.
 *
 * `manage_api_clients` decides whether the caller may use this console. It says
 * nothing about WHICH client, and that gap was real: the list, create and update
 * routes all applied `projectFilter`, while rotate-secret, revoke, restore and
 * delete did not. A user restricted to one project could not SEE another
 * project's credential, but could act on it by id.
 *
 * Rotate was the worst of the four, because it returns the new secret in the
 * response — so a restricted user could mint themselves a working credential for
 * a project they have no access to, and simultaneously break that project's
 * ingest by invalidating the old one.
 *
 * Returns true when the request has been answered and the caller must stop. A
 * client the caller may not touch returns 404, not 403: a distinct 403 confirms
 * the id exists, which is exactly what someone probing for ids wants.
 */
async function refuseIfOutOfScope(req: Request, res: Response, id: string): Promise<boolean> {
  const { restricted, allowed } = projectFilter(req);
  if (!restricted) return false;

  const [client] = await db
    .select({ projectId: apiClientsTable.projectId })
    .from(apiClientsTable)
    .where(eq(apiClientsTable.id, id));

  // Unassigned (platform-wide) clients are out of scope for a restricted user
  // too — the same rule the list route applies.
  if (client && client.projectId && allowed.has(client.projectId)) return false;

  recordSecurityEvent({
    type: "authz.denied",
    outcome: "failure",
    reason: "out_of_project_scope",
    userId: req.principal?.user.id ?? null,
    username: req.principal?.user.username ?? null,
    detail: { apiClientId: id, clientProjectId: client?.projectId ?? null },
    req,
  });
  res.status(404).json({ error: "API client not found", code: "not_found" });
  return true;
}

/**
 * Strip stored credentials from anything sent to a client.
 *
 * The hash is not directly usable as a credential, but publishing it would let
 * anyone holding a candidate secret confirm it offline — and there is no reason
 * for the browser to have it at all.
 *
 * `clientSecret` is always sent as null. It is non-null only on legacy rows the
 * hash-api-secrets script has not converted yet, and for those it is a working
 * key in plaintext: returning it put every legacy credential in every list
 * response, browser cache and proxy log that saw one. The UI then shows the
 * secret as unavailable, as it does for every hashed client; anyone who has lost
 * it rotates. The only plaintext secret ever sent is the new one in the create
 * and rotate responses, added after this function runs.
 */
function redactSecret<T extends { clientSecret?: string | null; clientSecretHash?: string | null; ingestTokenHash?: string | null; ingestTokenEnc?: string | null; previousSecretHash?: string | null }>(
  row: T,
): Omit<T, "clientSecret" | "clientSecretHash" | "ingestTokenHash" | "ingestTokenEnc" | "previousSecretHash"> & { clientSecret: null } {
  // The ingest URL token's hash and ciphertext are stripped too. Only decorate()
  // used to remove them, so create, update, rotate, revoke and restore responses
  // sent both to the browser.
  // previousSecretHash (rotation grace period, Integration Hub) is stripped for the same reason as the current hash.
  const { clientSecret: _p, clientSecretHash: _s, ingestTokenHash: _h, ingestTokenEnc: _e, previousSecretHash: _ps, ...rest } = row;
  return { ...rest, clientSecret: null };
}

/**
 * A change to a machine credential, recorded in the Security Center as well as
 * the Activity Log. Who minted, widened, re-pointed or revoked a key is the
 * first question after a key is abused, and the Activity Log is the wrong place
 * to have to answer it from.
 */
function auditClient(
  req: Request,
  type: SecurityEventType,
  client: { id: string; clientId: string; name: string },
  detail: Record<string, unknown> = {},
): void {
  recordSecurityEvent({
    type,
    outcome: "success",
    userId: req.principal?.user.id ?? null,
    username: req.principal?.user.username ?? null,
    detail: { apiClientId: client.id, clientId: client.clientId, name: client.name, ...detail },
    req,
  });
}

/** 400 for an allowlist with entries that are not an address or CIDR block. */
function refuseInvalidAllowlist(res: Response, invalid: string[]): void {
  res.status(400).json({
    error: `These IP allowlist entries are not valid: ${invalid.join(", ")}. Use an address (203.0.113.7) or a CIDR block (203.0.113.0/24).`,
    code: "invalid_allowed_ips",
    invalid,
  });
}

/**
 * Decorate a row with its project name and its ingest paths.
 *
 * `ingestUrlToken` is the decrypted copy-and-paste credential, and it is
 * included in this list response deliberately. The alternative — a separate
 * reveal endpoint logged on each call — would be audited on every render of a
 * page whose whole purpose is to show the URL, producing noise rather than
 * safety. The people who can read this list are exactly the people who can
 * create, rotate and delete the endpoint; there is nothing to withhold from
 * them. Issuing and rotating the token ARE audited, which is where the
 * security-relevant events actually are.
 *
 * Null when no token exists (a broadly-scoped client) or when the key ring
 * cannot decrypt it (rotated away) — the UI then offers to regenerate.
 */
function decorate(client: typeof apiClientsTable.$inferSelect, projectNames: Map<string, string>) {
  const { ingestTokenHash: _h, ingestTokenEnc: _e, ...visible } = client;
  return {
    ...redactSecret(visible as typeof client),
    projectName: client.projectId ? projectNames.get(client.projectId) ?? null : null,
    // Legacy per-client path. Still valid, still header-authenticated.
    ingestUrl: `/api/ingest/k/${client.clientId}/payload`,
    ingestUrlToken: revealIngestToken(client),
    ingestUrlEligible: assertUrlTokenAllowed(client),
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
    respondInvalid(req, res, parsed.error);
    return;
  }

  // Parse expiresAt and allowedIps from body manually (not in generated Zod yet)
  const body = req.body as Record<string, unknown>;
  const expiresAt   = body.expiresAt   ? new Date(body.expiresAt as string)   : null;
  const description = typeof body.description === "string" ? body.description : null;
  // Validated on save: an entry that is empty or not an address used to be
  // stored as-is, and the old prefix match read "" as "allow every address".
  const allowlist = normaliseAllowlist(body.allowedIps);
  if (!allowlist.ok) { refuseInvalidAllowlist(res, allowlist.invalid); return; }
  const allowedIps = allowlist.entries;

  // ── Scope ceiling ──────────────────────────────────────────────────────────
  //
  // Enforced HERE, not only in the dialog. Hiding the read-scope checkboxes stops
  // accidents; this stops a hand-rolled POST. `req.principal.access` is already
  // resolved from role + per-user overrides by attachPrincipal, so the check is
  // just a comparison.
  //
  // A machine caller (no principal) is unaffected — those routes are gated by
  // apiKeyAuth scopes instead.
  const access = req.principal?.access;
  const requestedScopes = parsed.data.scopes ?? [];
  if (access) {
    if (!canCreateApiClients(access)) {
      res.status(403).json({
        error: "Your account is not permitted to create API credentials.",
        code: "api_client_creation_forbidden",
      });
      return;
    }
    // An empty scopes array means "all scopes" to apiKeyAuth, so it is an
    // escalation dressed as an omission — never accept it from a user.
    if (requestedScopes.length === 0) {
      res.status(400).json({
        error: "At least one scope is required. A credential with no scopes would have full access.",
        code: "scopes_required",
      });
      return;
    }
    const denied = ungrantableScopes(access, requestedScopes);
    if (denied.length > 0) {
      res.status(403).json({
        error: `You are not permitted to grant: ${denied.join(", ")}.`,
        code: "scope_forbidden",
        deniedScopes: denied,
        grantableScopes: access.apiScopes,
      });
      return;
    }
  }

  const projectId = typeof body.projectId === "string" && UUID_RE.test(body.projectId)
    ? body.projectId
    : null;
  // A project-restricted user may not mint a platform-wide key. An unassigned key
  // reads and writes every project, so creating one would hand this user (or the
  // customer the key goes to) the access their own account is denied.
  if (!projectId && projectFilter(req).restricted) {
    refuseUnassigned(req, res, null);
    return;
  }
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

  // Generated here, hashed before storage, and returned exactly once in the
  // response below — it cannot be read back afterwards, by this API or by
  // anyone with database access.
  const rawSecret = randomUUID();

  // A client scoped to ingest and nothing else also gets a copy-and-paste URL
  // token. Anything broader does not: `assertUrlTokenAllowed` would refuse it at
  // authentication time anyway, and issuing a token that can never work is worse
  // than issuing none. See lib/ingest-token.ts.
  const scopes = parsed.data.scopes ?? [];
  const issued = assertUrlTokenAllowed({ scopes }) ? issueIngestToken() : null;

  const [client] = await db
    .insert(apiClientsTable)
    .values({
      name:        parsed.data.name,
      description,
      clientId:    randomUUID(),
      clientSecret: null,
      clientSecretHash: hashToken(rawSecret),
      ...(issued ? {
        ingestTokenHash: issued.hash,
        ingestTokenEnc: issued.encrypted,
        ingestTokenIssuedAt: new Date(),
      } : {}),
      tags:        parsed.data.tags  ?? [],
      scopes,
      // Owning project. Validated below so a client cannot be attached to a
      // project the caller has no access to.
      projectId,
      allowedIps,
      ...(expiresAt ? { expiresAt } : {}),
      status:      "active",
    })
    .returning();

  void logActivity("api_client.created", "api_client", client.id, client.name, null, req);
  auditClient(req, "api_client.created", client, { scopes: client.scopes, projectId: client.projectId, allowedIps: client.allowedIps });
  // The ONLY time the plaintext secret is ever sent. The stored row carries just
  // its hash, so a caller that does not copy it now must rotate to get another.
  res.status(201).json({ ...redactSecret(client), clientSecret: rawSecret });
});

// ── Update ─────────────────────────────────────────────────────────────────────
router.put("/api-clients/:id", async (req, res): Promise<void> => {
  const params = UpdateApiClientParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }

  const parsed = UpdateApiClientBody.safeParse(req.body);
  if (!parsed.success) { respondInvalid(req, res, parsed.error); return; }

  // Same object-level check as rotate, revoke and delete: a project-restricted
  // user may only edit credentials that belong to one of their projects.
  if (await refuseIfOutOfScope(req, res, params.data.id)) return;

  // Same scope ceiling as create. Without it, a user allowed to grant only
  // `ingest:write` could edit their own key to `["*"]`, or to `[]`, which
  // apiKeyAuth reads as "all scopes".
  const access = req.principal?.access;
  if (access && parsed.data.scopes !== undefined) {
    if (parsed.data.scopes.length === 0) {
      res.status(400).json({
        error: "At least one scope is required. A credential with no scopes would have full access.",
        code: "scopes_required",
      });
      return;
    }
    const [current] = await db
      .select({ scopes: apiClientsTable.scopes })
      .from(apiClientsTable)
      .where(eq(apiClientsTable.id, params.data.id));
    // Only scopes being ADDED are checked, so an engineer can still rename or
    // narrow a key an administrator created with wider scopes.
    const added = parsed.data.scopes.filter((s) => !(current?.scopes ?? []).includes(s));
    const denied = ungrantableScopes(access, added);
    if (denied.length > 0) {
      recordSecurityEvent({
        type: "authz.denied",
        outcome: "failure",
        userId: req.principal!.user.id,
        username: req.principal!.user.username,
        reason: "api_client_scope_forbidden",
        detail: { apiClientId: params.data.id, deniedScopes: denied },
        req,
      });
      res.status(403).json({
        error: `You are not permitted to grant: ${denied.join(", ")}.`,
        code: "scope_forbidden",
        deniedScopes: denied,
        grantableScopes: access.apiScopes,
      });
      return;
    }
  }

  const body = req.body as Record<string, unknown>;
  const updateData: Record<string, unknown> = {};

  if (parsed.data.name    !== undefined) updateData.name    = parsed.data.name;
  if (parsed.data.tags    !== undefined) updateData.tags    = parsed.data.tags;
  if (parsed.data.scopes  !== undefined) updateData.scopes  = parsed.data.scopes;
  if (parsed.data.status  !== undefined) updateData.status  = parsed.data.status;

  // Extra fields not yet in generated Zod
  if (typeof body.description === "string") updateData.description = body.description;
  if (Array.isArray(body.allowedIps)) {
    const allowlist = normaliseAllowlist(body.allowedIps);
    if (!allowlist.ok) { refuseInvalidAllowlist(res, allowlist.invalid); return; }
    updateData.allowedIps = allowlist.entries;
  }
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
    // Same rule as create: detaching to platform-wide is an escalation.
    if (!next && projectFilter(req).restricted) {
      refuseUnassigned(req, res, params.data.id);
      return;
    }
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

  const [beforeClient] = await db.select().from(apiClientsTable).where(eq(apiClientsTable.id, params.data.id));
  const [client] = await db
    .update(apiClientsTable)
    .set(updateData)
    .where(eq(apiClientsTable.id, params.data.id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }

  // Only the fields that change what the key can do are security events; a
  // rename or new tag is in the Activity Log below and nowhere else.
  const sensitive = ["scopes", "projectId", "status", "allowedIps", "expiresAt"].filter((k) => k in updateData);
  if (sensitive.length > 0) {
    auditClient(req, "api_client.updated", client, {
      changed: sensitive,
      scopes: client.scopes, projectId: client.projectId, status: client.status, allowedIps: client.allowedIps,
    });
  }
  void logActivity("api_client.updated", "api_client", client.id, client.name,
    `fields=${Object.keys(updateData).join(",")}`, req,
    { changes: diffFields(beforeClient as unknown as Record<string, unknown>, client as unknown as Record<string, unknown>, { only: Object.keys(updateData) }) });
  res.json(redactSecret(client));
});

// ── Rotate secret ──────────────────────────────────────────────────────────────
router.post("/api-clients/:id/rotate-secret", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await refuseIfOutOfScope(req, res, id)) return;

  const newSecret = randomUUID();

  const [client] = await db
    .update(apiClientsTable)
    // The legacy plaintext column is cleared as well, so rotating a
    // pre-hashing credential also retires its stored plaintext.
    // A grace period left by an Integration Hub rotation ends here too: this
    // route has always been an immediate cut-over.
    .set({ clientSecret: null, clientSecretHash: hashToken(newSecret), secretRotatedAt: new Date(), previousSecretHash: null, previousSecretExpiresAt: null })
    .where(eq(apiClientsTable.id, id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }

  void logActivity("api_client.secret_rotated", "api_client", client.id, client.name, null, req);
  auditClient(req, "api_client.secret_rotated", client);
  // Return the new secret plaintext ONCE — caller must store it
  res.json({ ...redactSecret(client), clientSecret: newSecret });
});

/**
 * Issue or replace the copy-and-paste ingest URL token.
 *
 * Two uses: minting one for a client created before this existed, and replacing
 * one that has leaked. Replacing takes effect immediately — the old URL stops
 * working on the next request, which is the point.
 */
router.post("/api-clients/:id/regenerate-ingest-url", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await refuseIfOutOfScope(req, res, id)) return;

  const [existing] = await db.select().from(apiClientsTable).where(eq(apiClientsTable.id, id));
  if (!existing) { res.status(404).json({ error: "API client not found" }); return; }

  // The scope rule is enforced here as well as at authentication time. Minting a
  // token for a `*` client would produce a URL that silently never works, and
  // "it 401s and nothing says why" is the exact failure this feature exists to
  // remove.
  if (!assertUrlTokenAllowed(existing)) {
    res.status(400).json({
      error: "Only an ingest-scoped endpoint can have a copy-and-paste URL.",
      code: "scope_too_broad",
      hint: `This client's scopes are ${JSON.stringify(existing.scopes)}. Create a new endpoint scoped to ${INGEST_SCOPE} instead, or narrow this one.`,
    });
    return;
  }

  const issued = issueIngestToken();
  if (!issued) {
    res.status(503).json({
      error: "Encryption is not configured, so a copy-and-paste URL cannot be issued.",
      code: "encryption_unavailable",
      hint: "Set SECRETS_ENC_KEY (or SECRETS_ENC_KEY_FILE) and restart. Until then use a header-authenticated endpoint.",
    });
    return;
  }

  const [client] = await db
    .update(apiClientsTable)
    .set({
      ingestTokenHash: issued.hash,
      ingestTokenEnc: issued.encrypted,
      ingestTokenIssuedAt: new Date(),
    })
    .where(eq(apiClientsTable.id, id))
    .returning();

  void logActivity("api_client.ingest_url_regenerated", "api_client", client.id, client.name,
    existing.ingestTokenHash ? "Replaced an existing URL — the old one no longer works" : "Issued a new ingest URL", req);
  recordSecurityEvent({
    type: "access.updated",
    outcome: "success",
    reason: "ingest_url_regenerated",
    userId: req.principal?.user.id ?? null,
    username: req.principal?.user.username ?? null,
    detail: { apiClientId: client.id, replaced: Boolean(existing.ingestTokenHash) },
    req,
  });

  const projectNames = await loadProjectNames();
  res.json(decorate(client, projectNames));
});

// ── Revoke ─────────────────────────────────────────────────────────────────────
router.post("/api-clients/:id/revoke", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await refuseIfOutOfScope(req, res, id)) return;

  const [client] = await db
    .update(apiClientsTable)
    .set({ status: "revoked" })
    .where(eq(apiClientsTable.id, id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }
  void logActivity("api_client.revoked", "api_client", client.id, client.name, null, req);
  auditClient(req, "api_client.revoked", client);
  res.json(redactSecret(client));
});

// ── Restore (un-revoke) ────────────────────────────────────────────────────────
router.post("/api-clients/:id/restore", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (await refuseIfOutOfScope(req, res, id)) return;

  const [client] = await db
    .update(apiClientsTable)
    .set({ status: "active" })
    .where(eq(apiClientsTable.id, id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }
  void logActivity("api_client.restored", "api_client", client.id, client.name, null, req);
  auditClient(req, "api_client.restored", client);
  res.json(redactSecret(client));
});

// ── Delete ─────────────────────────────────────────────────────────────────────
router.delete("/api-clients/:id", async (req, res): Promise<void> => {
  const params = DeleteApiClientParams.safeParse(req.params);
  if (!params.success) { respondInvalid(req, res, params.error); return; }
  if (await refuseIfOutOfScope(req, res, params.data.id)) return;

  const [client] = await db
    .delete(apiClientsTable)
    .where(eq(apiClientsTable.id, params.data.id))
    .returning();

  if (!client) { res.status(404).json({ error: "API client not found" }); return; }
  void logActivity("api_client.deleted", "api_client", client.id, client.name, null, req);
  auditClient(req, "api_client.deleted", client);
  res.sendStatus(204);
});

export default router;
