#!/usr/bin/env node
/**
 * Cross-platform preinstall guard.
 * Removes stale lock files from other package managers and enforces pnpm usage.
 * Runs with bare Node.js (no npm packages available yet).
 */
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

for (const lockFile of ["package-lock.json", "yarn.lock"]) {
  const fullPath = join(root, lockFile);
  if (existsSync(fullPath)) {
    unlinkSync(fullPath);
    console.log(`Removed stale lock file: ${lockFile}`);
  }
}

const userAgent = process.env.npm_config_user_agent ?? "";
if (!userAgent.startsWith("pnpm/")) {
  console.error("Error: This project must be installed with pnpm.");
  console.error("Run: corepack enable && pnpm install");
  process.exit(1);
}
