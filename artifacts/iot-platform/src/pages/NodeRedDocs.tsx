import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, Copy, CheckCircle2, Code2, ExternalLink, Lock,
  Terminal, ArrowRight, AlertCircle, Info, GitMerge,
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
const AHI_PAYLOAD = JSON.stringify({
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
  deviceId: "rf-dryer-01",
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
  deviceId: "sensorgrow-01",
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
  hint: 'No asset has identifier="energy-gw-01". Set this identifier on the asset in Asset Management, or check for a typo in your Node-RED Device Id node.',
  deviceId: "energy-gw-01",
  recordsWritten: 0,
}, null, 2);

const NODE_RED_DEVICE_ID = `// Node-RED — Device Id node (keep exactly as-is from your AHI flow)
// This node is a subflow that stamps msg.payload with deviceId + timestamp:
let date = new Date();
// ... (existing timezone formatting) ...

msg.payload = {
  deviceId: env.get("deviceId"),   // ← Set this env var to your asset's identifier
  timestamp: date,
  timestampUnix: Date.now(),
  ...msg.payload                   // merge in the upstream data
};
return msg;`;

const NODE_RED_HTTP = `// In your HTTP Request node, change ONLY the URL:
//
//  Before (AHI):  https://app.ahi360.com/api/v1/data/ingest
//  After  (WS-IS): ${INGEST_URL}
//
// Method:        POST
// Content-Type:  application/json (set by AHI Rest API POST subflow automatically)
// Everything else stays the same.`;

const CURL_AHI = `# Test your exact AHI-style payload directly:
curl -s -X POST ${INGEST_URL} \\
  -H "Content-Type: application/json" \\
  -d '{
    "deviceId": "energy-gw-01",
    "timestamp": "2025-05-03 10:30:00+05:30",
    "chiller": { "energy_kWh": 15.2, "load_percent": 82 },
    "solar":   { "generated_kWh": 8.3, "irradiance_Wm2": 750 }
  }' | jq`;

const CURL_VALIDATE = `# Dry-run: check if deviceId matches and see what metrics will be extracted
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

export default function NodeRedDocs() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">

      {/* ── Hero ── */}
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" /> AHI → WS-Integrated Suite: Migration Guide
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Replace the AHI endpoint with ours — your Node-RED flows keep working with <strong>zero changes</strong> to the payload or Device Id node.
          Just swap the URL.
        </p>
      </div>

      {/* ── Drop-in URL box ── */}
      <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Your new ingest endpoint</p>
        <div className="flex items-center gap-3 bg-background rounded-lg border border-primary/20 px-4 py-3">
          <code className="text-sm font-mono text-primary flex-1 break-all">{INGEST_URL}</code>
          <CopyButton text={INGEST_URL} label="Copy URL" />
        </div>
        <p className="text-xs text-muted-foreground">
          Drop this into the <strong>AHI Rest API POST</strong> subflow's <code className="bg-muted px-1 rounded">Endpoint</code> environment variable.
          Method, headers, and everything else remain identical.
        </p>
      </div>

      {/* ── Migration steps ── */}
      <Section title="3-Step Migration" icon={GitMerge}>
        <div className="space-y-4">
          <Step n={1}>
            <p className="font-medium mb-1">Register your asset with the correct identifier</p>
            <p className="text-xs text-muted-foreground">
              In <strong>Asset Management</strong>, create or edit the asset and set its
              <code className="bg-muted px-1 rounded mx-1">Identifier</code> field to exactly match
              the <code className="bg-muted px-1 rounded">deviceId</code> set in your Node-RED
              <strong> Device Id</strong> subflow. This is the single key that links all inbound data to the asset.
            </p>
            <div className="mt-2 flex items-center gap-2 text-xs rounded-md border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 p-2 text-amber-800 dark:text-amber-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Identifier mismatch → the platform returns HTTP 422 with a descriptive error. Check the Request Log in the Payload Simulator to diagnose quickly.</span>
            </div>
          </Step>

          <Step n={2}>
            <p className="font-medium mb-1">Replace the AHI endpoint URL</p>
            <p className="text-xs text-muted-foreground">In your AHI Rest API POST subflow, update the <code className="bg-muted px-1 rounded">Endpoint</code> env var:</p>
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground line-through">https://app.ahi360.com/api/v1/data/ingest</span>
                <ArrowRight className="w-3 h-3 text-primary" />
                <code className="text-primary font-mono">{INGEST_URL}</code>
              </div>
            </div>
          </Step>

          <Step n={3}>
            <p className="font-medium mb-1">Test with the validate endpoint</p>
            <p className="text-xs text-muted-foreground">
              Use <code className="bg-muted px-1 rounded">POST /api/ingest/validate</code> (or the built-in Payload Simulator)
              to do a dry-run that confirms your deviceId resolves and shows exactly which metrics will be stored — without writing anything.
            </p>
          </Step>
        </div>
      </Section>

      {/* ── Payload formats ── */}
      <Section title="Supported Payload Formats" icon={Package}>
        <p className="text-xs text-muted-foreground">
          The platform auto-detects format on every request — no config needed.
        </p>

        {/* nested-root = AHI style */}
        <div className="rounded-lg border border-orange-200 dark:border-orange-800/40 bg-orange-50/60 dark:bg-orange-950/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FormatBadge fmt="nested-root" />
            <span className="text-xs font-semibold">AHI / WS-IS style — nested objects at root level</span>
            <Badge variant="outline" className="text-[10px] h-4 px-1 border-orange-400 text-orange-600 dark:text-orange-400">Your current format</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Nested sub-objects are dot-flattened:
            <code className="bg-muted px-1 rounded mx-1">chiller.energy_kWh</code>,
            <code className="bg-muted px-1 rounded mx-1">solar.generated_kWh</code>, etc.
            This matches your Energy Simulation flow exactly.
          </p>
          <CodeBlock code={AHI_PAYLOAD} lang="json (AHI / nested-root)" />
        </div>

        {/* flat */}
        <div className="rounded-lg border border-blue-200 dark:border-blue-800/40 bg-blue-50/60 dark:bg-blue-950/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FormatBadge fmt="flat" />
            <span className="text-xs font-semibold">Flat — all metrics at root level</span>
          </div>
          <p className="text-xs text-muted-foreground">Yokogawa / Siemens MindSphere / rf-dryer style. Metrics sit directly beside deviceId.</p>
          <CodeBlock code={FLAT_PAYLOAD} lang="json (flat)" />
        </div>

        {/* nested-metrics */}
        <div className="rounded-lg border border-teal-200 dark:border-teal-800/40 bg-teal-50/60 dark:bg-teal-950/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FormatBadge fmt="nested-metrics" />
            <span className="text-xs font-semibold">Nested metrics object</span>
          </div>
          <CodeBlock code={NESTED_METRICS_PAYLOAD} lang="json (nested-metrics)" />
        </div>

        {/* nested-data */}
        <div className="rounded-lg border border-violet-200 dark:border-violet-800/40 bg-violet-50/60 dark:bg-violet-950/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FormatBadge fmt="nested-data" />
            <span className="text-xs font-semibold">Sensorgrow / Node-RED data envelope</span>
          </div>
          <CodeBlock code={NESTED_DATA_PAYLOAD} lang="json (nested-data)" />
        </div>
      </Section>

      {/* ── Device Id binding ── */}
      <Section title="deviceId → Asset Identifier Binding" icon={Radio}>
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-semibold">How it works</p>
          <div className="flex items-start gap-3 text-xs text-muted-foreground">
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono bg-background border border-border px-1.5 py-0.5 rounded">Node-RED Device Id node</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="font-mono bg-background border border-border px-1.5 py-0.5 rounded">deviceId in payload</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <span className="font-mono bg-background border border-border px-1.5 py-0.5 rounded">Asset → Identifier field</span>
              </div>
              <p>
                The <code className="bg-muted px-1 rounded">deviceId</code> from every payload is matched against
                the <strong>Identifier</strong> field of your assets.
                One gateway → one asset → one identifier. If you have 3 gateways, create 3 assets, each with a matching identifier.
              </p>
              <p className="text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                If the identifier doesn't match, the API returns HTTP 422 — no data is silently discarded.
              </p>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Your Node-RED Device Id subflow (<code className="bg-muted px-1 rounded">format msg</code> function) sets this automatically:</p>
        <CodeBlock code={NODE_RED_DEVICE_ID} lang="javascript (Device Id subflow — no changes needed)" />
      </Section>

      {/* ── Node-RED HTTP setup ── */}
      <Section title="Node-RED HTTP Request Node — Only Change the URL" icon={Zap}>
        <CodeBlock code={NODE_RED_HTTP} lang="node-red" />
        <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-md border border-border bg-muted/20 p-2.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />
          <span>
            The <strong>AHI Rest API POST</strong> subflow sends <code className="bg-muted px-1 rounded">Content-Type: application/json</code>
            and uses the last item from the buffer. Both are compatible with our endpoint — nothing else to configure.
          </span>
        </div>
      </Section>

      {/* ── cURL examples ── */}
      <Section title="Test from Terminal" icon={Terminal}>
        <p className="text-xs text-muted-foreground font-medium">Send an AHI-style nested payload:</p>
        <CodeBlock code={CURL_AHI} lang="bash" />
        <p className="text-xs text-muted-foreground font-medium mt-2">Dry-run validation (no data written):</p>
        <CodeBlock code={CURL_VALIDATE} lang="bash" />
        <p className="text-xs text-muted-foreground font-medium mt-2">Validate response — shows exact metric keys that will be stored:</p>
        <CodeBlock code={VALIDATE_RESPONSE} lang="json" />
      </Section>

      {/* ── Response format ── */}
      <Section title="API Response Format" icon={Code2}>
        <p className="text-xs text-muted-foreground font-medium">Success (HTTP 200):</p>
        <CodeBlock code={OK_RESPONSE} lang="json" />
        <p className="text-xs text-muted-foreground font-medium mt-2">Unknown deviceId (HTTP 422 — new strict validation):</p>
        <CodeBlock code={ERR_422} lang="json" />
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1.5">
          <p className="text-xs font-semibold">HTTP Status codes</p>
          <div className="space-y-1">
            {[
              ["200", "OK", "Payload ingested, metrics written, alarms evaluated"],
              ["400", "Bad Request", "Missing deviceId or malformed JSON"],
              ["422", "Unprocessable", "deviceId doesn't match any asset identifier"],
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
            { method: "POST", path: "/api/ingest/payload", desc: "Single payload — primary endpoint for Node-RED" },
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
          <Lock className="w-4 h-4" /> Authentication (optional for internal network)
        </p>
        <p className="text-xs text-amber-800 dark:text-amber-400">
          Create an API Client under <strong>Security → API Client</strong> and pass its token as:
          <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded ml-1">Authorization: Bearer &lt;token&gt;</code>.
          For internal networks, the endpoint is accessible without authentication.
          Apply firewall rules or add auth for production deployments.
        </p>
      </div>

      {/* ── Multi-gateway pattern ── */}
      <Section title="Multi-Gateway Pattern (3 Gateways → 3 Assets)" icon={Radio}>
        <p className="text-xs text-muted-foreground">
          Following AHI's best practice — each gateway gets its own Device Id. In WS-IS, create one asset per gateway,
          each with a matching identifier:
        </p>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Gateway</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Node-RED deviceId</th>
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
