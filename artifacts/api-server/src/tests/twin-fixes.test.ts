/**
 * Live Twin audit fixes (23 Nov 2026, package F): stale-save conflict check,
 * project rule, folder / viz-node cycles, request-guard allowance, and the 2D
 * twin's SVG url() check. Same runner as the other suites: no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isStaleWrite, mayUseNoProject, wouldCreateCycle } from "../lib/twin-rules";
import { checkJsonStructure } from "../lib/validation";
import { guardLimitsFor } from "../middleware/requestGuard";
import { UpdatePlantTwinBody } from "../schemas/common";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", rel), "utf8");

// ── H-6: optimistic locking ──────────────────────────────────────────────────
test("H-6: a save carrying an older updatedAt is stale; the same one is not", () => {
  const stored = new Date("2026-11-26T10:00:00.123Z");
  assert.equal(isStaleWrite(stored, "2026-11-26T10:00:00.123Z"), false);
  assert.equal(isStaleWrite(stored, "2026-11-26T09:59:59.000Z"), true);
  // An older client sends nothing: accepted as before.
  assert.equal(isStaleWrite(stored, undefined), false);
});

test("H-6: the update body accepts expectedUpdatedAt and refuses junk", () => {
  assert.equal(UpdatePlantTwinBody.safeParse({ scene: {}, expectedUpdatedAt: "2026-11-26T10:00:00.123Z" }).success, true);
  assert.equal(UpdatePlantTwinBody.safeParse({ scene: {} }).success, true);
  assert.equal(UpdatePlantTwinBody.safeParse({ scene: {}, expectedUpdatedAt: "yesterday-ish" }).success, false);
});

test("H-6: the PUT route locks the row and answers 409 on a stale write", () => {
  const route = src("routes/plant_twins.ts");
  assert.match(route, /\.for\("update"\)/);
  assert.match(route, /isStaleWrite\(cur\.updatedAt, expectedUpdatedAt\)/);
  assert.match(route, /status\(409\)[\s\S]{0,200}plant_twin_conflict/);
  // Old clients keep working, and are logged.
  assert.match(route, /without expectedUpdatedAt/);
});

// ── M-14: no scenes read for lists, moves and folder deletes ──────────────────
test("M-14: list, delete and parent checks read metadata only; folder delete is one transaction", () => {
  const route = src("routes/plant_twins.ts");
  assert.match(route, /router\.get\("\/plant-twins", [\s\S]{0,200}db\.select\(META\)/);
  assert.match(route, /router\.delete\([\s\S]{0,300}db\.select\(META\)[\s\S]{0,600}db\.transaction/);
  assert.doesNotMatch(route, /\(await db\.select\(\)\.from\(plantTwinsTable\)\)\.filter/);
  // Children move up in the database, not by rewriting each scene in the API.
  assert.match(route, /jsonb_set\(/);
});

// ── M-15: request guard allowance ────────────────────────────────────────────
test("M-15: twin saves get the plant-twin key allowance; other routes do not", () => {
  assert.equal(guardLimitsFor("PUT", "/api/plant-twins/pt-abc").maxKeys, 40_000);
  assert.equal(guardLimitsFor("POST", "/api/plant-twins").maxKeys, 40_000);
  assert.equal(guardLimitsFor("POST", "/api/viz-nodes").maxKeys, 20_000);
  assert.equal(guardLimitsFor("GET", "/api/plant-twins/pt-abc").maxKeys, 20_000);
  assert.equal(guardLimitsFor("PUT", "/api/plant-twins/pt-abc/extra").maxKeys, 20_000);
});

test("M-15: a 25,000-key scene passes the guard on the twin route", () => {
  const items = Array.from({ length: 5000 }, (_, i) => ({ id: `m${i}`, x: i, z: i, rot: 0, type: "pump" }));
  const scene = { scene: { items } };     // 25,000+ keys
  assert.equal(checkJsonStructure(scene, guardLimitsFor("PUT", "/api/plant-twins/pt-1")).ok, true);
  const refused = checkJsonStructure(scene, guardLimitsFor("PUT", "/api/viz-nodes/vn-1"));
  assert.equal(refused.ok, false);
  // Too big is "size", which the guard does not record as an attack.
  assert.equal(refused.kind, "size");
});

test("M-15: structural attacks are still 'structure' and still recorded", () => {
  assert.equal(checkJsonStructure(JSON.parse('{"__proto__":{"x":1}}')).kind, "structure");
  let deep: unknown = 1; for (let i = 0; i < 30; i++) deep = { d: deep };
  assert.equal(checkJsonStructure(deep).kind, "structure");
  const guard = src("middleware/requestGuard.ts");
  assert.match(guard, /result\.kind === "size"/);
  assert.match(guard, /recordSecurityEvent/);
});

// ── L-1: no project = every project ──────────────────────────────────────────
test("L-1: only an unrestricted caller may show a twin in all projects", () => {
  assert.equal(mayUseNoProject(true, undefined, null), false);       // create, no project
  assert.equal(mayUseNoProject(true, "p1", null), false);            // clear the project
  assert.equal(mayUseNoProject(true, null, null), true);             // already everywhere: unchanged
  assert.equal(mayUseNoProject(true, "p1", undefined), true);        // not changing the project
  assert.equal(mayUseNoProject(true, "p1", "p2"), true);             // a project (checked elsewhere)
  assert.equal(mayUseNoProject(false, "p1", null), true);            // sees all projects
  const route = src("routes/plant_twins.ts");
  assert.equal(route.match(/mayUseNoProject\(/g)?.length, 2);        // POST and PUT
});

// ── L-23: cycles ─────────────────────────────────────────────────────────────
test("L-23: moving a node under its own descendant is a cycle", () => {
  const parents = new Map<string, string | null>([["a", null], ["b", "a"], ["c", "b"], ["d", null]]);
  const p = (x: string) => parents.get(x);
  assert.equal(wouldCreateCycle(p, "a", "c"), true);
  assert.equal(wouldCreateCycle(p, "a", "a"), true);
  assert.equal(wouldCreateCycle(p, "c", "a"), false);
  assert.equal(wouldCreateCycle(p, "a", "d"), false);
  // An already broken (looping) chain does not spin.
  const loop = new Map<string, string | null>([["x", "y"], ["y", "x"]]);
  assert.equal(wouldCreateCycle((k) => loop.get(k), "a", "x"), false);
});

test("L-23: viz-node and folder moves check for cycles on the server; folder moves take a lock", () => {
  assert.match(src("routes/viz_nodes.ts"), /wouldCreateCycle\(\(x\) => parents\.get\(x\), id, update\.parentId\)/);
  const route = src("routes/plant_twins.ts");
  assert.match(route, /wouldCreateCycle\(/);
  assert.match(route, /pg_advisory_xact_lock/);
});

// ── L-10: SVG sanitiser url() check (pure module of the 2D twin) ──────────────
// Imported at run time: it lives in the SPA, outside this package's rootDir, and
// has no DOM dependency.
const cssUrlPath = join(here, "..", "..", "..", "iot-platform", "src", "features", "imageTwin", "cssUrl.ts");
async function cssUrl(): Promise<{ cssUrlsOk: (v: string) => boolean; decodeCssEscapes: (v: string) => string }> {
  return import(pathToFileURL(cssUrlPath).href);
}

test("L-10: fragment references still pass", async () => {
  const { cssUrlsOk } = await cssUrl();
  for (const ok of ["url(#grad1)", "url('#grad1')", 'url("#grad1")', "fill:url(#a);stroke:url( #b )", "fill:#ff0000", "font-family:'Noto Sans'"]) {
    assert.equal(cssUrlsOk(ok), true, ok);
  }
});

test("L-10: the known bypasses are refused", async () => {
  const { cssUrlsOk } = await cssUrl();
  const bad = [
    "url(http://evil.example/x.png)",
    `url("http://evil.example/'#")`,              // mixed quotes: the old regex never matched
    `url('http://evil.example/"#')`,
    "background:u\\72l(http://evil.example/x)",   // CSS escape in the function name
    "background:\\75 rl(http://evil.example/x)",
    "background:url\\28http://evil.example/x\\29",
    "background:image-set('http://evil.example/x.png' 1x)",
    "background:-webkit-image-set(url(#a) 1x, 'http://evil.example/x.png' 2x)",
    "@import 'http://evil.example/x.css'",
    "@\\69mport 'http://evil.example/x.css'",
    "background:url(#a) , url(http://evil.example/x)",
    "background:url(/*x*/http://evil.example/x)",
    "background:src('http://evil.example/x')",
    "fill:url(#a\\29 url\\28http://evil.example)",
  ];
  for (const v of bad) assert.equal(cssUrlsOk(v), false, v);
});

test("L-10: escapes are decoded as a CSS tokenizer would", async () => {
  const { decodeCssEscapes } = await cssUrl();
  assert.equal(decodeCssEscapes("u\\72l("), "url(");
  assert.equal(decodeCssEscapes("\\000075 rl("), "url(");
  assert.equal(decodeCssEscapes("a\\(b"), "a(b");
  assert.equal(decodeCssEscapes("a/* c */b"), "ab");
  assert.equal(decodeCssEscapes("\\0"), "�");
});

test("L-10: the sanitiser uses the decoded check for every CSS value", () => {
  const s = readFileSync(join(here, "..", "..", "..", "iot-platform", "src", "features", "imageTwin", "sanitize.ts"), "utf8");
  assert.match(s, /keep = cssUrlsOk\(a\.value\)/);
  assert.match(s, /BAD_VALUE\.test\(decodeCssEscapes\(a\.value\)\)/);
  assert.doesNotMatch(s, /&& \/url\\\(\/i\.test\(a\.value\)\) \{\s*keep = /);
});
