#!/usr/bin/env node
/**
 * Generate the settings for one company's separate installation.
 *
 * Each company gets its own server and database, because the application has no
 * separation between companies inside one database. This script makes sure no two
 * installations share a password or key. It only writes two files. It does not
 * contact any server or database.
 *
 * Usage:
 *   node scripts/new-company-install.mjs --company "Acme Textiles" --domain iot.acme.com
 *
 * Options:
 *   --company        Company name (required)
 *   --domain         Web address of this installation (required)
 *   --out            Output folder (default: ../company-installs next to this repository)
 *   --db-host        Database host (default: localhost)
 *   --db-port        Database port (default: 5432)
 *   --support-email  Address shown in emails as the contact (optional)
 *
 * See docs/operations/new-company-installation.md for the full procedure.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function readArgs(argv) {
  const known = new Set(["company", "domain", "out", "db-host", "db-port", "support-email"]);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag?.startsWith("--") || !known.has(flag.slice(2))) fail(`Unknown option "${flag}".`);
    if (value === undefined || value.startsWith("--")) fail(`Option "${flag}" needs a value.`);
    args[flag.slice(2)] = value;
  }
  return args;
}

const args = readArgs(process.argv.slice(2));
const company = args.company?.trim();
const domain = args.domain?.trim().toLowerCase();
const dbHost = args["db-host"] ?? "localhost";
const dbPort = args["db-port"] ?? "5432";
const supportEmail = args["support-email"] ?? "";

if (!company) fail('--company is required, for example --company "Acme Textiles".');
if (!domain) fail("--domain is required, for example --domain iot.acme.com.");
// These values go into a settings file, so characters with meaning there are refused.
if (!/^[\p{L}\p{N} .&'-]{2,80}$/u.test(company)) {
  fail("--company may contain only letters, numbers, spaces and . & ' -");
}
if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
  fail("--domain must be a web address such as iot.acme.com, without https://");
}
if (!/^[a-z0-9.-]+$/i.test(dbHost)) fail("--db-host contains invalid characters.");
if (!/^\d{1,5}$/.test(dbPort)) fail("--db-port must be a number.");
if (supportEmail && !/^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/.test(supportEmail)) fail("--support-email is not a valid address.");

const slug = company.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
if (!slug) fail("--company must contain at least one English letter or number.");

// Secrets must never reach the repository, even by accident.
const outRoot = path.resolve(args.out ?? path.join(REPO_ROOT, "..", "company-installs"));
const relative = path.relative(REPO_ROOT, outRoot);
if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
  fail("--out must be outside this repository, because the files contain passwords.");
}
const outDir = path.join(outRoot, slug);
if (fs.existsSync(outDir)) {
  fail(`${outDir} already exists. It is not replaced, because that would discard this company's keys.`);
}

// Hex only: safe inside both a connection URL and a SQL string.
const dbPassword = crypto.randomBytes(32).toString("hex");
const dbName = `integrated_suite_${slug}`;

const env = `# Settings for ${company}. Contains passwords: keep private and back up securely.
# Never reuse any value here for another company.
NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://${dbName}:${dbPassword}@${dbHost}:${dbPort}/${dbName}
SESSION_SECRET=${crypto.randomBytes(48).toString("base64url")}

# Protects stored webhook and MQTT credentials. Losing it makes them unreadable.
SECRETS_ENC_KEY=${crypto.randomBytes(32).toString("base64")}

AUTH_PUBLIC_URL=https://${domain}
CORS_ORIGINS=https://${domain}
AUTH_PRODUCT_NAME="Integrated Suite"
AUTH_SUPPORT_EMAIL=${supportEmail}

# REQUIRED: the API refuses to start until SMTP_HOST is filled in.
AUTH_EMAIL_TRANSPORT=smtp
AUTH_EMAIL_FROM="${company} <no-reply@${domain}>"
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=

UPLOAD_DIR=/var/lib/nexus/uploads
UPLOAD_SCAN_MODE=off

# Left empty on purpose, which keeps AI Advisor switched off. Turning it on sends
# this company's asset names, metric names, readings and questions to Groq. Only
# set it after the company agrees, and use a key that belongs to this company.
GROQ_API_KEY=
`;

const sql = `-- Run once as a PostgreSQL administrator, on this company's own database server:
--   psql -U postgres -f create-database.sql
CREATE ROLE ${dbName} LOGIN PASSWORD '${dbPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE ${dbName} OWNER ${dbName};
REVOKE ALL ON DATABASE ${dbName} FROM PUBLIC;
`;

fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(outDir, ".env"), env, { mode: 0o600 });
fs.writeFileSync(path.join(outDir, "create-database.sql"), sql, { mode: 0o600 });

console.log(`Created settings for ${company}:`);
console.log(`  ${path.join(outDir, ".env")}`);
console.log(`  ${path.join(outDir, "create-database.sql")}`);
console.log("");
console.log("Next: fill in the SMTP values in .env, then follow");
console.log("docs/operations/new-company-installation.md");
