#!/usr/bin/env node
/**
 * Dependency audit gate for CI.
 *
 * `pnpm audit` alone is not usable as a build gate: it exits non-zero for a LOW
 * advisory in a dev-only tool exactly as it does for a HIGH one in the request
 * path, so the first unfixable finding makes the pipeline permanently red and
 * the step gets removed. This wraps it with the two things that make the gate
 * survivable:
 *
 *   1. A severity threshold, so the build fails on what matters.
 *   2. An allowlist with an EXPIRY DATE and a stated reason, for advisories with
 *      no available fix.
 *
 * The expiry is the important part. A permanent exception is how a known
 * vulnerability becomes permanent; an entry that expires forces the decision to
 * be made again, with fresh information about whether a fix has shipped.
 *
 *   node scripts/audit-ci.mjs                    fail on high or above
 *   node scripts/audit-ci.mjs --level moderate   stricter
 *   node scripts/audit-ci.mjs --report           list everything, never fail
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const ALLOWLIST_PATH = "audit-allowlist.json";
const LEVELS = ["low", "moderate", "high", "critical"];

const args = process.argv.slice(2);
const reportOnly = args.includes("--report");
const levelArg = args.includes("--level") ? args[args.indexOf("--level") + 1] : "high";
const threshold = LEVELS.indexOf(levelArg);
if (threshold === -1) {
  console.error(`Unknown --level "${levelArg}". Expected one of: ${LEVELS.join(", ")}`);
  process.exit(2);
}

// ── Run the audit ────────────────────────────────────────────────────────────
// pnpm audit exits non-zero when it finds anything, so the throw is expected and
// the output is still what we want.
let raw = "";
try {
  raw = execSync("pnpm audit --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
} catch (err) {
  raw = err.stdout ?? "";
}
if (!raw.trim()) {
  console.error("audit-ci: pnpm audit produced no output — treating as a failure rather than a pass.");
  process.exit(2);
}

let data;
try {
  data = JSON.parse(raw.slice(raw.indexOf("{")));
} catch (err) {
  console.error("audit-ci: could not parse audit output:", err.message);
  process.exit(2);
}

const advisories = Object.values(data.advisories ?? {});

// ── Allowlist ────────────────────────────────────────────────────────────────
let allowlist = [];
if (existsSync(ALLOWLIST_PATH)) {
  try {
    allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")).allow ?? [];
  } catch (err) {
    console.error(`audit-ci: ${ALLOWLIST_PATH} is not valid JSON — refusing to run with an unreadable allowlist.`);
    process.exit(2);
  }
}

const today = new Date().toISOString().slice(0, 10);
const expired = [];
function allowanceFor(adv) {
  const entry = allowlist.find((a) => a.id === String(adv.id) || a.ghsa === adv.github_advisory_id || a.module === adv.module_name);
  if (!entry) return null;
  if (!entry.expires || entry.expires < today) { expired.push({ entry, adv }); return null; }
  return entry;
}

// ── Classify ─────────────────────────────────────────────────────────────────
const blocking = [];
const allowed = [];
const belowThreshold = [];

for (const adv of advisories) {
  const sev = LEVELS.indexOf(adv.severity);
  const allowance = allowanceFor(adv);
  if (allowance) { allowed.push({ adv, allowance }); continue; }
  if (sev < threshold) { belowThreshold.push(adv); continue; }
  blocking.push(adv);
}

// ── Report ───────────────────────────────────────────────────────────────────
const line = (adv) =>
  `  [${adv.severity.toUpperCase().padEnd(8)}] ${String(adv.module_name).padEnd(20)} ${String(adv.title ?? "").slice(0, 60)}\n` +
  `             installed: ${[...new Set((adv.findings ?? []).map((f) => f.version))].join(", ") || "?"}` +
  `   patched: ${adv.patched_versions === "<0.0.0" ? "NO FIX AVAILABLE" : adv.patched_versions}\n` +
  `             ${adv.url ?? ""}`;

console.log(`audit-ci: ${advisories.length} advisory/advisories, failing at "${levelArg}" and above\n`);

if (blocking.length) {
  console.log(`BLOCKING (${blocking.length}):`);
  for (const a of blocking) console.log(line(a));
  console.log();
}
if (allowed.length) {
  console.log(`ALLOWED (${allowed.length}) — each expires and must be re-justified:`);
  for (const { adv, allowance } of allowed) {
    console.log(`  [${adv.severity}] ${adv.module_name} — expires ${allowance.expires}`);
    console.log(`             reason: ${allowance.reason}`);
  }
  console.log();
}
if (belowThreshold.length) {
  console.log(`BELOW THRESHOLD (${belowThreshold.length}): ` +
    belowThreshold.map((a) => `${a.module_name}(${a.severity})`).join(", ") + "\n");
}
if (expired.length) {
  console.log(`EXPIRED ALLOWLIST ENTRIES (${expired.length}) — these no longer suppress anything:`);
  for (const { entry, adv } of expired) {
    console.log(`  ${adv.module_name}: expired ${entry.expires ?? "(no expiry set)"} — ${entry.reason}`);
  }
  console.log();
}

if (reportOnly) {
  console.log("audit-ci: --report, exiting 0 regardless of findings.");
  process.exit(0);
}
if (blocking.length > 0) {
  console.error(
    `audit-ci: FAILED — ${blocking.length} advisory/advisories at ${levelArg} or above.\n\n` +
    "  Remediation, in order of preference:\n" +
    "    1. Raise the DIRECT parent to a release that already depends on a patched child.\n" +
    "       This is almost always the right fix and needs no override.\n" +
    "    2. If no such release exists, add a bounded override in pnpm-workspace.yaml.\n" +
    "       Bound it to the current major — a pnpm override REPLACES the requested\n" +
    "       spec, so an unbounded '>=' is an unreviewed major upgrade, not a patch.\n" +
    "    3. If the package is unmaintained, replace it. Check the advisory text —\n" +
    "       it often names a maintained fork.\n" +
    "    4. Only if none of the above apply, add a dated entry to audit-allowlist.json\n" +
    "       explaining why the advisory is not reachable in this application.\n",
  );
  process.exit(1);
}

console.log("audit-ci: PASSED");
process.exit(0);
