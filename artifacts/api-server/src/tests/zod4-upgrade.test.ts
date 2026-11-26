/**
 * zod 4 upgrade regressions. Pure logic only; no database.
 *
 * zod 4's `z.uuid()` enforces the RFC 9562 version and variant bits, which the
 * seed's fixed ids (00000010-…-000000000001, 00000011-…-000000000001) do not
 * have. zod 3's `.uuid()` accepted them, and so must the API: hand-written ids
 * use `z.guid()` and the generated schemas get a GUID pattern from
 * lib/api-spec/orval.config.ts.
 *
 * zod 4 also applies a field's `.default()` inside `.optional()`, so partial
 * update bodies must not fill the fields a client left out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { GetAssetsLiveSummaryBody, CreateRetentionPolicyBody, UpdateDestinationParams } from "@workspace/api-zod";
import { validate, type ValidateSpec } from "../middleware/validate";
import { IdParams, UpdateDestinationBody } from "../schemas/common";
import { DataSettingsUpdate, parseSettings } from "../lib/data-settings";

const DEMO_PLANT = "00000010-0000-0000-0000-000000000001";
const DEMO_PUMP = "00000011-0000-0000-0000-000000000001";

function run(spec: ValidateSpec, input: { params?: unknown; body?: unknown }) {
  const req = { params: input.params ?? {}, query: {}, body: input.body, path: "/test", method: "POST" } as unknown as Request;
  let status = 0;
  let json: unknown;
  const res = {
    status(code: number) { status = code; return this; },
    json(data: unknown) { json = data; return this; },
  } as unknown as Response;
  let passed = false;
  validate(spec)(req, res, () => { passed = true; });
  return { passed, status, json, req };
}

test("zod 4: the seed's fixed ids pass a hand-written route param", () => {
  for (const id of [DEMO_PLANT, DEMO_PUMP]) {
    const r = run({ params: IdParams }, { params: { id } });
    assert.equal(r.passed, true, `${id} accepted`);
    assert.equal((r.req.params as { id: string }).id, id);
  }
});

test("zod 4: the seed's fixed ids pass a generated route param", () => {
  const r = run({ params: UpdateDestinationParams }, { params: { id: DEMO_PUMP } });
  assert.equal(r.passed, true);
});

test("zod 4: the seed's fixed ids pass generated body fields", () => {
  assert.equal(run({ body: GetAssetsLiveSummaryBody }, { body: { ids: [DEMO_PLANT, DEMO_PUMP] } }).passed, true);
  const r = run({ body: CreateRetentionPolicyBody }, { body: { name: "Pump", assetId: DEMO_PUMP, retentionDays: 30 } });
  assert.equal(r.passed, true, JSON.stringify(r.json));
});

test("zod 4: a malformed id is still refused, with the same response shape", () => {
  const r = run({ params: IdParams }, { params: { id: "not-a-uuid" } });
  assert.equal(r.passed, false);
  assert.equal(r.status, 400);
  const body = r.json as { error: string; code: string; errors: { field: string; message: string }[] };
  assert.equal(body.code, "invalid_params");
  assert.equal(typeof body.error, "string");
  assert.deepEqual(body.errors.map((e) => e.field), ["id"]);

  const g = run({ body: GetAssetsLiveSummaryBody }, { body: { ids: [DEMO_PUMP, "nope"] } });
  assert.equal(g.passed, false);
  assert.deepEqual((g.json as { errors: { field: string }[] }).errors.map((e) => e.field), ["ids.1"]);
});

test("zod 4: unknown fields are still refused with the same message", () => {
  const r = run({ params: IdParams }, { params: { id: DEMO_PUMP, extra: "x" } });
  assert.equal(r.passed, false);
  assert.deepEqual((r.json as { errors: unknown[] }).errors, [{ field: "(root)", message: "unexpected field: extra" }]);
});

test("zod 4: partial updates leave omitted fields absent instead of applying defaults", () => {
  const d = UpdateDestinationBody.parse({ name: "Ops" });
  assert.deepEqual(Object.keys(d), ["name"]);
  const s = DataSettingsUpdate.parse({ approval: { enabled: true } });
  assert.deepEqual(s, { approval: { enabled: true } });
});

test("zod 4: settings sections still fill their field defaults", () => {
  const s = parseSettings({});
  assert.equal(s.alerts.diskFreePctBelow, 15);
  assert.equal(s.pruneWindow.start, "01:00");
  assert.equal(s.health.quietMinutes, 60);
});
