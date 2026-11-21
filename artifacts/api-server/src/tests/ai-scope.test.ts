/**
 * AI Advisor scope: the project or asset a question is about. The request value
 * is validated, resolves to the asset and its descendants, and every tool keeps
 * to it: tools taking an asset id refuse others, list tools filter.
 * Pure logic only; no database and no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScopeAssetId, scopeNote, scopeRefusal, subtree, type ChatScope } from "../lib/ai-scope";
import { runScopedTool } from "../routes/ai";

const ROOT = "00000000-0000-0000-0000-000000000001";
const CHILD = "00000000-0000-0000-0000-000000000002";
const GRANDCHILD = "00000000-0000-0000-0000-000000000003";
const OTHER = "00000000-0000-0000-0000-000000000009";
const ASSETS = [
  { id: ROOT, parentId: null },
  { id: CHILD, parentId: ROOT },
  { id: GRANDCHILD, parentId: CHILD },
  { id: OTHER, parentId: null },
];
const scope: ChatScope = { rootId: ROOT, name: "Textile", assetIds: subtree(ROOT, ASSETS) };

test("scopeAssetId: absent, null, empty and 'all' mean all assets", () => {
  for (const v of [undefined, null, "", "all"]) assert.deepEqual(parseScopeAssetId(v), { id: null });
});

test("scopeAssetId: a uuid is accepted (lower-cased); anything else is refused", () => {
  assert.deepEqual(parseScopeAssetId(ROOT.toUpperCase()), { id: ROOT });
  for (const v of ["textile", 42, { id: ROOT }, `${ROOT}'--`]) assert.ok("error" in parseScopeAssetId(v));
});

test("subtree: the selected asset and every descendant, nothing else", () => {
  assert.deepEqual([...subtree(ROOT, ASSETS)].sort(), [ROOT, CHILD, GRANDCHILD].sort());
  assert.deepEqual([...subtree(CHILD, ASSETS)].sort(), [CHILD, GRANDCHILD].sort());
});

test("scopeRefusal: inside passes, outside or missing is refused with the scope's name", () => {
  assert.equal(scopeRefusal(scope, GRANDCHILD), null);
  assert.equal(scopeRefusal(undefined, OTHER), null);
  const r = scopeRefusal(scope, OTHER);
  assert.ok(r && r.error.includes("Textile"));
  assert.ok(scopeRefusal(scope, undefined));
});

test("scopeNote names the scope, and is empty without one", () => {
  assert.match(scopeNote(scope), /Textile/);
  assert.equal(scopeNote(undefined), "");
});

test("runScopedTool: a tool taking an asset id is not run for an asset outside the scope", async () => {
  let ran = 0;
  const tool = { fn: async () => { ran++; return { ok: true }; }, def: { parameters: { properties: { assetId: {} } } } };
  assert.deepEqual(await runScopedTool(tool, { assetId: CHILD }, { scope }), { ok: true });
  const refused = await runScopedTool(tool, { assetId: OTHER }, { scope }) as { error: string };
  assert.ok(refused.error.includes("outside the selected scope"));
  assert.equal(ran, 1);
  // Without a scope everything runs, as before.
  assert.deepEqual(await runScopedTool(tool, { assetId: OTHER }, {}), { ok: true });
});

test("runScopedTool: tools without an asset id argument run (they filter their own results)", async () => {
  const tool = { fn: async () => "listed", def: { parameters: { properties: { query: {} } } } };
  assert.equal(await runScopedTool(tool, { query: "pump" }, { scope }), "listed");
});
