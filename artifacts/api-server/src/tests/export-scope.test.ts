/**
 * Regression tests for project scoping on the /export API.
 *
 * A key assigned to a project used to read every project's telemetry, alarms and
 * assets through /export/*. Same runner as the other suites: no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exportAssetDecision } from "../lib/project-access";

const src = (rel: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8");

test("export scope: an unassigned key is unrestricted", () => {
  assert.equal(exportAssetDecision(null, undefined), "all");
  assert.equal(exportAssetDecision(null, "any-asset"), "all");
});

test("export scope: a project key is filtered, and refused for another project's asset", () => {
  const scope = new Set(["plant-a", "pump-a"]);
  assert.equal(exportAssetDecision(scope, undefined), "filtered");
  assert.equal(exportAssetDecision(scope, "pump-a"), "filtered");
  assert.equal(exportAssetDecision(scope, "pump-b"), "forbidden");
});

test("export scope: a key whose project was deleted sees nothing, not everything", () => {
  assert.equal(exportAssetDecision(new Set(), undefined), "filtered");
  assert.equal(exportAssetDecision(new Set(), "pump-a"), "forbidden");
});

test("export scope: every data export reads the caller's scope", () => {
  const route = src("routes/export.ts");
  for (const path of ["/export/assets", "/export/telemetry", "/export/alarms", "/export/alarm-history"]) {
    const start = route.indexOf(`router.get("${path}"`);
    assert.ok(start >= 0, `${path} not found`);
    const end = route.indexOf("router.get(", start + 1);
    const body = route.slice(start, end < 0 ? undefined : end);
    assert.match(body, /exportScope\(req\)/, `${path} does not apply the key's project scope`);
  }
});

test("export health: anonymous callers get no platform figures", () => {
  const route = src("routes/export.ts");
  const start = route.indexOf('router.get("/export/health"');
  const body = route.slice(start, route.indexOf("router.get(", start + 1));
  assert.ok(body.indexOf("showStats") < body.indexOf("count(*)"), "stats are computed before the caller is checked");
});

test("api clients: a restricted user cannot create or detach a key to platform-wide", () => {
  const route = src("routes/api_clients.ts");
  assert.equal((route.match(/refuseUnassigned\(req, res,/g) ?? []).length, 2);
  assert.match(route, /code: "project_required"/);
});
