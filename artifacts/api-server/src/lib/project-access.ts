import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, assetsTable, attributesTable, alarmsTable, alarmHistoryTable, alarmRulesTable } from "@workspace/db";
import { assetSubtree } from "./asset-subtree";
import { canAccessProject } from "./rbac";
import { recordSecurityEvent } from "./security-log";

/**
 * Server-side enforcement of a user's Project Access setting.
 *
 * `restrictProjects` / `allowedProjects` used to be honoured only by the API
 * client routes, so a restricted user was refused by the UI while the API still
 * answered for every other project. This guard runs once in app.ts, after
 * authorize(), so a route cannot forget it. It only ever narrows access: callers
 * with no restriction, including API keys, pass straight through.
 */

export interface AssetScope {
  roots: Set<string>;
  assetIds: Set<string>;
}

const scopeCache = new WeakMap<Request, Promise<AssetScope | null>>();

/** The assets this caller may reach, or null when they are not restricted. */
export function assetScope(req: Request): Promise<AssetScope | null> {
  const cached = scopeCache.get(req);
  if (cached) return cached;
  const access = req.principal?.access;
  const scope = !access?.restrictProjects
    ? Promise.resolve(null)
    : db.select({ id: assetsTable.id, parentId: assetsTable.parentId }).from(assetsTable).then((assets) => {
        const roots = new Set(assets.filter((a) => !a.parentId && canAccessProject(access, a.id)).map((a) => a.id));
        return { roots, assetIds: assetSubtree(roots, assets) };
      });
  scopeCache.set(req, scope);
  return scope;
}

/**
 * The assets an ingest request may write to, or null when unrestricted.
 *
 * - A signed-in, project-restricted user (Payload Simulator): their projects.
 * - An API key assigned to a project: that project's assets.
 * - An unassigned API key, or an unrestricted user: no restriction.
 *
 * `api_clients.project_id` was previously never read during ingest, so a key
 * issued for one project could write readings, and fire alarms and webhooks, in
 * any other project.
 */
export async function ingestScope(req: Request): Promise<Set<string> | null> {
  if (req.principal) return (await assetScope(req))?.assetIds ?? null;
  const projectId = req.apiClient?.projectId;
  // Optional narrower limit set in Integration Hub → API Client → Access: only
  // these assets and their children. Empty (the default) adds no limit.
  const assetLimit = req.apiClient?.allowedAssetIds ?? [];
  if (!projectId && assetLimit.length === 0) return null;
  const assets = await db.select({ id: assetsTable.id, parentId: assetsTable.parentId }).from(assetsTable);
  const project = projectId ? assetSubtree([projectId], assets) : null;
  if (assetLimit.length === 0) return project;
  const narrowed = assetSubtree(assetLimit, assets);
  return project ? new Set([...narrowed].filter((id) => project.has(id))) : narrowed;
}

/**
 * The assets an export (read) request may see, or null when unrestricted.
 *
 * Same rule as ingest: a key assigned to a project reads only that project's
 * subtree. `/export/*` used to ignore `api_clients.project_id` entirely, so a key
 * handed to one customer for their own plant could read every project's
 * telemetry, alarms and asset list in the installation. A project that no longer
 * exists yields an empty set, so a stale key sees nothing rather than everything.
 */
export const exportScope = ingestScope;

/**
 * What an export does with an explicit `assetId` filter, given the caller's scope.
 * "forbidden" for an asset outside it, so a customer probing another project's id
 * is refused and logged instead of silently answered.
 */
export function exportAssetDecision(scope: Set<string> | null, assetId: string | undefined): "all" | "filtered" | "forbidden" {
  if (!scope) return "all";
  if (assetId && !scope.has(assetId)) return "forbidden";
  return "filtered";
}

/** Record and refuse an export that named an asset outside the key's project. */
export function refuseExportAsset(req: Request, res: Response, assetId: string): void {
  recordSecurityEvent({
    type: "authz.denied",
    outcome: "failure",
    reason: "export_out_of_project_scope",
    userId: null,
    username: null,
    req,
    detail: { path: req.path, method: req.method, assetId, apiClientId: req.apiClient?.id ?? null, projectId: req.apiClient?.projectId ?? null },
  });
  res.status(403).json({ error: "This asset is outside the project this API key is assigned to.", code: "project_forbidden" });
}

/**
 * True when a project-restricted caller names a device id that an asset outside
 * their projects already uses. Readings for a shared device id are split between
 * every asset that claims it, so binding another project's device to one's own
 * asset would divert that project's readings. Unrestricted callers may share ids.
 */
export async function deviceClaimedOutsideScope(req: Request, deviceId: string): Promise<boolean> {
  const scope = await assetScope(req);
  if (!scope || !deviceId) return false;
  const holders = await db.select({ id: assetsTable.id }).from(assetsTable).where(eq(assetsTable.identifier, deviceId));
  const outside = holders.filter((h) => !scope.assetIds.has(h.id));
  if (outside.length > 0) {
    recordSecurityEvent({
      type: "authz.denied", outcome: "failure", reason: "device_claimed_by_other_project",
      userId: req.principal?.user.id ?? null, username: req.principal?.user.username ?? null,
      req, detail: { path: req.path, method: req.method },
    });
  }
  return outside.length > 0;
}

const DEVICE_IN_USE = {
  error: "That device id is already used by an asset outside your projects.",
  code: "device_in_use_elsewhere",
} as const;
export { DEVICE_IN_USE };

/** Record that an ingest request tried to write outside its project. */
export function recordIngestOutOfScope(req: Request, deviceId: string): void {
  recordSecurityEvent({
    type: "authz.denied",
    outcome: "failure",
    reason: "ingest_out_of_project_scope",
    userId: req.principal?.user.id ?? null,
    username: req.principal?.user.username ?? null,
    req,
    detail: { deviceId, apiClientId: req.apiClient?.id ?? null, projectId: req.apiClient?.projectId ?? null },
  });
}

/**
 * Plant-wide figures that cannot be narrowed to one project. A restricted user
 * sees project data through the project screens instead. Refusing
 * is deliberate: a partial answer here would present other projects' data as totals.
 */
const PLATFORM_WIDE = [
  /^\/dashboard\//,
  /^\/export\/(assets|telemetry|alarms|alarm-history)\/?$/,
  /^\/ai\/chat\/?$/,
  /^\/ingest\/seen-devices(\/|$)/,
  /^\/ingest\/register-device\/?$/,
  // Retention policies and the storage report cover every project's telemetry. A
  // restricted user could otherwise create a global policy and delete history for
  // all projects, or read every project's asset names from the storage report.
  /^\/system\/(storage|retention)(\/|$)/,
  // The rest of Data Management (health, alerts, backups, holds, archives, approvals) is plant-wide too.
  /^\/system\/(db-health|data-health|data-settings|alerts|backups|holds|archives|changes)(\/|$)/,
];

/** Asset id carried directly in the path. */
const DIRECT_ASSET = [/^\/assets\/([^/]+)/, /^\/telemetry\/([^/]+)/];

/** Rows looked up by id, whose asset decides access. Null asset = platform-wide row. */
async function owningAsset(path: string): Promise<{ found: boolean; assetId: string | null } | null> {
  let m: RegExpExecArray | null;
  if ((m = /^\/attributes\/([^/]+)/.exec(path))) {
    const [row] = await db.select({ assetId: attributesTable.assetId }).from(attributesTable).where(eq(attributesTable.id, m[1]!));
    return { found: !!row, assetId: row?.assetId ?? null };
  }
  if ((m = /^\/alarms\/history\/([^/]+)\/acknowledge/.exec(path))) {
    const [row] = await db.select({ assetId: alarmHistoryTable.assetId }).from(alarmHistoryTable).where(eq(alarmHistoryTable.id, m[1]!));
    return { found: !!row, assetId: row?.assetId ?? null };
  }
  if ((m = /^\/alarms\/([^/]+)\/acknowledge/.exec(path))) {
    const [row] = await db.select({ assetId: alarmsTable.assetId }).from(alarmsTable).where(eq(alarmsTable.id, m[1]!));
    return { found: !!row, assetId: row?.assetId ?? null };
  }
  if ((m = /^\/alarm-rules\/([^/]+)/.exec(path))) {
    const [row] = await db.select({ assetId: alarmRulesTable.assetId }).from(alarmRulesTable).where(eq(alarmRulesTable.id, m[1]!));
    return { found: !!row, assetId: row?.assetId ?? null };
  }
  return null;
}

/** Lists narrowed after the route has answered, so no list route has to change. */
const FILTERED_LISTS: Array<{ path: RegExp; key: "id" | "assetId" }> = [
  { path: /^\/assets\/?$/, key: "id" },
  { path: /^\/alarms\/?$/, key: "assetId" },
  { path: /^\/alarms\/history\/?$/, key: "assetId" },
  { path: /^\/alarm-rules\/?$/, key: "assetId" },
];

/** Platform-wide configuration a restricted user may read but not change. */
const SHARED_CONFIG = /^\/(brokers|destinations|integration\/(destinations|deliveries|connectors))(\/|$)/;
const TEMPLATE_PATH = /^\/asset-templates\/([^/]+)\/?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refuse(req: Request, res: Response, assetId: string | null): void {
  recordSecurityEvent({
    type: "authz.denied",
    outcome: "failure",
    reason: "out_of_project_scope",
    userId: req.principal?.user.id ?? null,
    username: req.principal?.user.username ?? null,
    req,
    detail: { path: req.path, method: req.method, assetId },
  });
  res.status(403).json({ error: "This is outside the projects assigned to you.", code: "project_forbidden" });
}

export async function projectScopeGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = await assetScope(req);
    if (!scope) { next(); return; }

    if (PLATFORM_WIDE.some((p) => p.test(req.path))) { refuse(req, res, null); return; }

    for (const pattern of DIRECT_ASSET) {
      const id = pattern.exec(req.path)?.[1];
      if (id && !scope.assetIds.has(id)) { refuse(req, res, id); return; }
    }

    // Long-range widget charts read this, so it is checked per asset. With no asset
    // it would total every project, so that form stays refused.
    if (/^\/system\/aggregate\/?$/.test(req.path)) {
      const assetId = typeof req.query.assetId === "string" ? req.query.assetId : null;
      if (!assetId || !scope.assetIds.has(assetId)) { refuse(req, res, assetId); return; }
    }

    const owner = await owningAsset(req.path);
    // A row that does not exist falls through so the route answers its usual 404.
    if (owner?.found && !(owner.assetId && scope.assetIds.has(owner.assetId))) {
      refuse(req, res, owner.assetId);
      return;
    }

    if (req.method === "GET") {
      const list = FILTERED_LISTS.find((l) => l.path.test(req.path));
      if (list) {
        const original = res.json.bind(res);
        res.json = (body: unknown) => {
          // Fails closed: a response shape this filter does not recognise is not sent.
          const rows = Array.isArray(body) ? body : [];
          return original(rows.filter((r) => scope.assetIds.has((r as Record<string, string>)[list.key] ?? "")));
        };
      }
    } else {
      // Brokers and destinations have no project column: one broker feeds every
      // project. A Developer assigned to one project could otherwise reconfigure
      // or delete the broker all the others depend on. Restricted users read them.
      if (SHARED_CONFIG.test(req.path)) { refuse(req, res, null); return; }

      // Templates are shared too, but creating one harms nobody, so that stays
      // open. Changing or deleting one is refused once any asset outside the
      // caller's projects uses it, since the change would reach that asset.
      const templateId = TEMPLATE_PATH.exec(req.path)?.[1];
      if (templateId && req.method !== "POST" && UUID_RE.test(templateId)) {
        const users = await db.select({ id: assetsTable.id }).from(assetsTable).where(eq(assetsTable.templateId, templateId));
        const outside = users.find((a) => !scope.assetIds.has(a.id));
        if (outside) { refuse(req, res, outside.id); return; }
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      if (/^\/assets\/?$/.test(req.path) && req.method === "POST") {
        // Creating a root asset would create a new project, which is not theirs to do.
        if (typeof body.parentId !== "string" || !scope.assetIds.has(body.parentId)) {
          refuse(req, res, typeof body.parentId === "string" ? body.parentId : null);
          return;
        }
      }
      if (/^\/alarm-rules(\/|$)/.test(req.path) && req.method !== "DELETE") {
        // A rule with no asset applies to every project, so it is refused too.
        if (body.assetId !== undefined || req.method === "POST") {
          if (typeof body.assetId !== "string" || !scope.assetIds.has(body.assetId)) {
            refuse(req, res, typeof body.assetId === "string" ? body.assetId : null);
            return;
          }
        }
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}
