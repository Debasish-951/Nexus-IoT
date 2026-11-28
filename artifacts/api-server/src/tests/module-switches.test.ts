import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAccess, hasModuleAccess, rbacCatalog, keepSwitchedOffModules } from "../lib/rbac";

// Live Twin and AI Advisor are switched off for the installation unless
// ENABLE_LIVE_TWIN / ENABLE_AI_ADVISOR are "true" (owner's request, 28 Nov 2026).

test("module switches: Live Twin and AI Advisor are off by default for every role", () => {
  delete process.env.ENABLE_LIVE_TWIN;
  delete process.env.ENABLE_AI_ADVISOR;
  for (const role of ["super_admin", "engineer", "viewer"]) {
    const access = resolveAccess(role, { modules: { live_twin: { r: true, w: true, d: true }, ai_advisor: true } });
    assert.equal(access.modules.live_twin, undefined);
    assert.equal(access.modules.ai_advisor, undefined);
    assert.equal(hasModuleAccess(access, "live_twin", "read"), false);
    assert.equal(hasModuleAccess(access, "ai_advisor", "read"), false);
    assert.equal(access.overriddenModules.includes("live_twin"), false);
  }
  // Other modules are unaffected.
  assert.equal(hasModuleAccess(resolveAccess("engineer", null), "visualization", "read"), true);
});

test("module switches: the Access Control catalogue leaves switched-off modules out", () => {
  delete process.env.ENABLE_LIVE_TWIN;
  delete process.env.ENABLE_AI_ADVISOR;
  const catalog = rbacCatalog();
  const keys = catalog.modules.map((m) => m.key);
  assert.equal(keys.includes("live_twin"), false);
  assert.equal(keys.includes("ai_advisor"), false);
  for (const role of catalog.roles) {
    assert.equal("live_twin" in role.moduleDefaults, false);
    assert.equal("ai_advisor" in role.moduleDefaults, false);
  }
});

test("module switches: saving a user keeps stored access to switched-off modules", () => {
  delete process.env.ENABLE_LIVE_TWIN;
  delete process.env.ENABLE_AI_ADVISOR;
  const previous = { modules: { live_twin: { r: true, w: false, d: false }, ai_advisor: false, alarms: true } };
  const next = keepSwitchedOffModules({ modules: { alarms: false } }, previous);
  assert.deepEqual(next.modules, { alarms: false, live_twin: { r: true, w: false, d: false }, ai_advisor: false });
  // Nothing stored: nothing added.
  assert.deepEqual(keepSwitchedOffModules({ restrictProjects: true }, null), { restrictProjects: true });
});

test("module switches: turning them on restores the stored access", () => {
  process.env.ENABLE_LIVE_TWIN = "true";
  process.env.ENABLE_AI_ADVISOR = "true";
  try {
    const access = resolveAccess("viewer", { modules: { ai_advisor: true, live_twin: { r: true, w: true, d: false } } });
    assert.equal(access.modules.ai_advisor, true);
    assert.deepEqual(access.modules.live_twin, { r: true, w: true, d: false });
    assert.equal(rbacCatalog().modules.some((m) => m.key === "live_twin"), true);
    // While on, the editor owns these modules again: nothing is carried over.
    assert.deepEqual(keepSwitchedOffModules({}, { modules: { ai_advisor: true } }), {});
  } finally {
    delete process.env.ENABLE_LIVE_TWIN;
    delete process.env.ENABLE_AI_ADVISOR;
  }
});
