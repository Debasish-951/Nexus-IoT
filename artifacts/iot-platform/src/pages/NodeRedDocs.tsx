import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Zap, Copy, CheckCircle2, Code2, ExternalLink, Lock, Terminal } from "lucide-react";

const BASE_URL = window.location.origin;

function CopyButton({ text }: { text: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true); toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button onClick={copy} className="text-muted-foreground hover:text-foreground transition-colors">
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function CodeBlock({ code, lang = "json" }: { code: string; lang?: string }) {
  return (
    <div className="relative rounded-md bg-muted/60 border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/80 border-b border-border">
        <span className="text-xs text-muted-foreground font-mono">{lang}</span>
        <CopyButton text={code} />
      </div>
      <pre className="p-3 text-xs overflow-auto text-foreground/90 leading-relaxed">{code}</pre>
    </div>
  );
}

const SINGLE_PAYLOAD = JSON.stringify({
  deviceId: "sensor-001",
  data: {
    temperature: 72.4,
    vibration_rms_velocity_x: 3.2,
    energy_kwh: 145.7,
  },
  timestamp: new Date().toISOString(),
}, null, 2);

const BATCH_PAYLOAD = JSON.stringify([
  { deviceId: "sensor-001", data: { temperature: 72.4 } },
  { deviceId: "sensor-002", data: { pressure: 1.02 } },
], null, 2);

const CURL_SINGLE = `curl -X POST ${BASE_URL}/api/ingest/payload \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ deviceId: "sensor-001", data: { temperature: 72.4 } })}'`;

const CURL_WITH_AUTH = `curl -X POST ${BASE_URL}/api/ingest/payload \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -d '${JSON.stringify({ deviceId: "sensor-001", data: { temperature: 72.4 } })}'`;

const NODE_RED_FUNCTION = `// Node-RED Function node — build IoT payload
const reading = msg.payload; // raw sensor data

msg.payload = {
    deviceId: msg.topic || "sensor-001",
    data: {
        temperature:   reading.temp   || reading.temperature,
        pressure:      reading.pres   || reading.pressure,
        humidity:      reading.hum    || reading.humidity,
    },
    timestamp: new Date().toISOString(),
};

return msg;`;

const ASSET_HINT_PAYLOAD = JSON.stringify({
  deviceId: "sensorgrow-01",
  assetId: "PASTE-ASSET-UUID-HERE",
  data: { temperature: 72.4, vibration_rms_velocity_x: 3.2 },
}, null, 2);

export default function NodeRedDocs() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" /> Node-RED Integration
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Publish sensor data to the IoT platform from Node-RED or any HTTP client
        </p>
      </div>

      {/* Endpoint reference */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3 shadow-sm">
        <p className="text-sm font-semibold">Ingestion Endpoints</p>
        <div className="space-y-2">
          {[
            { method: "POST", path: "/api/ingest/payload", desc: "Single device payload" },
            { method: "POST", path: "/api/ingest/batch",   desc: "Batch array of payloads" },
          ].map(({ method, path, desc }) => (
            <div key={path} className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
              <Badge variant="secondary" className="font-mono text-xs shrink-0">{method}</Badge>
              <code className="text-xs font-mono text-primary flex-1">{BASE_URL}{path}</code>
              <span className="text-xs text-muted-foreground">{desc}</span>
              <CopyButton text={`${BASE_URL}${path}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Payload format */}
      <div className="space-y-2">
        <p className="text-sm font-semibold flex items-center gap-2"><Code2 className="w-4 h-4" />Payload Format</p>
        <p className="text-xs text-muted-foreground">
          The <code className="bg-muted px-1 rounded">deviceId</code> field is required and must match the identifier of a registered asset.
          All metric values go inside <code className="bg-muted px-1 rounded">data</code>.
        </p>
        <CodeBlock code={SINGLE_PAYLOAD} />
        <p className="text-xs text-muted-foreground mt-1">
          Optionally pass <code className="bg-muted px-1 rounded">assetId</code> (UUID) to target a specific asset directly:
        </p>
        <CodeBlock code={ASSET_HINT_PAYLOAD} />
      </div>

      {/* Batch */}
      <div className="space-y-2">
        <p className="text-sm font-semibold">Batch Ingest</p>
        <p className="text-xs text-muted-foreground">Send multiple device readings in one request — up to 500 records per batch.</p>
        <CodeBlock code={BATCH_PAYLOAD} />
      </div>

      {/* cURL examples */}
      <div className="space-y-2">
        <p className="text-sm font-semibold flex items-center gap-2"><Terminal className="w-4 h-4" />cURL Examples</p>
        <CodeBlock code={CURL_SINGLE} lang="bash" />
        <p className="text-xs text-muted-foreground">With API token authentication:</p>
        <CodeBlock code={CURL_WITH_AUTH} lang="bash" />
      </div>

      {/* Authentication */}
      <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2">
        <p className="text-sm font-semibold flex items-center gap-2 text-amber-800 dark:text-amber-300">
          <Lock className="w-4 h-4" /> Authentication
        </p>
        <p className="text-xs text-amber-800 dark:text-amber-400">
          Create an API Client in <strong>Security → API Client</strong> to get a bearer token.
          Pass it as <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">Authorization: Bearer &lt;token&gt;</code> header.
          Without a token, ingest endpoints are accessible on the local network (configure firewall rules for production).
        </p>
      </div>

      {/* Node-RED setup */}
      <div className="space-y-3">
        <p className="text-sm font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4 text-red-500" /> Node-RED HTTP Request Node Setup
        </p>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>Add an <strong>HTTP Request</strong> node → Method: <code className="bg-muted px-1 rounded">POST</code></li>
          <li>URL: <code className="bg-muted px-1 rounded">{BASE_URL}/api/ingest/payload</code></li>
          <li>Return: <code className="bg-muted px-1 rounded">a parsed JSON object</code></li>
          <li>Add a <strong>Function</strong> node before it to shape the payload:</li>
        </ol>
        <CodeBlock code={NODE_RED_FUNCTION} lang="javascript" />
        <p className="text-xs text-muted-foreground">
          Chain: <code className="bg-muted px-1 rounded">MQTT In</code> → <code className="bg-muted px-1 rounded">Function</code> → <code className="bg-muted px-1 rounded">HTTP Request</code>
        </p>
      </div>

      {/* Response format */}
      <div className="space-y-2">
        <p className="text-sm font-semibold">Response</p>
        <CodeBlock code={JSON.stringify({
          success: true,
          recordsWritten: 3,
          assetId: "...",
          assetName: "Fan",
          message: "Ingested 3 metric(s)",
          alarmsTriggered: 1,
          alarmsCleared: 0,
        }, null, 2)} />
      </div>
    </div>
  );
}
