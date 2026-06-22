#!/usr/bin/env node
/**
 * Cross-platform post-merge setup script.
 * Replaces post-merge.sh so it runs on Windows, Linux, and macOS.
 */
import { execSync } from "node:child_process";

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

run("pnpm install --frozen-lockfile");
run("pnpm --filter db push");
