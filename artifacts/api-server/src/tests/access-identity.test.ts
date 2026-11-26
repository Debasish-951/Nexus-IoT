/**
 * Regression tests for work package A of the 23 Nov 2026 audit: access control
 * and identity. Pure logic only; no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAccess } from "../lib/rbac";
import { ruleAllows } from "../middleware/authorize";
import { exceedsScopeCeiling, refuseIfAboveCeiling } from "../lib/api-client-ceiling";
import {
  sourceLockRemainingMs, registerSourceFailure, clearSourceFailures, clearAllSourceLocks, resetLoginLockoutsForTests,
} from "../lib/login-lockout";
import { canListUpload, canDownloadUpload, canDeleteUpload, chooseUploadProject, type UploadViewer } from "../lib/upload/access";
import { userWithinActorProjects, unknownProjectIds, adminGuardsFor } from "../lib/user-scope";
import { planAlertChanges, secondAdminRequired, PENDING_TTL_MS } from "../lib/audit-two-person";
import { socketSessionValid, channelAllowed } from "../lib/ws-broadcast";
import { ownsInChain } from "../lib/viz-access";
import { debugErrorsEnabled } from "../lib/errors";

// ── H-1 ──────────────────────────────────────────────────────────────────────

test("H-1: an Engineer is above the ceiling of an admin's * key; an Admin is not", () => {
  const engineer = resolveAccess("engineer", {});
  const admin = resolveAccess("admin", {});
  assert.equal(exceedsScopeCeiling(engineer, ["*"]), true);
  assert.equal(exceedsScopeCeiling(engineer, ["ingest:write", "read:telemetry"]), true);
  assert.equal(exceedsScopeCeiling(engineer, ["ingest:write"]), false);
  // An empty scope list means "all scopes" to apiKeyAuth.
  assert.equal(exceedsScopeCeiling(engineer, []), true);
  assert.equal(exceedsScopeCeiling(admin, ["*"]), false);
  assert.equal(exceedsScopeCeiling(admin, []), false);
});

test("H-1: refuseIfAboveCeiling lets an Admin through and ignores machine callers", () => {
  const res = { status() { throw new Error("must not answer"); } } as never;
  const adminReq = { principal: { access: resolveAccess("admin", {}), user: { id: "a", username: "a" } } } as never;
  assert.equal(refuseIfAboveCeiling(adminReq, res, { id: "k", scopes: ["*"] }), false);
  assert.equal(refuseIfAboveCeiling({} as never, res, { id: "k", scopes: ["*"] }), false);
  const engReq = { principal: { access: resolveAccess("engineer", {}), user: { id: "e", username: "e" } } } as never;
  assert.equal(refuseIfAboveCeiling(engReq, res, { id: "k", scopes: ["ingest:write"] }), false);
});

// ── M-1 ──────────────────────────────────────────────────────────────────────

test("M-1: wrong passwords lock only the (account, network) pair", () => {
  resetLoginLockoutsForTests();
  const now = 1_000_000;
  for (let i = 1; i < 5; i++) assert.equal(registerSourceFailure("u1", "203.0.113.0/24", 5, 900_000, now + i), false);
  assert.equal(registerSourceFailure("u1", "203.0.113.0/24", 5, 900_000, now + 5), true);
  assert.ok(sourceLockRemainingMs("u1", "203.0.113.0/24", now + 6) > 0, "attacker network locked");
  assert.equal(sourceLockRemainingMs("u1", "198.51.100.0/24", now + 6), 0, "owner's network not locked");
  assert.equal(sourceLockRemainingMs("u2", "203.0.113.0/24", now + 6), 0, "other accounts not locked");
  assert.equal(sourceLockRemainingMs("u1", "203.0.113.0/24", now + 900_010), 0, "lock expires");
  clearAllSourceLocks("u1");
  assert.equal(sourceLockRemainingMs("u1", "203.0.113.0/24", now + 6), 0, "admin unlock clears it");
});

test("M-1: old failures are forgotten, a success clears the count, threshold 0 disables", () => {
  resetLoginLockoutsForTests();
  for (let i = 0; i < 4; i++) registerSourceFailure("u1", "n", 5, 1000, i);
  assert.equal(registerSourceFailure("u1", "n", 5, 1000, 5000), false, "stale failures do not count");
  for (let i = 0; i < 3; i++) registerSourceFailure("u1", "n", 5, 1000, 5001 + i);
  clearSourceFailures("u1", "n");
  assert.equal(registerSourceFailure("u1", "n", 5, 1000, 5010), false);
  assert.equal(registerSourceFailure("u1", "n", 0, 1000, 5011), false);
});

// ── M-2 ──────────────────────────────────────────────────────────────────────

test("M-2: upload list, download and delete follow project and uploader", () => {
  const restricted: UploadViewer = { userId: "r", restricted: true, allowedProjects: new Set(["P1"]), admin: false };
  const admin: UploadViewer = { userId: "a", restricted: false, allowedProjects: new Set(), admin: true };
  const engineer: UploadViewer = { userId: "e", restricted: false, allowedProjects: new Set(), admin: false };
  const otherProject = { uploadedBy: "x", projectId: "P2" };
  const myProject = { uploadedBy: "x", projectId: "P1" };
  const shared = { uploadedBy: "x", projectId: null };
  const mine = { uploadedBy: "r", projectId: "P2" };

  assert.equal(canListUpload(restricted, otherProject), false);
  assert.equal(canDownloadUpload(restricted, otherProject), false);
  assert.equal(canListUpload(restricted, myProject), true);
  assert.equal(canListUpload(restricted, shared), false, "shared files are not listed to restricted users");
  assert.equal(canDownloadUpload(restricted, shared), true, "but dashboards that use them still load");
  assert.equal(canListUpload(restricted, mine), true);

  assert.equal(canDeleteUpload(restricted, myProject), false, "not the uploader");
  assert.equal(canDeleteUpload(restricted, mine), true);
  assert.equal(canDeleteUpload(engineer, otherProject), false);
  assert.equal(canDeleteUpload(admin, otherProject), true);
});

test("M-2: an upload's project must be one the caller may use", () => {
  const restricted: UploadViewer = { userId: "r", restricted: true, allowedProjects: new Set(["P1"]), admin: false };
  const isProject = (id: string) => id === "P1" || id === "P2";
  assert.deepEqual(chooseUploadProject(restricted, "P1", isProject), { projectId: "P1" });
  assert.ok("error" in chooseUploadProject(restricted, "P2", isProject));
  assert.ok("error" in chooseUploadProject(restricted, "nope", isProject));
  assert.deepEqual(chooseUploadProject(restricted, null, isProject), { projectId: "P1" }, "single project is the default");
  const open: UploadViewer = { userId: "a", restricted: false, allowedProjects: new Set(), admin: true };
  assert.deepEqual(chooseUploadProject(open, null, isProject), { projectId: null });
});

// ── M-3, L-9 ─────────────────────────────────────────────────────────────────

test("L-9: audit verify is POST only", () => {
  const admin = resolveAccess("admin", {});
  assert.equal(ruleAllows(admin, "POST", "/activity-log/verify"), true);
  assert.equal(ruleAllows(admin, "GET", "/activity-log/verify"), false);
});

// ── M-5, L-21 ────────────────────────────────────────────────────────────────

test("M-5: a project-restricted admin acts only on users inside their projects", () => {
  const actor = resolveAccess("admin", { restrictProjects: true, allowedProjects: ["P1", "P2"] });
  assert.equal(userWithinActorProjects(actor, "operator", { restrictProjects: true, allowedProjects: ["P1"] }), true);
  assert.equal(userWithinActorProjects(actor, "operator", { restrictProjects: true, allowedProjects: ["P3"] }), false);
  assert.equal(userWithinActorProjects(actor, "operator", {}), false, "an unrestricted user is outside");
  assert.equal(userWithinActorProjects(actor, "project_manager", { restrictProjects: true, allowedProjects: ["P1"] }), false, "PMs see every project");
  assert.equal(userWithinActorProjects(actor, "developer", { allowedProjects: ["P2"] }), true, "developers are always assigned");
  const unrestricted = resolveAccess("admin", {});
  assert.equal(userWithinActorProjects(unrestricted, "operator", {}), true);
});

test("L-21: unknown project ids and last-admin guards", () => {
  assert.deepEqual(unknownProjectIds(["P1", "X", "X"], new Set(["P1"])), ["X"]);
  assert.deepEqual(unknownProjectIds(undefined, new Set()), []);
  // Demoting the last Company Admin to Admin keeps an admin but loses the top level.
  assert.deepEqual(adminGuardsFor({ role: "company_admin", status: "active" }, { role: "admin", active: true }), { admin: false, topAdmin: true });
  assert.deepEqual(adminGuardsFor({ role: "super_admin", status: "active" }, null), { admin: true, topAdmin: true });
  assert.deepEqual(adminGuardsFor({ role: "admin", status: "active" }, { role: "admin", active: false }), { admin: true, topAdmin: false });
  assert.deepEqual(adminGuardsFor({ role: "admin", status: "suspended" }, null), { admin: false, topAdmin: false });
});

// ── M-21, L-4 ────────────────────────────────────────────────────────────────

test("M-21: a socket's session must be live and its user active", () => {
  const now = Date.now();
  const ok = { revokedAt: null, expiresAt: new Date(now + 60_000), absoluteExpiresAt: new Date(now + 60_000), status: "active", mustChangePassword: false };
  assert.equal(socketSessionValid(ok, now), true);
  assert.equal(socketSessionValid(undefined, now), false, "session deleted with its user");
  assert.equal(socketSessionValid({ ...ok, expiresAt: new Date(now - 1) }, now), false, "idle expiry");
  assert.equal(socketSessionValid({ ...ok, absoluteExpiresAt: new Date(now - 1) }, now), false);
  assert.equal(socketSessionValid({ ...ok, revokedAt: new Date(now) }, now), false);
  assert.equal(socketSessionValid({ ...ok, status: "suspended" }, now), false);
  assert.equal(socketSessionValid({ ...ok, status: null }, now), false, "user row missing");
});

test("L-4: alarm and telemetry channels follow modules", () => {
  const viewer = resolveAccess("viewer", {});
  assert.equal(channelAllowed(viewer, "alarm"), false, "Viewer has no Alarms module");
  assert.equal(channelAllowed(viewer, "telemetry"), true);
  assert.equal(channelAllowed(resolveAccess("operator", {}), "alarm"), true);
  const none = resolveAccess("viewer", { modules: { live: false, explorer: false, visualization: false, live_twin: false, dashboard: false } });
  assert.equal(channelAllowed(none, "telemetry"), false);
  assert.equal(channelAllowed(none, "broker_status"), true, "unlisted channels unchanged");
});

// ── L-2, L-3 ─────────────────────────────────────────────────────────────────

test("L-2: only an owner in the chain may move a dashboard", () => {
  const nodes = [
    { id: "mine", parentId: null, ownerId: "u" },
    { id: "theirs", parentId: null, ownerId: "o" },
    { id: "child", parentId: "theirs", ownerId: "o" },
    { id: "inMine", parentId: "mine", ownerId: "o" },
  ];
  assert.equal(ownsInChain(nodes, "theirs", "u"), false, "a grant is not ownership");
  assert.equal(ownsInChain(nodes, "child", "u"), false);
  assert.equal(ownsInChain(nodes, "inMine", "u"), true);
  assert.equal(ownsInChain(nodes, "mine", "u"), true);
});

test("L-3: Viewers and Operators no longer get Data Management by default", () => {
  assert.equal(resolveAccess("viewer", {}).modules.data_management, false);
  assert.equal(resolveAccess("operator", {}).modules.data_management, false);
  assert.equal(ruleAllows(resolveAccess("viewer", {}), "GET", "/system/backups"), false);
  assert.equal(resolveAccess("viewer", { modules: { data_management: true } }).modules.data_management, true, "per-user override still works");
  assert.equal(resolveAccess("engineer", {}).modules.data_management, true);
});

// ── L-27 ─────────────────────────────────────────────────────────────────────

test("L-27: switching an alert off needs a second administrator", () => {
  const a = { id: "a", name: "Alice" };
  const b = { id: "b", name: "Bob" };
  const now = Date.parse("2026-11-26T00:00:00Z");
  const first = planAlertChanges({}, { role_change: false }, [], a, now);
  assert.deepEqual(first.apply, {});
  assert.deepEqual(first.waiting, ["role_change"]);
  assert.equal(first.pending.length, 1);

  const again = planAlertChanges({}, { role_change: false }, first.pending, a, now + 1);
  assert.deepEqual(again.apply, {}, "the same administrator cannot confirm their own request");

  const second = planAlertChanges({}, { role_change: false }, first.pending, b, now + 2);
  assert.deepEqual(second.apply, { role_change: false });
  assert.deepEqual(second.confirmed, ["role_change"]);
  assert.equal(second.pending.length, 0);

  const on = planAlertChanges({ role_change: false }, { role_change: true }, first.pending, a, now);
  assert.deepEqual(on.apply, { role_change: true }, "switching on is immediate");
  assert.equal(on.pending.length, 0);

  const expired = planAlertChanges({}, { role_change: false }, first.pending, b, now + PENDING_TTL_MS + 1);
  assert.deepEqual(expired.apply, {}, "an expired request does not count");

  assert.equal(secondAdminRequired({}), true);
  assert.equal(secondAdminRequired({ AUDIT_ALERTS_SECOND_ADMIN: "false" }), false);
});

// ── I-3 ──────────────────────────────────────────────────────────────────────

test("I-3: DEBUG_ERRORS is ignored in production", () => {
  assert.equal(debugErrorsEnabled({ DEBUG_ERRORS: "true", NODE_ENV: "production" }), false);
  assert.equal(debugErrorsEnabled({ DEBUG_ERRORS: "true", NODE_ENV: "development" }), true);
  assert.equal(debugErrorsEnabled({ DEBUG_ERRORS: "true" }), true);
  assert.equal(debugErrorsEnabled({ NODE_ENV: "development" }), false);
});
