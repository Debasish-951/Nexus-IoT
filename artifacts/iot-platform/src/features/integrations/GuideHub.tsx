import { useState } from "react";
import { BookOpen, ShieldCheck, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FEATURES } from "@/lib/features";
import { useT } from "@/i18n";
import IntegrationGuideClassic from "@/pages/NodeRedDocs";
import { HubTabs, PageHead, Pill, Notice, ErrorLine, useJson, send } from "./shared";

/**
 * Integration Hub → Integration Guide. The original guide is the first tab,
 * unchanged. New: the third-party API reference (read live from
 * /api/v1/openapi.json) and webhook signature help with a checker.
 */

interface OpenApi {
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, { summary: string; "x-scope"?: string; parameters?: { name: string; in: string; description?: string }[]; requestBody?: unknown }>>;
  "x-webhooks"?: { description: string };
}

export default function GuideHub() {
  if (FEATURES.classicIntegrationHub) return <IntegrationGuideClassic />;
  return (
    <HubTabs tabs={[{ id: "guide", label: "Guide" }, { id: "api", label: "API v1 reference" }, { id: "webhooks", label: "Webhook signatures" }]}>
      {(tab) => tab === "guide" ? <IntegrationGuideClassic />
        : <div className="p-6 space-y-4">{tab === "api" ? <ApiReference /> : <Webhooks />}</div>}
    </HubTabs>
  );
}

const METHOD_TONE: Record<string, "green" | "blue" | "amber" | "red"> = { get: "green", post: "blue", put: "amber", delete: "red" };

function ApiReference() {
  const t = useT();
  const spec = useJson<OpenApi>("/api/v1/openapi.json");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const download = () => {
    if (!spec.data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(spec.data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "integration-api-v1.openapi.json"; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <>
      <PageHead icon={BookOpen} title="API v1 reference" subtitle="The read and write API for third-party systems. Hand the OpenAPI file to the integrator."
        actions={<Button size="sm" variant="outline" onClick={download} disabled={!spec.data}><Download className="w-4 h-4 mr-1.5" />{t("Download OpenAPI")}</Button>} />
      <ErrorLine error={spec.error} onRetry={spec.reload} />
      {spec.data && (
        <>
          <Notice>{spec.data.info.description}</Notice>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-3 space-y-1">
              <div className="text-sm font-medium">{t("1. Authenticate")}</div>
              <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto">{`# with the client secret
curl -H "X-API-Key: <secret>" ${origin}/api/v1/assets

# or with a short-lived OAuth token
curl -X POST ${origin}/api/oauth/token \\
  -d grant_type=client_credentials -d client_id=<id> -d client_secret=<secret>`}</pre>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 space-y-1">
              <div className="text-sm font-medium">{t("2. Write safely")}</div>
              <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto">{`curl -X POST ${origin}/api/v1/alarms/<id>/acknowledge \\
  -H "X-API-Key: <secret>" \\
  -H "Idempotency-Key: 7f9c-ack-1" \\
  -H "Content-Type: application/json" \\
  -d '{"note":"Work order WO-1182"}'`}</pre>
              <p className="text-[11px] text-muted-foreground">{t("Retrying with the same Idempotency-Key returns the first answer instead of acting twice.")}</p>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="px-3 py-2 font-medium">{t("Endpoint")}</th><th className="px-3 py-2 font-medium">{t("Scope")}</th><th className="px-3 py-2 font-medium">{t("What it does")}</th><th className="px-3 py-2 font-medium">{t("Parameters")}</th>
              </tr></thead>
              <tbody>
                {Object.entries(spec.data.paths).flatMap(([path, ops]) => Object.entries(ops).map(([method, op]) => (
                  <tr key={method + path} className="border-b border-border/60 align-top">
                    <td className="px-3 py-2 whitespace-nowrap"><Pill tone={METHOD_TONE[method] ?? "grey"}>{method.toUpperCase()}</Pill> <code className="text-xs">/api{path}</code></td>
                    <td className="px-3 py-2"><code className="text-xs">{op["x-scope"] ?? t("none")}</code></td>
                    <td className="px-3 py-2">{op.summary}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{(op.parameters ?? []).filter((p) => p.in !== "path").map((p) => p.name).join(", ") || "—"}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Webhooks() {
  const t = useT();
  const [secret, setSecret] = useState("");
  const [ts, setTs] = useState("");
  const [body, setBody] = useState("");
  const [sig, setSig] = useState("");
  const [result, setResult] = useState<{ valid: boolean; expected: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const check = async () => {
    setErr(null);
    try { setResult(await send("POST", "/api/integration/verify-signature", { secret, timestamp: Number(ts), body, signature: sig })); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <>
      <PageHead icon={ShieldCheck} title="Webhook signatures" subtitle="How a receiver proves an event really came from this platform" />
      <Notice>{t("Destinations in queued mode with signing on send X-Nexus-Timestamp and X-Nexus-Signature. The signature is sha256= followed by HMAC-SHA256(secret, timestamp + \".\" + raw body). Reject a timestamp older than 5 minutes, and use the delivery id to drop duplicates: a retried event keeps its id.")}</Notice>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-sm font-medium mb-1">Node.js</div>
          <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto">{`import crypto from "node:crypto";
// Use the RAW body, before JSON.parse.
function verify(secret, rawBody, headers) {
  const ts = Number(headers["x-nexus-timestamp"]);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret)
    .update(ts + "." + rawBody).digest("hex");
  const given = String(headers["x-nexus-signature"] || "");
  return expected.length === given.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}`}</pre>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-sm font-medium mb-1">Python</div>
          <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto">{`import hmac, hashlib, time

def verify(secret: str, raw_body: bytes, headers) -> bool:
    ts = int(headers["X-Nexus-Timestamp"])
    if abs(time.time() - ts) > 300:
        return False
    msg = f"{ts}.".encode() + raw_body
    expected = "sha256=" + hmac.new(secret.encode(), msg,
                                    hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected,
                               headers["X-Nexus-Signature"])`}</pre>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">{t("Check a signature")}</div>
        <p className="text-xs text-muted-foreground">{t("Paste what your receiver got. Use a test secret, not a live one: what you type is sent to this server to compute the result.")}</p>
        <div className="grid gap-3 md:grid-cols-3">
          <div><Label className="text-xs">{t("Signing secret")}</Label><Input className="h-8 font-mono" value={secret} onChange={(e) => setSecret(e.target.value)} /></div>
          <div><Label className="text-xs">X-Nexus-Timestamp</Label><Input className="h-8 font-mono" value={ts} onChange={(e) => setTs(e.target.value)} /></div>
          <div><Label className="text-xs">X-Nexus-Signature</Label><Input className="h-8 font-mono" value={sig} onChange={(e) => setSig(e.target.value)} /></div>
        </div>
        <div><Label className="text-xs">{t("Raw body")}</Label><Textarea rows={4} className="font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <Button size="sm" onClick={check} disabled={!secret || !ts}>{t("Check")}</Button>
        {err && <ErrorLine error={err} />}
        {result && (result.valid
          ? <Notice tone="ok">{t("Signature is valid.")}</Notice>
          : <Notice tone="warn">{t("Signature does not match. Expected")} <code className="text-xs break-all">{result.expected}</code>. {t("Usually the body was re-serialised before checking: verify the raw bytes.")}</Notice>)}
      </div>
    </>
  );
}
