#!/usr/bin/env node
/**
 * Scan tracked files for committed credentials.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * `.env.example` was committed carrying the real DATABASE_URL password and the
 * real SESSION_SECRET — byte-identical to the live `.env`. Nobody did anything
 * careless: someone copied `.env` to `.env.example` so the next person would
 * know which keys to set, which is the right instinct and produced a published
 * credential. It survived four commits because nothing was looking.
 *
 * Removing the values fixes today. This stops it happening again, which is the
 * part that actually matters.
 *
 *   node scripts/scan-secrets.mjs            scan tracked files
 *   node scripts/scan-secrets.mjs --staged   scan what is about to be committed
 *
 * Exits non-zero on a finding, so it works as a pre-commit hook or a CI step.
 *
 * Deliberately conservative. The first version of this file reported three
 * findings and all three were noise — a regex literal named
 * PASSWORD_CHANGE_EXEMPT, a TypeScript type annotation on TOKEN_ERRORS, and a
 * documented example inside a comment. A scanner that cries wolf is one people
 * learn to pass with --no-verify, so the rules below are split by file type and
 * comments are skipped.
 */

import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const staged = process.argv.includes("--staged");

/** Files that legitimately describe secrets without containing them. */
const ALLOWED_PATHS = [
  /(^|\/)scripts\/scan-secrets\.mjs$/,
  /(^|\/)docs\//,
  /\.md$/,
];

/** Values that are obviously not real credentials. */
const PLACEHOLDER =
  /^(|\s*|<.*>|\$\{.*\}|USER:PASSWORD|PASSWORD|USERNAME|CHANGEME|changeme|your[-_].*|xxx+|\.\.\.|TODO|example.*|p%40ssw0rd)$/i;

const RULES = [
  {
    name: "Database URL with an inline password",
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:([^\s@/]+)@/g,
    capture: 1,
  },
  {
    // Source files: the value must be a QUOTED string literal. Without that,
    // `const TOKEN_ERRORS: Record<string, …>` matches on its type annotation and
    // `const PASSWORD_CHANGE_EXEMPT = /^\/auth\//` matches on a regex literal.
    name: "Secret assigned in source",
    re: /\b([A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY|ENC_KEY)[A-Za-z0-9_]*)\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/g,
    capture: 2,
    nameCapture: 1,
    sourceOnly: true,
  },
  {
    // Config files use the unquoted KEY=value convention, so quotes cannot be
    // required there.
    name: "Secret assigned in a config file",
    re: /^[ \t]*(?:export[ \t]+)?([A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY|ENC_KEY)[A-Za-z0-9_]*)[ \t]*=[ \t]*["']?([^\s"'#]{8,})["']?/gm,
    capture: 2,
    nameCapture: 1,
    configOnly: true,
  },
  {
    name: "Private key block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    capture: 0,
  },
  {
    name: "AWS access key id",
    re: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/g,
    capture: 1,
  },
  {
    name: "Slack / GitHub / Stripe style token",
    re: /\b(xox[baprs]-[0-9A-Za-z-]{10,}|gh[pousr]_[0-9A-Za-z]{20,}|sk_live_[0-9A-Za-z]{16,})\b/g,
    capture: 1,
  },
];

function trackedFiles() {
  const cmd = staged
    ? "git diff --cached --name-only --diff-filter=ACM"
    : "git ls-files";
  return execSync(cmd, { encoding: "utf8" })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

/** Skip anything binary or large — a 3 MB lockfile is not where secrets hide. */
function readable(path) {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > 512 * 1024) return null;
    const buf = readFileSync(path);
    if (buf.includes(0)) return null; // binary
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

const findings = [];

for (const file of trackedFiles()) {
  if (ALLOWED_PATHS.some((re) => re.test(file))) continue;
  const content = readable(file);
  if (content === null) continue;

  const lines = content.split("\n");
  const isConfig = /(^|\/)(\.env|Dockerfile)|\.(env|ya?ml|ini|conf|cfg|sh|properties|toml)(\.|$)/i.test(file);

  for (const rule of RULES) {
    if (rule.sourceOnly && isConfig) continue;
    if (rule.configOnly && !isConfig) continue;

    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(content)) !== null) {
      const value = m[rule.capture] ?? m[0];
      if (PLACEHOLDER.test(value)) continue;
      if (/^\$\{?[A-Za-z0-9_]+\}?$/.test(value)) continue;   // ${OTHER_VAR}
      if (/^process\.env\./.test(value)) continue;
      if (/^[/{[(]/.test(value)) continue;                    // regex / object / array literal

      const lineNo = content.slice(0, m.index).split("\n").length;
      const lineText = lines[lineNo - 1] ?? "";

      // A documented example lives in a comment: `.env.example` explains
      // percent-encoding with a sample password. That is instruction, not a
      // credential.
      if (/^\s*(#|\/\/|\*|--)/.test(lineText)) continue;

      findings.push({
        file,
        line: lineNo,
        rule: rule.name,
        label: rule.nameCapture ? m[rule.nameCapture] : null,
        // NEVER prints the value — a scanner that echoes secrets into a CI log
        // has moved the leak rather than reported it.
        preview: `${value.length} chars, starts "${value.slice(0, 2)}…"`,
      });
    }
  }
}

if (findings.length === 0) {
  console.log(`✓ scan-secrets: no credentials found in ${staged ? "staged" : "tracked"} files`);
  process.exit(0);
}

console.error(`\n✗ scan-secrets: ${findings.length} possible credential(s) in ${staged ? "staged" : "tracked"} files\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.rule}${f.label ? ` (${f.label})` : ""} — ${f.preview}`);
}
console.error(
  "\n  If a value here is real:\n" +
  "    1. Rotate it. It is in the git history, and deleting the file does not recall it.\n" +
  "    2. Replace it with a placeholder in the tracked file.\n" +
  "    3. Keep the real value in .env (gitignored), or in a file referenced by <NAME>_FILE.\n",
);
process.exit(1);
