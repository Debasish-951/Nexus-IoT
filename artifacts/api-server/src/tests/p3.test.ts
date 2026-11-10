/**
 * Regression tests for the low-severity (P3) findings of the November 2026 audit.
 *
 * Pure logic only — no database. See audit-fixes.test.ts for how the placeholder
 * DATABASE_URL lets modules that import the pool load without connecting.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { identityKeysToReset } from "../middleware/rateLimit";
import { loginOriginAllowed } from "../routes/auth";
import { sessionCookieOptions } from "../lib/sessions";
import { maskWebhookUrl, isMaskedWebhookUrl, WEBHOOK_MASK } from "../routes/alarm_rules";
import { verdictAllowsDownload } from "../lib/upload/scanner";
import { authConfig } from "../lib/auth-config";
import { readAttributeDefinitions } from "../routes/asset_templates";
import { AttributeDefinitionsSchema } from "../schemas/common";
import { emailChanged } from "../routes/users";
import { legacyCredentialMatches } from "../lib/password";

test("SEC-33: a successful sign-in clears only the account and user counters", () => {
  const keys = identityKeysToReset(" Admin ", "user-1");
  assert.deepEqual(keys, [{ dim: "account", key: "admin" }, { dim: "user", key: "user-1" }]);
  assert.ok(!keys.some((k) => k.dim === "ip" || k.dim === "subnet"));
  assert.deepEqual(identityKeysToReset(null, null), []);
});

test("SEC-29: login refuses cross-site browser posts and allows same-site and non-browser ones", () => {
  const allowed = ["http://localhost:5173", "https://iot.example.com"];
  const check = (origin?: string, referer?: string, host = "iot.example.com") =>
    loginOriginAllowed({ origin, referer, host, allowed });

  assert.equal(check(), true, "no Origin and no Referer: curl or a script");
  assert.equal(check("https://iot.example.com"), true, "configured public origin");
  assert.equal(check("http://localhost:5173", undefined, "localhost:8080"), true, "dev SPA in CORS_ORIGINS");
  assert.equal(check("https://other.example.net", undefined, "other.example.net"), true, "same host as the request");
  assert.equal(check("https://evil.example"), false, "foreign origin");
  assert.equal(check("null"), false, "opaque origin");
  assert.equal(check(undefined, "https://evil.example/page"), false, "foreign Referer without Origin");
  assert.equal(check(undefined, "https://iot.example.com/login"), true, "own Referer without Origin");
  assert.equal(check("https://iot.example.com", undefined, "127.0.0.1:8080"), true, "allow-listed origin wins over Host");
  assert.equal(check("https://iot.example.com:8443", undefined, "iot.example.com"), true, "nginx $host carries no port");
  assert.equal(check("https://iot.example.com:8443", undefined, "iot.example.com:9000"), false, "port compared when Host has one");
  assert.equal(check("https://evil.example:9000", undefined, "iot.example.com:9000"), false);
  assert.equal(check("javascript:alert(1)"), false);
});

test("SEC-34: only a remembered sign-in gets a persistent cookie", () => {
  assert.equal("maxAge" in sessionCookieOptions(false, 3_600_000), false);
  assert.equal(sessionCookieOptions(true, 3_600_000).maxAge, 3_600_000);
  assert.equal(sessionCookieOptions(true, -5).maxAge, 0);
});

test("SEC-31: webhook URLs are masked and a mask is never mistaken for a URL", () => {
  const masked = maskWebhookUrl("https://hooks.slack.com/services/T000/B000/XXXXSECRET");
  assert.equal(masked, `https://hooks.slack.com/${WEBHOOK_MASK}`);
  assert.ok(!masked!.includes("SECRET"));
  assert.equal(isMaskedWebhookUrl(masked), true);
  assert.equal(isMaskedWebhookUrl("https://hooks.slack.com/services/T000"), false);
  assert.equal(maskWebhookUrl(null), null);
  assert.equal(maskWebhookUrl("not a url"), WEBHOOK_MASK);
});

test("SEC-32: downloads follow the scan mode and never serve infected files", () => {
  for (const mode of ["off", "optional", "required"] as const) {
    assert.equal(verdictAllowsDownload("infected", mode), false, mode);
    assert.equal(verdictAllowsDownload("clean", mode), true, mode);
  }
  assert.equal(verdictAllowsDownload("skipped", "required"), false);
  assert.equal(verdictAllowsDownload("error", "required"), false);
  assert.equal(verdictAllowsDownload(null, "required"), false);
  assert.equal(verdictAllowsDownload("skipped", "optional"), true);
  assert.equal(verdictAllowsDownload("error", "optional"), true);
  assert.equal(verdictAllowsDownload("skipped", "off"), true);
});

test("SEC-39: the code default minimum password length is 12", () => {
  if (process.env.AUTH_PASSWORD_MIN_LENGTH) return; // operator override in this shell
  assert.equal(authConfig.password.minLength, 12);
});

test("SEC-37: an email change is detected case-insensitively", () => {
  assert.equal(emailChanged("a@example.com", "b@example.com"), true);
  assert.equal(emailChanged("a@example.com", " A@Example.com "), false);
  assert.equal(emailChanged("a@example.com", undefined), false);
});

test("SEC-28: a legacy cleartext value is recognised only for the exact password", () => {
  assert.equal(legacyCredentialMatches("hunter2", "hunter2"), true);
  assert.equal(legacyCredentialMatches("hunter3", "hunter2"), false);
  assert.equal(legacyCredentialMatches("x", null), false);
  assert.equal(legacyCredentialMatches("scrypt$1$1$1$a$b", "scrypt$1$1$1$a$b"), false, "never for a real hash");
});

test("DB-08: template definitions are read from old string rows and validated on write", () => {
  const defs = [{ name: "Temp", type: "dynamic", dataType: "double", tagName: "temp", uom: "C" }];
  assert.deepEqual(readAttributeDefinitions(defs), defs);
  assert.deepEqual(readAttributeDefinitions(JSON.stringify(defs)), defs, "single-encoded string row");
  assert.deepEqual(readAttributeDefinitions(JSON.stringify(JSON.stringify(defs))), defs, "double-encoded string row");
  assert.deepEqual(readAttributeDefinitions("not json"), []);
  assert.deepEqual(readAttributeDefinitions(null), []);

  const ok = AttributeDefinitionsSchema.safeParse([
    { name: " Temp ", type: "Dynamic", dataType: "DOUBLE", decimalPlaces: 2, extra: "dropped" },
    { name: "Device ID", type: "deviceid", dataType: "text", value: "dev-1" },
  ]);
  assert.ok(ok.success);
  assert.equal(ok.data[0].name, "Temp");
  assert.equal(ok.data[0].type, "dynamic");
  assert.equal("extra" in ok.data[0], false);

  assert.equal(AttributeDefinitionsSchema.safeParse("[]").success, false, "a string is not a list");
  assert.equal(AttributeDefinitionsSchema.safeParse([{ name: "", type: "dynamic", dataType: "text" }]).success, false);
  assert.equal(AttributeDefinitionsSchema.safeParse([{ name: "x", type: "bogus", dataType: "text" }]).success, false);
  assert.equal(AttributeDefinitionsSchema.safeParse([{ name: "x", type: "runtime", dataType: "number", value: "a".repeat(2001) }]).success, false);
});

test("SEC-33 follow-up: a successful sign-in is refunded on shared counters, failures stay", async () => {
  const { RateLimitStore } = await import("../lib/rate-limit-store");
  const store = new RateLimitStore("test-refund");
  const max = 10, windowMs = 300_000;
  // 15 successful sign-ins from one office address: each is charged, then refunded.
  for (let i = 0; i < 15; i++) {
    assert.equal(store.hit("10.0.0.1", max, windowMs).allowed, true, `sign-in ${i + 1}`);
    store.refund("10.0.0.1");
  }
  // Failures are not refunded and still reach the limit.
  for (let i = 0; i < 10; i++) store.hit("10.0.0.1", max, windowMs);
  assert.equal(store.peek("10.0.0.1", max, windowMs).allowed, false);
});

test("PERF-04: slow WebSocket clients skip telemetry, then are closed; alarms still go out", async () => {
  const { sendDecision } = await import("../lib/ws-broadcast");
  assert.equal(sendDecision(0, "telemetry"), "send");
  assert.equal(sendDecision(2 * 1024 * 1024, "telemetry"), "skip");
  assert.equal(sendDecision(2 * 1024 * 1024, "alarm"), "send");
  assert.equal(sendDecision(9 * 1024 * 1024, "alarm"), "close");
});
