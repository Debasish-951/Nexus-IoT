import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Zap, Copy, CheckCircle2, FileText, FileDown,
  BookOpen, Loader2, Sparkles, ChevronDown,
} from "lucide-react";
import { generatePdf } from "@/docs/pdfGenerator";
import { generateDocx } from "@/docs/docxGenerator";
import { buildDocumentContent_v11, PLATFORM_VERSION_V11, DOC_DATE_V11 } from "@/docs/content_v11";

const BASE_URL = window.location.origin;
const INGEST_URL = `${BASE_URL}/api/ingest/payload`;

// ── Version registry — add new versions here ───────────────────────────────
interface DocVersion {
  version: string;
  date: string;
  label: string;
  isLatest?: boolean;
  description: string;
  newChapters?: { title: string; desc: string }[];
  chapters: { title: string; desc: string }[];
  onPdf: (toast: ReturnType<typeof useToast>["toast"], setLoading: (v: boolean) => void) => Promise<void>;
  onDocx: (toast: ReturnType<typeof useToast>["toast"], setLoading: (v: boolean) => void) => Promise<void>;
}

const DOC_VERSIONS: DocVersion[] = [
  {
    version: "1.1",
    date: "May 2026",
    label: "v1.1",
    isLatest: true,
    description: "Everything in v1.0 plus Chapter 25: SPC reference lines, per-series labels & UoM, drag-to-reorder widgets, and corner resize.",
    newChapters: [
      { title: "SPC Reference Lines", desc: "UCL / LCL / CL horizontal markers on Line, Area, Bar charts" },
      { title: "Per-Series Labels & UoM", desc: "Custom display names and UoM for primary and overlay metrics" },
      { title: "Drag-to-Reorder", desc: "Rearrange widgets within a dashboard by drag-and-drop" },
      { title: "Corner Resize", desc: "Resize any widget by dragging its bottom-right corner" },
      { title: "Updated Widget Schema", desc: "New spcLines[], label, uom fields — fully backward-compatible" },
    ],
    chapters: [
      { title: "User Manual", desc: "Dashboard, Assets, Attributes, Templates, Trends" },
      { title: "Event Manager", desc: "Rules (threshold, ROC, heartbeat, deviation), webhooks" },
      { title: "Broker & MQTT", desc: "MQTT config, Azure IoT, mapping rules, destinations" },
      { title: "Security & RBAC", desc: "Users, API clients, scopes, IP allowlist, role matrix" },
      { title: "Visualization", desc: "Named dashboards, 11 widget types, live WS updates" },
      { title: "System & Reports", desc: "Data retention, telemetry aggregation, CSV/JSON export" },
      { title: "API Reference", desc: "All 50+ endpoints with request/response schemas" },
      { title: "Database Schema", desc: "All 15 tables with columns, types, and indexes" },
      { title: "Pipeline & Engine", desc: "Ingest pipeline, expression engine, alarm evaluation" },
      { title: "WebSocket Protocol", desc: "Event types, payload formats, real-time hook internals" },
    ],
    onPdf: async (toast, setLoading) => {
      setLoading(true);
      toast({ title: "Preparing PDF v1.1…" });
      try {
        const items = buildDocumentContent_v11();
        await generatePdf(undefined, { items, version: PLATFORM_VERSION_V11, date: DOC_DATE_V11 });
        toast({ title: "PDF v1.1 Downloaded", description: "Check your downloads folder." });
      } catch (err: any) {
        toast({ title: "PDF generation failed", description: err?.message ?? "Unknown error", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
    onDocx: async (toast, setLoading) => {
      setLoading(true);
      toast({ title: "Building Word document v1.1…" });
      try {
        const items = buildDocumentContent_v11();
        await generateDocx(undefined, { items, version: PLATFORM_VERSION_V11, date: DOC_DATE_V11 });
        toast({ title: "Word Document v1.1 Downloaded", description: "Check your downloads folder." });
      } catch (err: any) {
        toast({ title: "DOCX generation failed", description: err?.message ?? "Unknown error", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
  },
  {
    version: "1.0",
    date: "Apr 2026",
    label: "v1.0",
    description: "Original release — complete user manual & technical reference covering every feature, API endpoint, database schema, and integration detail.",
    chapters: [
      { title: "User Manual", desc: "Dashboard, Assets, Attributes, Templates, Trends" },
      { title: "Event Manager", desc: "Rules (threshold, ROC, heartbeat, deviation), webhooks" },
      { title: "Broker & MQTT", desc: "MQTT config, Azure IoT, mapping rules, destinations" },
      { title: "Security & RBAC", desc: "Users, API clients, scopes, IP allowlist, role matrix" },
      { title: "Visualization", desc: "Named dashboards, 11 widget types, live WS updates" },
      { title: "System & Reports", desc: "Data retention, telemetry aggregation, CSV/JSON export" },
      { title: "API Reference", desc: "All 50+ endpoints with request/response schemas" },
      { title: "Database Schema", desc: "All 15 tables with columns, types, and indexes" },
      { title: "Pipeline & Engine", desc: "Ingest pipeline, expression engine, alarm evaluation" },
      { title: "WebSocket Protocol", desc: "Event types, payload formats, real-time hook internals" },
    ],
    onPdf: async (toast, setLoading) => {
      setLoading(true);
      toast({ title: "Preparing PDF v1.0…" });
      try {
        await generatePdf();
        toast({ title: "PDF v1.0 Downloaded", description: "Check your downloads folder." });
      } catch (err: any) {
        toast({ title: "PDF generation failed", description: err?.message ?? "Unknown error", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
    onDocx: async (toast, setLoading) => {
      setLoading(true);
      toast({ title: "Building Word document v1.0…" });
      try {
        await generateDocx();
        toast({ title: "Word Document v1.0 Downloaded", description: "Check your downloads folder." });
      } catch (err: any) {
        toast({ title: "DOCX generation failed", description: err?.message ?? "Unknown error", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    },
  },
];

// ── Small helpers ──────────────────────────────────────────────────────────
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

// ── Documentation panel ────────────────────────────────────────────────────
function DocumentationPanel() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(DOC_VERSIONS[0]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [docxLoading, setDocxLoading] = useState(false);

  function selectVersion(v: DocVersion) {
    setSelected(v);
    setOpen(false);
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-visible">
      {/* Header with version selector */}
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
          <BookOpen className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">Platform Documentation</span>
            {/* Version picker dropdown */}
            <div className="relative">
              <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-muted/60 hover:bg-muted transition-colors text-xs font-medium"
              >
                <span>{selected.label}</span>
                {selected.isLatest && (
                  <Badge className="text-[9px] px-1 py-0 h-4 bg-primary text-primary-foreground leading-none">Latest</Badge>
                )}
                <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
              </button>

              {open && (
                <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
                  {DOC_VERSIONS.map(v => (
                    <button
                      key={v.version}
                      onClick={() => selectVersion(v)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-muted ${selected.version === v.version ? "bg-muted/70" : ""}`}
                    >
                      <span className="font-mono font-medium">{v.label}</span>
                      <span className="text-muted-foreground truncate">— {v.date}</span>
                      {v.isLatest && (
                        <Badge className="ml-auto text-[9px] px-1 py-0 h-4 bg-primary text-primary-foreground leading-none shrink-0">Latest</Badge>
                      )}
                      {selected.version === v.version && (
                        <CheckCircle2 className="w-3 h-3 text-primary shrink-0 ml-auto" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{selected.description}</p>
        </div>
      </div>

      {/* What's new section (only if version has newChapters) */}
      {selected.newChapters && selected.newChapters.length > 0 && (
        <div className="px-5 py-4 border-b border-border bg-primary/[0.03]">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            What's new in {selected.label}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {selected.newChapters.map(c => (
              <div key={c.title} className="flex items-start gap-2 text-xs">
                <Sparkles className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                <span><span className="font-medium">{c.title}</span> — <span className="text-muted-foreground">{c.desc}</span></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chapters included */}
      <div className="px-5 py-4 border-b border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          {selected.newChapters?.length ? "All chapters included" : "Chapters included"}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {selected.chapters.map(c => (
            <div key={c.title} className="flex items-start gap-2 text-xs">
              <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0 mt-0.5" />
              <span><span className="font-medium">{c.title}</span> — <span className="text-muted-foreground">{c.desc}</span></span>
            </div>
          ))}
        </div>
      </div>

      {/* Download buttons */}
      <div className="px-5 py-4 flex flex-wrap gap-3">
        <button
          onClick={() => selected.onPdf(toast, setPdfLoading)}
          disabled={pdfLoading}
          className="flex items-center gap-3 px-4 py-2.5 rounded-lg border bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-white border-red-700 transition-all shadow-sm hover:shadow-md active:scale-[0.98] select-none"
        >
          {pdfLoading ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" /> : <FileDown className="w-4 h-4 shrink-0" />}
          <div className="text-left">
            <p className="text-xs font-semibold leading-none">{pdfLoading ? "Generating…" : `Download PDF ${selected.label}`}</p>
            <p className="text-[10px] opacity-75 mt-0.5">Generated on demand</p>
          </div>
        </button>
        <button
          onClick={() => selected.onDocx(toast, setDocxLoading)}
          disabled={docxLoading}
          className="flex items-center gap-3 px-4 py-2.5 rounded-lg border bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white border-blue-700 transition-all shadow-sm hover:shadow-md active:scale-[0.98] select-none"
        >
          {docxLoading ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" /> : <FileText className="w-4 h-4 shrink-0" />}
          <div className="text-left">
            <p className="text-xs font-semibold leading-none">{docxLoading ? "Generating…" : `Download Word ${selected.label}`}</p>
            <p className="text-[10px] opacity-75 mt-0.5">MS Word &amp; LibreOffice</p>
          </div>
        </button>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
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
