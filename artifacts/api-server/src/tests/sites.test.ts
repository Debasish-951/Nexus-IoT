/**
 * Map view sites (GET /sites): one row per project the caller may open, with
 * location read from the project's Latitude / Longitude / Address attributes.
 * Same runner as the other suites: no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSites } from "../lib/sites";

const src = (rel: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8");

const assets = [
  { id: "plant-a", name: "Plant A", parentId: null },
  { id: "pump-a", name: "Pump A", parentId: "plant-a", maintenanceMode: true },
  { id: "motor-a", name: "Motor A", parentId: "pump-a" },
  { id: "plant-b", name: "Plant B", parentId: null },
  { id: "pump-b", name: "Pump B", parentId: "plant-b" },
];

test("sites: a restricted caller sees only their projects", () => {
  const rows = buildSites(assets, [], [], new Set(["plant-a"]));
  assert.deepEqual(rows.map((r) => r.projectId), ["plant-a"]);
  assert.equal(rows[0].assetCount, 3);
  assert.equal(rows[0].maintenanceCount, 1);
});

test("sites: location comes from the project's attributes, in any letter case", () => {
  const rows = buildSites(assets, [
    { id: "a1", assetId: "plant-a", name: "Latitude", value: "17.385" },
    { id: "a2", assetId: "plant-a", name: "longitude", value: 78.4867 },
    { id: "a3", assetId: "plant-a", name: "Address", value: "Hyderabad" },
    // An attribute of a child asset is not the site's location.
    { id: "a4", assetId: "pump-b", name: "Latitude", value: 1 },
  ], [], null);
  const a = rows.find((r) => r.projectId === "plant-a")!;
  assert.equal(a.latitude, 17.385);
  assert.equal(a.longitude, 78.4867);
  assert.equal(a.address, "Hyderabad");
  assert.equal(a.latitudeAttrId, "a1");
  const b = rows.find((r) => r.projectId === "plant-b")!;
  assert.equal(b.latitude, null);
});

test("sites: half a location, or one out of range, is not placed", () => {
  const rows = buildSites(assets, [
    { assetId: "plant-a", name: "Latitude", value: 12 },
    { assetId: "plant-b", name: "Latitude", value: 95 },
    { assetId: "plant-b", name: "Longitude", value: 10 },
  ], [], null);
  assert.ok(rows.every((r) => r.latitude === null && r.longitude === null));
});

test("sites: newest data of any asset in the project, not of other projects", () => {
  const rows = buildSites(assets, [], [
    { assetId: "motor-a", ts: "2026-11-20T10:00:00Z" },
    { assetId: "pump-a", ts: "2026-11-20T09:00:00Z" },
    { assetId: "pump-b", ts: "2026-11-21T00:00:00Z" },
  ], new Set(["plant-a"]));
  assert.equal(rows[0].lastDataAt, "2026-11-20T10:00:00.000Z");
});

test("sites: the route applies the caller's project scope and an RBAC rule exists", () => {
  assert.match(src("routes/sites.ts"), /assetScope\(req\)/);
  assert.match(src("middleware/authorize.ts"), /path: "\/sites",[^\n]*anyModule: \["live_twin", "visualization"\]/);
});
