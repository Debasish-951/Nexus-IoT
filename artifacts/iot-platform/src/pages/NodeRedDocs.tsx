import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, Copy, CheckCircle2, Code2, ExternalLink, Lock,
  Terminal, AlertCircle, Info, GitMerge,
  Radio, Package,
} from "lucide-react";

const BASE_URL = window.location.origin;
const INGEST_URL = `${BASE_URL}/api/ingest/payload`;

function CopyButton({ text, label }: { text: string; label?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: label ? `Copied: ${label}` : "Copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button onClick={copy} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      {label && <span>{copied ? "Copied!" : label}</span>}
    </button>
  );
}

function CodeBlock({ code, lang = "json", highlight }: { code: string; lang?: string; highlight?: boolean }) {
  return (
    <div className={`relative rounded-md border overflow-hidden ${highlight ? "border-primary/40 shadow-[0_0_12px_rgba(59,130,246,0.1)]" : "border-border"} bg-muted/60`}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/80 border-b border-border">
        <span className="text-xs text-muted-foreground font-mono">{lang}</span>
        <CopyButton text={code} />
      </div>
      <pre className="p-3 text-xs overflow-auto text-foreground/90 leading-relaxed">{code}</pre>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</div>
      <div className="flex-1 text-sm">{children}</div>
    </div>
  );
}

function Section({ title, icon: Icon, children, accent }: {
  title: string; icon: any; children: React.ReactNode; accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      <div className={`px-4 py-3 border-b border-border flex items-center gap-2 ${accent ?? "bg-muted/40"}`}>
        <Icon className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

function FormatBadge({ fmt }: { fmt: string }) {
  const styles: Record<string, string> = {
    "flat":          "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300 dark:border-blue-700",
    "nested-data":   "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300 border-violet-300 dark:border-violet-700",
    "nested-metrics":"bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border-teal-300 dark:border-teal-700",
    "nested-root":   "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300 border-orange-300 dark:border-orange-700",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0 rounded border font-mono text-[10px] leading-4 ${styles[fmt] ?? "bg-muted text-muted-foreground border-border"}`}>
      {fmt}
    </span>
  );
}

// ── Payload examples ──────────────────────────────────────────────────────────
const NESTED_ROOT_PAYLOAD = JSON.stringify({
  deviceId: "energy-gw-01",
  timestamp: "2025-05-03 10:30:00+05:30",
  timestampUnix: 1746256200000,
  chiller:   { energy_kWh: 15.2, load_percent: 82, COP: 3.1, flow_rate_lps: 45 },
  lighting:  { energy_kWh: 5.1, zone_usage: 75, power_factor: 0.92 },
  elevator:  { energy_kWh: 2.1, trip_count: 12, idle_time_min: 18 },
  genset:    { energy_kWh: 3.2, fuel_liters: 1.1, efficiency_kWh_per_l: 2.9 },
  solar:     { generated_kWh: 8.3, irradiance_Wm2: 750, efficiency_percent: 17 },
  grid:      { consumed_kWh: 12.4, tariff_INR_kWh: 7.2, cost_INR: 89.3 },
}, null, 2);

const FLAT_PAYLOAD = JSON.stringify({
  deviceId: "energy-meter-01",
  timestamp: "2025-05-03 10:30:00+05:30",
  energy_meter_kwh: 4659.166,
  interval_kwh: 0.739,
  daily_cum_kwh: 32.16,
  temperature: 82.4,
}, null, 2);

const NESTED_METRICS_PAYLOAD = JSON.stringify({
  deviceId: "sensor-01",
  timestamp: "2025-05-03T10:30:00Z",
  metrics: {
    temperature: 72.4,
    pressure: 1.02,
    humidity: 65,
  },
}, null, 2);

const NESTED_DATA_PAYLOAD = JSON.stringify({
  deviceId: "vibration-sensor-01",
  timestamp: "2025-05-03T10:30:00Z",
  data: {
    vibration_rms_velocity_x: 3.2,
    temperature: 31.7,
    ultrasound: 53.1,
  },
}, null, 2);

const OK_RESPONSE = JSON.stringify({
  success: true,
  recordsWritten: 18,
  assetId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  assetName: "Energy Gateway — Block A",
  message: "Ingested 18 metric(s)",
  alarmsTriggered: 0,
  alarmsCleared: 0,
}, null, 2);

const ERR_422 = JSON.stringify({
  success: false,
  error: 'Unknown deviceId: "energy-gw-01"',
  hint: 'No asset has identifier="energy-gw-01". Set this identifier on the asset in Asset Management, or check for a typo.',
  deviceId: "energy-gw-01",
  recordsWritten: 0,
}, null, 2);

const CURL_EXAMPLE = `# Send a nested sub-systems payload:
curl -s -X POST ${INGEST_URL} \\
  -H "Content-Type: application/json" \\
  -d '{
    "deviceId": "energy-gw-01",
    "timestamp": "2025-05-03 10:30:00+05:30",
    "chiller": { "energy_kWh": 15.2, "load_percent": 82 },
    "solar":   { "generated_kWh": 8.3, "irradiance_Wm2": 750 }
  }' | jq

# With API client token (from Security → API Clients):
curl -s -X POST ${INGEST_URL} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -d '{"deviceId":"energy-gw-01","chiller":{"energy_kWh":15.2}}' | jq`;

const CURL_VALIDATE = `# Dry-run: verify deviceId resolves and inspect extracted metrics (no DB write)
curl -s -X POST ${BASE_URL}/api/ingest/validate \\
  -H "Content-Type: application/json" \\
  -d '{
    "deviceId": "energy-gw-01",
    "chiller": { "energy_kWh": 15.2, "load_percent": 82 }
  }' | jq`;

const VALIDATE_RESPONSE = JSON.stringify({
  valid: true,
  deviceId: "energy-gw-01",
  assetId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  assetName: "Energy Gateway — Block A",
  assetMatched: true,
  payloadFormat: "nested-root",
  metricCount: 2,
  extractedMetrics: {
    "chiller.energy_kWh": 15.2,
    "chiller.load_percent": 82,
  },
  warnings: [],
}, null, 2);

const PYTHON_EXAMPLE = `import requests, datetime

INGEST_URL = "${INGEST_URL}"

payload = {
    "deviceId": "energy-gw-01",
    "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "chiller":  { "energy_kWh": 15.2, "load_percent": 82 },
    "solar":    { "generated_kWh": 8.3, "irradiance_Wm2": 750 },
}

headers = {
    "Content-Type": "application/json",
    # Optional: add an API client token for authenticated requests
    # "Authorization": "Bearer YOUR_TOKEN",
}

resp = requests.post(INGEST_URL, json=payload, headers=headers, timeout=10)
print(resp.json())`;

export default function IntegrationGuide() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">

      {/* ── Hero ── */}
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" /> Device Integration Guide
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Send telemetry from any device, gateway, or application to the platform's ingest API.
          Four payload formats are supported — the platform auto-detects on every request.
        </p>
      </div>

      {/* ── Ingest URL box ── */}
      <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Ingest endpoint</p>
        <div className="flex items-center gap-3 bg-background rounded-lg border border-primary/20 px-4 py-3">
          <code className="text-sm font-mono text-primary flex-1 break-all">{INGEST_URL}</code>
          <CopyButton text={INGEST_URL} label="Copy URL" />
        </div>
        <p className="text-xs text-muted-foreground">
          <code className="bg-muted px-1 rounded">POST</code> — accepts JSON,
          responds in &lt;50 ms, evaluates alarm rules, and broadcasts updates via WebSocket in real time.
        </p>
      </div>

      {/* ── Quick setup ── */}
      <Section title="3-Step Quick Setup" icon={GitMerge}>
        <div className="space-y-4">
          <Step n={1}>
            <p className="font-medium mb-1">Register your asset with the correct identifier</p>
            <p className="text-xs text-muted-foreground">
              In <strong>Asset Management</strong>, create an asset and set its
              <code className="bg-muted px-1 rounded mx-1">Identifier</code> field to exactly match
              the <code className="bg-muted px-1 rounded">deviceId</code> value your device sends.
              This is the single key that links all inbound data to the asset.
            </p>
            <div className="mt-2 flex items-center gap-2 text-xs rounded-md border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 p-2 text-amber-800 dark:text-amber-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Identifier mismatch returns HTTP 422. Check the Request Log in the Payload Simulator to diagnose quickly.</span>
            </div>
          </Step>

          <Step n={2}>
            <p className="font-medium mb-1">Send a test payload</p>
            <p className="text-xs text-muted-foreground">
              Point your device or gateway at the ingest endpoint above with
              <code className="bg-muted px-1 rounded mx-1">Content-Type: application/json</code>.
              The platform will auto-detect the payload format and store all metrics under the matching asset.
            </p>
          </Step>

          <Step n={3}>
            <p className="font-medium mb-1">Verify with the validate endpoint</p>
            <p className="text-xs text-muted-foreground">
              Use <code className="bg-muted px-1 rounded">POST /api/ingest/validate</code> (or the built-in Payload Simulator)
              to do a dry-run — confirms your deviceId resolves and shows exactly which metrics will be stored, without writing anything.
            </p>
          </Step>
        </div>
      </Section>

      {/* ── Payload formats ── */}
      <Section title="Supported Payload Formats" icon={Package}>
        <p className="text-xs text-muted-foreground">
          The platform auto-detects the format on every request — no configuration needed.
        </p>

        {/* nested-root */}
        <div className="rounded-lg border border-orange-200 dark:border-orange-800/40 bg-orange-50/60 dark:bg-orange-950/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FormatBadge fmt="nested-root" />
            <span className="text-xs font-semibold">Nested sub-systems at root level</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Sub-objects are dot-flattened:
            <code className="bg-muted px-1 rounded mx-1">chiller.energy_kWh</code>,
            <code className="bg-muted px-1 rounded mx-1">solar.generated_kWh</code>, etc.
            Ideal for energy gateways managing multiple sub-systems.
          </p>
          <CodeBlock code={NESTED_ROOT_PAYLOAD} lang="json (nested-root)" />
        </div>

        {/* flat */}
        <div className="rounded-lg border border-blue-200 dark:border-blue-800/40 bg-blue-50/60 dark:bg-blue-950/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FormatBadge fmt="flat" />
            <span className="text-xs font-semibold">Flat — all metrics at root level</span>
          </div>
          <p className="text-xs text-muted-foreground">Metrics sit directly beside deviceId. Suitable for simple sensors and energy meters.</p>
          <CodeBlock code={FLAT_PAYLOAD} lang="json (flat)" />
        </div>

        {/* nested-metrics */}
        <div className="rounded-lg border border-teal-200 dark:border-teal-800/40 bg-teal-50/60 dark:bg-teal-950/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FormatBadge fmt="nested-metrics" />
            <span className="text-xs font-semibold">Nested metrics object</span>
          </div>
          <p className="text-xs text-muted-foreground">All measurements inside a <code className="bg-muted px-1 rounded">metrics</code> key.</p>
          <CodeBlock code={NESTED_METRICS_PAYLOAD} lang="json (nested-metrics)" />
        </div>

        {/* nested-data */}
        <div className="rounded-lg border border-violet-200 dark:border-violet-800/40 bg-violet-50/60 dark:bg-violet-950/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FormatBadge fmt="nested-data" />
            <span className="text-xs font-semibold">Nested data envelope</span>
          </div>
          <p className="text-xs text-muted-foreground">All measurements inside a <code className="bg-muted px-1 rounded">data</code> key. Common for vibration and condition-monitoring sensors.</p>
          <CodeBlock code={NESTED_DATA_PAYLOAD} lang="json (nested-data)" />
        </div>
      </Section>

      {/* ── Device ID binding ── */}
      <Section title="deviceId → Asset Identifier Binding" icon={Radio}>
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-semibold">How it works</p>
          <div className="flex items-start gap-3 text-xs text-muted-foreground">
            <div className="space-y-1.5 flex-1">
              <p>
                The <code className="bg-muted px-1 rounded">deviceId</code> in every payload is matched against
                the <strong>Identifier</strong> field on each asset.
                One device → one asset → one identifier. If you have multiple gateways, create one asset per gateway,
                each with a matching identifier.
              </p>
              <p className="text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                If the identifier doesn't match, the API returns HTTP 422 — no data is silently discarded.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Python example ── */}
      <Section title="Python Integration Example" icon={Code2}>
        <CodeBlock code={PYTHON_EXAMPLE} lang="python" />
        <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-md border border-border bg-muted/20 p-2.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />
          <span>
            Any HTTP client works — Python, curl, Node.js, or any language that can make POST requests.
            Set <code className="bg-muted px-1 rounded">Content-Type: application/json</code> and send a valid JSON body.
          </span>
        </div>
      </Section>

      {/* ── cURL examples ── */}
      <Section title="Test from Terminal" icon={Terminal}>
        <p className="text-xs text-muted-foreground font-medium">Send a nested sub-systems payload:</p>
        <CodeBlock code={CURL_EXAMPLE} lang="bash" />
        <p className="text-xs text-muted-foreground font-medium mt-2">Dry-run validation (no data written):</p>
        <CodeBlock code={CURL_VALIDATE} lang="bash" />
        <p className="text-xs text-muted-foreground font-medium mt-2">Validate response — shows exact metric keys that will be stored:</p>
        <CodeBlock code={VALIDATE_RESPONSE} lang="json" />
      </Section>

      {/* ── Response format ── */}
      <Section title="API Response Format" icon={Code2}>
        <p className="text-xs text-muted-foreground font-medium">Success (HTTP 200):</p>
        <CodeBlock code={OK_RESPONSE} lang="json" />
        <p className="text-xs text-muted-foreground font-medium mt-2">Unknown deviceId (HTTP 422 — strict validation):</p>
        <CodeBlock code={ERR_422} lang="json" />
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1.5">
          <p className="text-xs font-semibold">HTTP Status codes</p>
          <div className="space-y-1">
            {[
              ["200", "OK", "Payload ingested, metrics written, alarms evaluated"],
              ["400", "Bad Request", "Missing deviceId or malformed JSON"],
              ["422", "Unprocessable", "deviceId doesn't match any asset identifier"],
              ["429", "Rate Limited", "Too many requests — 120 req/min per API client"],
              ["500", "Server Error", "Unexpected server-side error"],
            ].map(([code, status, desc]) => (
              <div key={code} className="flex items-start gap-2 text-xs">
                <code className="font-mono font-semibold w-8 shrink-0">{code}</code>
                <span className="font-medium w-28 shrink-0 text-muted-foreground">{status}</span>
                <span className="text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Endpoints reference ── */}
      <Section title="All Ingest Endpoints" icon={ExternalLink}>
        <div className="space-y-2">
          {[
            { method: "POST", path: "/api/ingest/payload", desc: "Single payload — primary endpoint" },
            { method: "POST", path: "/api/ingest/batch",   desc: "Array of payloads — up to 500 per request" },
            { method: "POST", path: "/api/ingest/validate",desc: "Dry-run — checks deviceId + extracts metrics, no DB write" },
          ].map(({ method, path, desc }) => (
            <div key={path} className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
              <Badge variant="secondary" className="font-mono text-xs shrink-0">{method}</Badge>
              <code className="text-xs font-mono text-primary flex-1 break-all">{BASE_URL}{path}</code>
              <span className="text-xs text-muted-foreground hidden sm:block">{desc}</span>
              <CopyButton text={`${BASE_URL}${path}`} />
            </div>
          ))}
        </div>
      </Section>

      {/* ── Auth ── */}
      <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-2 text-amber-800 dark:text-amber-300">
          <Lock className="w-4 h-4" /> Authentication
        </p>
        <p className="text-xs text-amber-800 dark:text-amber-400">
          Create an API Client under <strong>Security → API Clients</strong> with the <strong>ingest:write</strong> scope,
          then pass its token as:
          <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded ml-1">Authorization: Bearer &lt;token&gt;</code>.
          The ingest endpoint is accessible without authentication on trusted networks.
          Add a token for production deployments or public-facing gateways.
        </p>
      </div>

      {/* ── Multi-asset pattern ── */}
      <Section title="Multi-Gateway Pattern" icon={Radio}>
        <p className="text-xs text-muted-foreground">
          Each gateway gets its own deviceId. Create one asset per gateway, each with a matching identifier:
        </p>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Gateway</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">deviceId in payload</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Asset → Identifier field</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Result</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Block A Gateway", "energy-gw-blockA", "energy-gw-blockA", "✓ Matched"],
                ["Block B Gateway", "energy-gw-blockB", "energy-gw-blockB", "✓ Matched"],
                ["Plant Genset",    "genset-plant-01",  "genset-plant-01",  "✓ Matched"],
                ["Wrong spelling",  "energy-gw-blockA", "energy-gw-BlckA",  "✗ 422 Error"],
              ].map(([gw, did, id, result], i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 text-muted-foreground">{gw}</td>
                  <td className="px-3 py-2 font-mono text-primary">{did}</td>
                  <td className="px-3 py-2 font-mono">{id}</td>
                  <td className={`px-3 py-2 font-medium ${result.startsWith("✓") ? "text-green-600" : "text-red-500"}`}>{result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

    </div>
  );
}
