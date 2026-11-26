/**
 * Regression tests for audit 23 Nov 2026, work package G: outbound address
 * ranges and pinned connections (I-5), broker targets (M-7) and alarm webhook
 * URLs at rest and in logs (L-8). No database and no outside network: the only
 * sockets are to a server this file starts on 127.0.0.1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// A key for the secret box, set before anything loads it.
process.env.SECRETS_ENC_KEY = Buffer.alloc(32, 7).toString("base64");

const outbound = await import("../lib/outbound-url");
const broker = await import("../lib/broker-target");
const webhook = await import("../lib/alarm-webhook");
const { classifyHost, isPrivateAddress, parseIPv6, guardedLookup, pinnedFetch, UnsafeUrlError } = outbound;

test("I-5: the ranges the audit named are no longer public", () => {
  for (const h of ["198.18.0.1", "198.19.255.254"]) assert.equal(classifyHost(h), "private", h);
  for (const h of ["224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255", "192.0.2.10", "198.51.100.1", "203.0.113.5", "192.0.0.170"]) {
    assert.equal(classifyHost(h), "forbidden", h);
  }
  for (const h of ["198.17.255.255", "198.20.0.1", "223.255.255.255", "8.8.8.8", "1.1.1.1"]) assert.equal(classifyHost(h), "public", h);
});

test("I-5: IPv4-compatible, -mapped and -translated IPv6 forms are judged by the IPv4 inside", () => {
  const cases: Array<[string, string]> = [
    ["[::127.0.0.1]", "forbidden"], ["[::7f00:1]", "forbidden"],            // compatible
    ["[::169.254.169.254]", "forbidden"], ["[::a9fe:a9fe]", "forbidden"],
    ["[::ffff:127.0.0.1]", "forbidden"], ["[::ffff:7f00:1]", "forbidden"],  // mapped
    ["[0:0:0:0:0:ffff:7f00:1]", "forbidden"], ["::ffff:10.0.0.1", "private"],
    ["[::ffff:0:127.0.0.1]", "forbidden"], ["[::ffff:0:a00:1]", "private"], // translated
    ["[64:ff9b::a9fe:a9fe]", "forbidden"], ["[64:ff9b::808:808]", "public"], // NAT64
    ["[2002:7f00:1::]", "forbidden"], ["[2002:0808:0808::1]", "public"],      // 6to4
    ["[::ffff:198.18.0.1]", "private"], ["[::ffff:224.0.0.1]", "forbidden"],
    ["[ff02::1]", "forbidden"], ["[fe80::1%eth0]", "forbidden"], ["[fd12::1]", "private"],
    ["[2001:db8::1]", "forbidden"], ["[::]", "forbidden"], ["[::1]", "forbidden"],
    ["[2001:4860:4860::8888]", "public"], ["[::8.8.8.8]", "public"],
  ];
  for (const [h, want] of cases) assert.equal(classifyHost(h), want, h);
  // The URL parser's own spelling of a compatible address is caught too.
  assert.equal(isPrivateAddress(new URL("http://[::127.0.0.1]/").hostname), true);
  assert.throws(() => outbound.assertSafeOutboundUrl("http://[::7f00:1]/"));
  assert.throws(() => outbound.assertSafeOutboundUrl("http://198.18.0.1/"));
  assert.throws(() => outbound.assertSafeOutboundUrl("http://239.1.1.1/"));
});

test("I-5: parseIPv6 expands every spelling to 16 bytes", () => {
  assert.deepEqual(parseIPv6("::1"), [...new Array(15).fill(0), 1]);
  assert.deepEqual(parseIPv6("::ffff:1.2.3.4")?.slice(10), [0xff, 0xff, 1, 2, 3, 4]);
  assert.deepEqual(parseIPv6("1:2:3:4:5:6:7:8")?.slice(0, 4), [0, 1, 0, 2]);
  assert.equal(parseIPv6("not-an-address"), null);
});

test("I-5: the guarded lookup refuses a name that resolves to loopback", async () => {
  const lookup = guardedLookup((a) => (classifyHost(a) === "public" ? null : "not public"));
  const err = await new Promise<unknown>((resolve) => {
    (lookup as unknown as (h: string, o: object, cb: (e: unknown) => void) => void)("localhost", {}, (e) => resolve(e));
  });
  assert.ok(err instanceof UnsafeUrlError, String(err));
});

test("I-5: pinnedFetch connects to the address the lookup returned and keeps the Host header", async () => {
  let seenHost = "";
  const server = http.createServer((req, res) => {
    seenHost = req.headers.host ?? "";
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => { res.writeHead(201, { "content-type": "application/json", "x-test": "1" }); res.end(JSON.stringify({ got: body })); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  let asked = "";
  // Pins "hooks.example.test" to 127.0.0.1 (the real guard would refuse it; this
  // checks the plumbing: the socket uses the lookup's answer, nothing else).
  const pin = ((host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
    asked = host;
    if (opts?.all) cb(null, [{ address: "127.0.0.1", family: 4 }]); else cb(null, "127.0.0.1", 4);
  }) as unknown as import("node:net").LookupFunction;
  try {
    const r = await pinnedFetch(new URL(`http://hooks.example.test:${port}/a/b?c=1`), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: 1 }),
      signal: AbortSignal.timeout(5000),
    }, pin);
    assert.equal(asked, "hooks.example.test");
    assert.equal(seenHost, `hooks.example.test:${port}`);
    assert.equal(r.status, 201);
    assert.equal(r.ok, true);
    assert.equal(r.headers.get("x-test"), "1");
    assert.deepEqual(await r.json(), { got: '{"x":1}' });
  } finally {
    server.close();
  }
});

test("I-5: pinnedFetch rejects with the signal's reason on timeout, like fetch", async () => {
  const server = http.createServer(() => { /* never answers */ });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const pin = ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
    if (opts?.all) cb(null, [{ address: "127.0.0.1", family: 4 }]); else cb(null, "127.0.0.1", 4);
  }) as unknown as import("node:net").LookupFunction;
  try {
    await assert.rejects(
      pinnedFetch(new URL(`http://slow.example.test:${port}/`), { signal: AbortSignal.timeout(100) }, pin),
      (e: Error) => e.name === "TimeoutError",
    );
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("M-7: broker endpoints follow the host policy", () => {
  const dflt = { allowPrivateBrokerTargets: true, allowLoopbackBrokerTargets: false };
  const strict = { allowPrivateBrokerTargets: false, allowLoopbackBrokerTargets: false };
  const ok = (e: string, p = dflt) => !("error" in broker.parseBrokerEndpoint(e, p));
  // Plant LAN brokers keep working by default.
  assert.equal(ok("mqtt://192.168.1.20:1883"), true);
  assert.equal(ok("mqtts://10.0.0.5"), true);
  assert.equal(ok("ws://broker.plant.local:8080/mqtt"), true);
  assert.equal(ok("mqtt://broker.hivemq.com"), true);
  // ...and can be refused.
  assert.equal(ok("mqtt://192.168.1.20:1883", strict), false);
  // Always refused.
  for (const e of ["mqtt://169.254.169.254:80", "mqtt://[fe80::1]:1883", "mqtt://224.0.0.1", "mqtt://0.0.0.0:1883", "mqtt://[::ffff:169.254.169.254]"]) {
    assert.equal(ok(e), false, e);
  }
  // Loopback only with its own switch.
  for (const e of ["mqtt://localhost:1883", "mqtt://127.0.0.1:1883", "mqtt://[::1]:1883", "mqtt://[::ffff:127.0.0.1]:1883"]) {
    assert.equal(ok(e), false, e);
    assert.equal(ok(e, { ...dflt, allowLoopbackBrokerTargets: true }), true, e);
  }
  // Unix sockets and unknown protocols are not brokers.
  assert.equal(ok("mqtt+unix:///var/run/x.sock"), false);
  assert.equal(ok("http://10.0.0.5"), false);
  assert.equal(ok("broker.lan:1883"), false);
});

test("M-7: the save-time check covers Azure endpoints that carry a host", () => {
  const p = { allowPrivateBrokerTargets: true, allowLoopbackBrokerTargets: false };
  assert.equal(broker.checkBrokerEndpoint("myhub.azure-devices.net", "azure_iot", p).ok, true);
  assert.equal(broker.checkBrokerEndpoint("https://169.254.169.254/", "azure_event_hub", p).ok, false);
  assert.equal(broker.checkBrokerEndpoint(null, "mqtt", p).ok, true);
  assert.equal(broker.checkBrokerEndpoint("mqtt://169.254.169.254", "mqtt", p).ok, false);
  assert.throws(() => broker.connectBroker("mqtt://169.254.169.254:1883", { clientId: "t" }), broker.BrokerTargetError);
});

test("M-7: non-admins see a generic connection error, not hosts and ports", () => {
  assert.equal(broker.publicBrokerMessage("connect ECONNREFUSED 10.0.0.5:5432"), "The connection failed. An administrator can see the details.");
  assert.equal(broker.publicBrokerMessage(null), null);
  assert.match(broker.publicBrokerMessage("Refusing broker address 169.254.169.254: it is ...")!, /^Refusing broker address/);
});

test("L-8: webhook URLs are encrypted at rest and old plaintext rows still read", () => {
  const url = "https://hooks.slack.example/services/T000/B000/secretpart";
  const sealed = webhook.sealWebhookUrl(url)!;
  assert.match(sealed, /^enc:v1:/);
  assert.equal(sealed.includes("secretpart"), false);
  assert.equal(webhook.openWebhookUrl(sealed), url);
  assert.equal(webhook.openWebhookUrl(url), url, "legacy plaintext row");
  assert.equal(webhook.sealWebhookUrl(sealed), sealed, "never double-wrapped");
  assert.equal(webhook.sealWebhookUrl(null), null);
  assert.deepEqual(webhook.withOpenWebhook({ id: "r", webhookUrl: sealed }), { id: "r", webhookUrl: url });
});

test("L-8: logs get the origin of a webhook URL only", () => {
  assert.equal(webhook.redactUrlForLog("https://h.example:8443/hook/abc?token=zzz"), "https://h.example:8443/[redacted]");
  assert.equal(webhook.redactUrlForLog("not a url"), "[redacted]");
});
