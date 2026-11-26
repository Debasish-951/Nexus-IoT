/**
 * Audit log integrity fixes from the 23 Nov 2026 audit (H-5, H-7, M-6, M-9,
 * M-10, M-12, M-13, M-23, L-16, L-17). Pure functions and source wiring; no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  entryHash, entryHashFor, verifyChain, markMac, checkMarkMac, pruneBoundary, wellFormed, clipText, sanitiseDeep,
  maskUrl, redactUrlsInText, diffFields, needsSafetyNetEntry, auditEntryInScope, canonical, HMAC_ALG_PREFIX, type ChainRow,
} from "../lib/audit-core";
import { AUDIT_GUARD_SQL, auditGuardGrantsSql } from "../../../../lib/db/src/audit-guard-sql";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", rel), "utf8");

const KEY = Buffer.alloc(32, 7);
const keyFor = (id: string) => (id === "k1" ? KEY : null);
const ALG = `${HMAC_ALG_PREFIX}k1`;

function row(i: number, prev: string, alg: string | null = null, over: Partial<ChainRow> = {}): ChainRow {
  const r = {
    id: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, "0")}`, seq: i, action: "asset.updated", category: "asset",
    actorName: "Ann", actorRole: "engineer", actorUsername: "ann", actorUserId: "u1", targetId: "t", targetName: "Pump",
    detail: null, changes: null, outcome: "success", ip: null, userAgent: null, correlationId: null, assetId: "t", projectId: "p",
    timestamp: new Date(1_700_000_000_000 + i * 1000), prevHash: prev, hash: null, hashAlg: alg, ...over,
  } as ChainRow;
  r.hash = entryHashFor(prev, r, alg, keyFor);
  return r;
}

test("H-7: entries without hash_alg keep the plain SHA-256, so every existing entry still verifies", () => {
  const r = row(1, "");
  assert.equal(r.hash, entryHash("", r));
  assert.deepEqual(verifyChain([r], ""), { ok: true, lastHash: r.hash, keyedSeen: false });
});

test("H-7: keyed entries need the key, and a chain may go from plain to keyed but never back", () => {
  const r1 = row(1, "");
  const r2 = row(2, r1.hash!, ALG);
  const r3 = row(3, r2.hash!, ALG);
  assert.notEqual(r2.hash, entryHash(r1.hash!, r2), "keyed hash differs from the plain one");
  const ok = verifyChain([r1, r2, r3], "", { keyFor });
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.keyedSeen, true);
  // Without the key the keyed entries cannot be checked (or forged).
  const noKey = verifyChain([r1, r2], "");
  assert.equal(!noKey.ok && noKey.broken.reason, "key_missing");
  // Recomputing a keyed entry as plain SHA-256 (what an attacker without the key can do) is a downgrade.
  const forged = { ...r3, hashAlg: null, detail: "edited" } as ChainRow;
  forged.hash = entryHash(r2.hash!, forged);
  const down = verifyChain([r1, r2, forged], "", { keyFor });
  assert.equal(!down.ok && down.broken.reason, "downgrade");
  // The downgrade is caught across batches and after the signed keyed start.
  assert.equal(verifyChain([forged], r2.hash!, { keyFor, keyedSeen: true }).ok, false);
  const plain2 = row(2, r1.hash!);
  const after = verifyChain([r1, plain2], "", { keyFor, keyedAfter: 1 });
  assert.equal(!after.ok && after.broken.reason, "downgrade");
  // Editing a keyed entry breaks it.
  const edited = verifyChain([r1, { ...r2, detail: "x" }], "", { keyFor });
  assert.equal(!edited.ok && edited.broken.reason, "hash_mismatch");
});

test("H-7: checkpoint and anchor MACs", () => {
  const mac = markMac("checkpoint", 42, "abc", { id: "k1", key: KEY });
  assert.match(mac, /^k1:[0-9a-f]{64}$/);
  assert.equal(checkMarkMac("checkpoint", 42, "abc", mac, keyFor), "valid");
  assert.equal(checkMarkMac("checkpoint", 43, "abc", mac, keyFor), "invalid", "another seq");
  assert.equal(checkMarkMac("anchor", 42, "abc", mac, keyFor), "invalid", "another kind");
  assert.equal(checkMarkMac("checkpoint", 42, "abc", mac, () => null), "invalid", "key not loaded");
  assert.equal(checkMarkMac("checkpoint", 42, "abc", null, keyFor), "unsigned");
});

test("H-5 / H-7: the guard SQL is owner-run, checks the owner, guards inserts and prunes through a definer function", () => {
  assert.match(AUDIT_GUARD_SQL, /BEFORE INSERT ON activity_logs/);
  assert.match(AUDIT_GUARD_SQL, /NEW\.seq IS NULL OR NEW\.hash IS NULL/);
  assert.match(AUDIT_GUARD_SQL, /does not link to the chain head/);
  assert.match(AUDIT_GUARD_SQL, /pg_get_userbyid\(relowner\) = current_user/);
  assert.match(AUDIT_GUARD_SQL, /SECURITY DEFINER/);
  assert.match(AUDIT_GUARD_SQL, /greatest\(coalesce\(p_days, 365\), 365\)/, "never deletes entries younger than 365 days");
  assert.match(AUDIT_GUARD_SQL, /audit_checkpoints is insert-only/);
  assert.match(AUDIT_GUARD_SQL, /TRUNCATE refused/);
  assert.doesNotMatch(AUDIT_GUARD_SQL, /app\.audit_retention/, "a session setting alone no longer allows deletes");
  const grants = auditGuardGrantsSql("nexus_app");
  assert.match(grants, /REVOKE UPDATE, DELETE, TRUNCATE ON activity_logs, audit_checkpoints FROM "nexus_app"/);
  assert.throws(() => auditGuardGrantsSql("x; DROP TABLE users"));
  // The API no longer runs the DDL at every start: only the owner-only fallback in checkGuard().
  const store = src("lib/audit-store.ts");
  assert.doesNotMatch(store, /CREATE TRIGGER/);
  assert.match(store, /pg_trigger/);
  assert.match(store, /if \(!guardComplete\(st\) && st\.owner\)/);
  assert.match(store, /raiseAuditAlert\("audit_guard_missing"/);
});

test("M-9: half surrogate pairs are removed before hashing and storing", () => {
  const emoji = "pump \u{1F525}";
  assert.equal(wellFormed(emoji), emoji, "whole pairs are kept");
  assert.equal(wellFormed("a\uD83Db"), "ab");
  assert.equal(wellFormed("a\uDD25b"), "ab");
  const cut = clipText(emoji, emoji.length - 1); // would end on the high surrogate
  assert.equal(cut, "pump ");
  const deep = sanitiseDeep([{ field: "name", from: "x\uD83D", to: { "k\uDC00": "y" } }]) as { from: string; to: Record<string, string> }[];
  assert.equal(deep[0]!.from, "x");
  assert.deepEqual(deep[0]!.to, { k: "y" });
  // The canonical JSON of a cleaned entry round-trips through JSON (what jsonb stores) unchanged.
  const c = canonical(deep);
  assert.equal(canonical(JSON.parse(c)), c);
  // Diffs clip long values on a code-point boundary.
  const long = "a".repeat(499) + "\u{1F525}";
  const d = diffFields({ name: "" }, { name: long });
  assert.equal(wellFormed(String(d[0]!.to)), String(d[0]!.to));
});

test("M-6: webhook secrets in URL paths are masked in diffs and free text", () => {
  assert.equal(maskUrl("https://hooks.slack.com/services/T0000/B0000/XXXXXXXXXXXXXXXXXXXXXXXX"), "https://hooks.slack.com/services/…/…/…");
  assert.equal(maskUrl("https://contoso.webhook.office.com/webhookb2/abc@def/IncomingWebhook/0123456789abcdef/xyz"), "https://contoso.webhook.office.com/webhookb2/…/…/…/…");
  assert.equal(maskUrl("https://api.example.com/v1/hook/9f8e7d6c5b4a39281706f5e4d3c2b1a0"), "https://api.example.com/v1/hook/…");
  assert.equal(maskUrl("https://api.example.com/v1/ingest"), "https://api.example.com/v1/ingest", "ordinary paths stay readable");
  assert.equal(maskUrl(maskUrl("https://hooks.slack.com/services/T0/B0/zzz?x=1")), "https://hooks.slack.com/services/…/…/…?…", "masking twice is stable");
  const w = diffFields({ webhookUrl: null }, { webhookUrl: "https://hooks.slack.com/services/T1/B2/SECRETSECRET123" });
  assert.ok(!JSON.stringify(w).includes("SECRETSECRET123"));
  const text = redactUrlsInText("test sent to https://hooks.slack.com/services/T1/B2/SECRETSECRET123 -> 200");
  assert.ok(!text.includes("SECRET"));
  assert.ok(text.startsWith("test sent to https://hooks.slack.com/services/"));
  assert.ok(!JSON.stringify(sanitiseDeep({ config: { url: "mqtt://user:pw@broker:1883/x" } })).includes("pw@"));
});

test("M-23: the prune boundary is the run of oldest entries older than the cutoff", () => {
  const cutoff = new Date("2026-01-01T00:00:00Z");
  const rows = [
    { seq: 1, hash: "a", ts: new Date("2025-01-01T00:00:00Z") },
    { seq: 2, hash: "b", ts: new Date("2025-06-01T00:00:00Z") },
    { seq: 3, hash: "c", ts: new Date("2026-02-01T00:00:00Z") },
    { seq: 4, hash: "d", ts: new Date("2025-12-01T00:00:00Z") },
  ];
  assert.deepEqual(pruneBoundary(rows, cutoff), { seq: 2, hash: "b", count: 2 }, "stops at the first newer entry");
  assert.equal(pruneBoundary([rows[2]!], cutoff), null);
  assert.equal(pruneBoundary([], cutoff), null);
  // The heavy min(seq) query no longer runs under the chain lock.
  assert.doesNotMatch(src("lib/audit-store.ts"), /min\(seq\) FROM activity_logs WHERE "timestamp" >=/);
});

test("M-10 / M-13: backfill once from start-up, head ignores NULL seq, verify is batched and follows pruning", () => {
  const store = src("lib/audit-store.ts");
  assert.match(store, /BACKFILL_KEY = "audit_backfill"/);
  assert.match(store, /WHERE hash IS NOT NULL AND seq IS NOT NULL ORDER BY seq DESC LIMIT 1/);
  assert.match(store, /reason: "missing_seq"/);
  assert.match(store, /follow its new checkpoint/);
  assert.match(store, /verifyRun \?\?= runVerify/);
  // chainHead never backfills on a write any more.
  assert.doesNotMatch(store.slice(store.indexOf("async function chainHead")), /backfill\(/);
});

test("M-12: asset index, capped count, keyset export", () => {
  assert.match(src("../../../lib/db/src/schema/activity_logs.ts"), /activity_logs_asset_idx/);
  const store = src("lib/audit-store.ts");
  assert.match(store, /LIMIT \$\{AUDIT_COUNT_CAP \+ 1\}/);
  assert.match(store, /ORDER BY ts DESC, id DESC LIMIT/);
  assert.match(src("routes/activity_log.ts"), /exportAuditPage\(f, scope/);
});

test("L-16: the live feed and the Audit Log page scope entries by the same fields", () => {
  const allowed = new Set(["a1", "p1"]);
  assert.equal(auditEntryInScope({ targetId: "a1" }, allowed), true);
  assert.equal(auditEntryInScope({ targetId: "rule-9", assetId: "a1" }, allowed), true, "about an asset through asset_id");
  assert.equal(auditEntryInScope({ targetId: "x", projectId: "p1" }, allowed), true);
  assert.equal(auditEntryInScope({ targetId: "user-1" }, allowed), false);
  assert.equal(auditEntryInScope(null, allowed), false);
  assert.match(src("lib/ws-broadcast.ts"), /auditEntryInScope\(data, context\.allowedAssets\)/);
  assert.match(src("lib/audit-store.ts"), /target_id = ANY[^\n]*asset_id = ANY[^\n]*project_id = ANY/);
});

test("L-17: read-only POSTs get no generic audit entry", () => {
  assert.equal(needsSafetyNetEntry("POST", "/api/system/alerts/check", 200, false), false);
  assert.equal(needsSafetyNetEntry("POST", "/api/system/retention/preview", 200, false), false);
  assert.equal(needsSafetyNetEntry("POST", "/api/system/changes/range-preview", 200, false), false);
  assert.equal(needsSafetyNetEntry("POST", "/api/system/retention/run", 200, false), true, "real writes still recorded");
});
