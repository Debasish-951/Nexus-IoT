import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, Copy, CheckCircle2, Code2, ExternalLink, Lock,
  Terminal, AlertCircle, Info, GitMerge,
  Radio, Package, FileText, FileDown, BookOpen, Loader2,
} from "lucide-react";
import { generatePdf } from "@/docs/pdfGenerator";
import { generateDocx } from "@/docs/docxGenerator";

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

function DocumentationPanel() {
  const { toast } = useToast();
  const [pdfState, setPdfState] = useState<"idle" | "loading">("idle");
  const [docxState, setDocxState] = useState<"idle" | "loading">("idle");

  async function handlePdf() {
    if (pdfState === "loading") return;
    setPdfState("loading");
    toast({ title: "Preparing PDF…" });
    try {
      await generatePdf();
      toast({ title: "PDF Downloaded", description: "Check your downloads folder." });
    } catch (err: any) {
      toast({ title: "PDF generation failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setPdfState("idle");
    }
  }

  async function handleDocx() {
    if (docxState === "loading") return;
    setDocxState("loading");
    toast({ title: "Building Word document…" });
    try {
      await generateDocx();
      toast({ title: "Word Document Downloaded", description: "Check your downloads folder." });
    } catch (err: any) {
      toast({ title: "DOCX generation failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setDocxState("idle");
    }
  }

  return (
    <div className="rounded-xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 via-background to-primary/5 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-primary/15 bg-primary/8 flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
          <BookOpen className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            Platform Documentation
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">v1.0</Badge>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Complete user manual &amp; technical reference — covers every feature, API endpoint, database schema, and integration detail.
          </p>
        </div>
      </div>

      <div className="px-5 py-4 border-b border-primary/10">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">What's inside (24 chapters)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {[
            ["User Manual", "Dashboard, Assets, Attributes, Templates, Trends"],
            ["Alarm Management", "Rules (threshold, ROC, heartbeat, deviation), webhooks"],
            ["Broker & MQTT", "MQTT config, Azure IoT, mapping rules, destinations"],
            ["Security & RBAC", "Users, API clients, scopes, IP allowlist, role matrix"],
            ["Visualization", "Named dashboards, 11 widget types, live WS updates"],
            ["System & Reports", "Data retention, telemetry aggregation, CSV/JSON export"],
            ["API Reference", "All 50+ endpoints with request/response schemas"],
            ["Database Schema", "All 15 tables with columns, types, and indexes"],
            ["Pipeline & Engine", "Ingest pipeline, expression engine, alarm evaluation"],
            ["WebSocket Protocol", "Event types, payload formats, real-time hook internals"],
          ].map(([title, desc]) => (
            <div key={title} className="flex items-start gap-2 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
              <span><span className="font-medium">{title}</span> — <span className="text-muted-foreground">{desc}</span></span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 py-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Download</p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handlePdf}
            disabled={pdfState === "loading"}
            className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-white border-red-700 transition-all shadow-sm hover:shadow-md active:scale-[0.98] select-none"
          >
            {pdfState === "loading" ? <Loader2 className="w-5 h-5 shrink-0 animate-spin" /> : <FileDown className="w-5 h-5 shrink-0" />}
            <div className="text-left">
              <p className="text-sm font-semibold leading-none">{pdfState === "loading" ? "Generating PDF…" : "Download PDF"}</p>
              <p className="text-xs opacity-80 mt-0.5">Fast download · generated on demand</p>
            </div>
          </button>
          <button
            onClick={handleDocx}
            disabled={docxState === "loading"}
            className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white border-blue-700 transition-all shadow-sm hover:shadow-md active:scale-[0.98] select-none"
          >
            {docxState === "loading" ? <Loader2 className="w-5 h-5 shrink-0 animate-spin" /> : <FileText className="w-5 h-5 shrink-0" />}
            <div className="text-left">
              <p className="text-sm font-semibold leading-none">{docxState === "loading" ? "Generating DOCX…" : "Download Word (.docx)"}</p>
              <p className="text-xs opacity-80 mt-0.5">Compatible with MS Word &amp; LibreOffice</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IntegrationGuide() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" /> Device Integration Guide
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Send telemetry from any device, gateway, or application to the platform's ingest API.
          Four payload formats are supported — the platform auto-detects on every request.
        </p>
      </div>
      <DocumentationPanel />
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
    </div>
  );
}
