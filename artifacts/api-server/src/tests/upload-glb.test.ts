/**
 * Upload type detection for binary glTF (.glb) models, used by Live Twin to keep
 * a customer's own 3D model with the twin. Same runner as the other tests: no
 * database is touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectType } from "../lib/upload/file-types";

function glb(json: string, binary: Buffer = Buffer.alloc(0)): Buffer {
  const j = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, " "), "utf8");
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "latin1");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + j.length + binary.length, 8);
  header.writeUInt32LE(j.length, 12);
  header.write("JSON", 16, "latin1");
  return Buffer.concat([header, j, binary]);
}

test("a GLB is recognised from its bytes as a 3D model, not an image", () => {
  const r = detectType(glb('{"asset":{"version":"2.0"}}'), "application/octet-stream");
  assert.equal(r.ok, true);
  assert.equal(r.type?.mime, "model/gltf-binary");
  assert.equal(r.type?.extension, ".glb");
  assert.equal(r.type?.isImage, false);
});

test("geometry bytes after the JSON chunk that happen to contain \"MZ\" do not reject a GLB", () => {
  const geometry = Buffer.alloc(512, 0x11);
  geometry.write("MZ", 100, "latin1");
  geometry.write("#!/", 300, "latin1");
  const r = detectType(glb('{"asset":{"version":"2.0"}}', geometry));
  assert.equal(r.ok, true);
});

test("markup inside a GLB's JSON chunk is still refused", () => {
  const r = detectType(glb('{"asset":{"version":"2.0","generator":"<script>alert(1)</script>"}}'));
  assert.equal(r.ok, false);
});

test("a glTF version 1 or a header without a JSON chunk is not accepted", () => {
  const v1 = glb('{"asset":{}}'); v1.writeUInt32LE(1, 4);
  assert.equal(detectType(v1).ok, false);
  const noJson = glb('{"asset":{}}'); noJson.write("BIN\0", 16, "latin1");
  assert.equal(detectType(noJson).ok, false);
});

test("I-6: markup beyond the first 4 KB of a GLB is refused by the full-file scan", async () => {
  const { scanGlbBody } = await import("../lib/upload/file-types");
  const longJson = `{"asset":{"version":"2.0"},"extras":"${"a".repeat(6000)}<script>x</script>"}`;
  const inJson = glb(longJson);
  assert.equal(detectType(inJson.subarray(0, 4096)).ok, true, "head alone does not see it");
  assert.equal(scanGlbBody(inJson).ok, false);

  const geometry = Buffer.alloc(100_000, 0x11);
  geometry.write("<HTML><body>", 90_000, "latin1");
  assert.equal(scanGlbBody(glb('{"asset":{"version":"2.0"}}', geometry)).ok, false);
});

test("I-6: random geometry with short markers still passes the full-file scan", async () => {
  const { scanGlbBody } = await import("../lib/upload/file-types");
  const geometry = Buffer.alloc(200_000);
  for (let i = 0; i < geometry.length; i++) geometry[i] = (i * 2654435761) >>> 24;
  geometry.write("MZ", 1000, "latin1");
  geometry.write("#!/", 5000, "latin1");
  geometry.write("<svg", 9000, "latin1");
  assert.equal(scanGlbBody(glb('{"asset":{"version":"2.0"}}', geometry)).ok, true);
});
