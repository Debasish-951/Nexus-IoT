/**
 * Regression tests for defects found in the November 2026 audit.
 *
 * Run with `pnpm --filter @workspace/api-server run test`. They use Node's
 * built-in test runner and need no database: a placeholder DATABASE_URL is set
 * by the script so modules that import the pool can load (nothing connects).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateAddress, assertSafeOutboundUrl } from "../lib/outbound-url";
import { redactPath } from "../lib/logger";
import { loggableError, toPublicError } from "../lib/errors";
import { parseClock } from "../routes/ingest";

test("SEC-08: IPv6 and IPv4-mapped literals are recognised as private", () => {
  for (const host of ["[::1]", "::1", "[::ffff:7f00:1]", "[::ffff:127.0.0.1]", "[fe80::1]", "[fd00::1]", "[64:ff9b::a00:1]", "127.0.0.1", "169.254.169.254", "10.1.2.3", "localhost"]) {
    assert.equal(isPrivateAddress(host), true, host);
  }
  for (const host of ["8.8.8.8", "[2001:4860:4860::8888]", "example.com"]) {
    assert.equal(isPrivateAddress(host), false, host);
  }
});

test("SEC-08: webhook URLs to private IPv6 literals are refused", () => {
  assert.throws(() => assertSafeOutboundUrl("http://[::1]:8080/"));
  assert.throws(() => assertSafeOutboundUrl("http://[::ffff:127.0.0.1]/"));
  assert.doesNotThrow(() => assertSafeOutboundUrl("https://hooks.example.com/x"));
});

test("SEC-10: tokens in URL paths are masked before logging", () => {
  assert.equal(redactPath("/api/auth/reset/abcDEF123_-"), "/api/auth/reset/[token]");
  assert.equal(redactPath("/api/auth/activation/abc"), "/api/auth/activation/[token]");
  assert.equal(redactPath("/api/ingest/e/tok123/payload"), "/api/ingest/e/[token]/payload");
  assert.equal(redactPath("/api/assets/123"), "/api/assets/123");
});

test("SEC-21 / FUN-30: wrapped database errors map to 409 and never log parameters", () => {
  const pgError = Object.assign(new Error('duplicate key value violates unique constraint "users_email_unique"'), {
    code: "23505", constraint: "users_email_unique", detail: "Key (email)=(someone@example.com) already exists.",
  });
  const wrapped = Object.assign(new Error("Failed query: update users set email = $1\nparams: someone@example.com"), {
    query: "update users set email = $1", params: ["someone@example.com"], cause: pgError,
  });
  assert.equal(toPublicError(wrapped, "test").status, 409);
  const logged = JSON.stringify(loggableError(wrapped));
  assert.ok(!logged.includes("someone@example.com"), logged);
  assert.ok(logged.includes("23505"));
});

test("FUN-06: device clock fields of every common shape are read", () => {
  const ms = Date.UTC(2026, 10, 1, 8, 0, 0);
  assert.equal(parseClock(ms)?.getTime(), ms);
  assert.equal(parseClock(ms / 1000)?.getTime(), ms);
  assert.equal(parseClock(String(ms))?.getTime(), ms);
  assert.equal(parseClock("2026-11-01 08:00:00Z")?.getTime(), ms);
  assert.equal(parseClock("not a date"), undefined);
  assert.equal(parseClock({}), undefined);
  assert.equal(parseClock(Date.now() + 60 * 60 * 1000), undefined, "an hour in the future is refused");
});
