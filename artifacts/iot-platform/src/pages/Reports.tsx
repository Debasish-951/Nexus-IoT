import { useState } from "react";
import { useListAssets, useListAssetAttributes } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  FileText, Download, Play, RefreshCw, Table, BarChart2,
  ClipboardList, AlertTriangle, Blocks,
} from "lucide-react";
import { format, subHours, subDays } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ReportType = "telemetry" | "alarms" | "asset-status";

interface ReportMeta {
  type: ReportType;
  generatedAt: string;
  totalRows: number;
  filters: Record<string, string>;
}

const REPORT_TYPES: { value: ReportType; label: string; icon: React.ElementType; description: string }[] = [
  {
    value: "telemetry",
    label: "Telemetry Summary",
    icon: BarChart2,
    description: "Aggregated min / avg / max per metric over the selected time window.",
  },
  {
    value: "alarms",
    label: "Alarm Report",
    icon: AlertTriangle,
    description: "All alarm events (active and cleared) within the date range.",
  },
  {
    value: "asset-status",
    label: "Asset Status Snapshot",
    icon: Blocks,
    description: "Current maintenance mode, health, attribute counts, and tag list for every asset.",
  },
];

const BUCKETS = [
  { value: "15m", label: "15 minutes" },
  { value: "1h",  label: "1 hour" },
  { value: "6h",  label: "6 hours" },
  { value: "1d",  label: "1 day" },
];

function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

export default function Reports() {
  const [reportType, setReportType] = useState<ReportType>("telemetry");
  const [assetId, setAssetId]       = useState("all");
  const [metric, setMetric]         = useState("all");
  const [bucket, setBucket]         = useState("1h");
  const [severity, setSeverity]     = useState("all");
  const [fromDate, setFromDate]     = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 16);
  });
  const [toDate, setToDate]         = useState(() => new Date().toISOString().slice(0, 16));

  const [loading, setLoading]       = useState(false);
  const [rows, setRows]             = useState<Record<string, unknown>[] | null>(null);
  const [meta, setMeta]             = useState<ReportMeta | null>(null);

  const { data: assets } = useListAssets();
  const { data: attributes } = useListAssetAttributes(assetId !== "all" ? assetId : "", {
    query: { enabled: assetId !== "all", queryKey: ["report-attrs", assetId] },
  });

  const assetList  = (assets as any[] | undefined) ?? [];
  const attrList   = (attributes as any[] | undefined) ?? [];
  const metricAttrs = attrList.filter((a: any) => a.sourceMetric || a.tagName || a.name);
  const metricKeyOf = (a: any) => a.sourceMetric?.split(".").pop() ?? a.tagName?.split(".").pop() ?? a.name;

  const selectedAssetName = assetList.find((a: any) => a.id === assetId)?.name ?? "All Assets";

  async function generate() {
    setLoading(true);
    setRows(null);
    setMeta(null);
    try {
      const from = new Date(fromDate).toISOString();
      const to   = new Date(toDate).toISOString();

      if (reportType === "telemetry") {
        const params = new URLSearchParams({ from, to, bucket, limit: "5000" });
        if (assetId !== "all") params.set("assetId", assetId);
        if (metric !== "all")  params.set("metric", metric);

        const r = await fetch(`${BASE}/api/system/aggregate?${params}`, { credentials: "include" });
        const json = await r.json();
        const data: Record<string, unknown>[] = (json.data ?? []).map((row: any) => ({
          bucket:    row.bucket ? format(new Date(row.bucket), "yyyy-MM-dd HH:mm") : "",
          asset_id:  row.asset_id,
          metric:    row.metric,
          avg:       Number(row.avg_val ?? 0).toFixed(4),
          min:       Number(row.min_val ?? 0).toFixed(4),
          max:       Number(row.max_val ?? 0).toFixed(4),
          samples:   row.count,
        }));
        setRows(data);
        setMeta({
          type: "telemetry",
          generatedAt: new Date().toISOString(),
          totalRows: data.length,
          filters: { asset: selectedAssetName, metric: metric === "all" ? "All" : metric, bucket, from, to },
        });

      } else if (reportType === "alarms") {
        const params = new URLSearchParams({ format: "json" });
        if (severity !== "all") params.set("severity", severity);
        const r = await fetch(`${BASE}/api/export/alarms?${params}`, { credentials: "include" });
        const json = await r.json();
        const allRows: any[] = json.data ?? json ?? [];
        const filtered = allRows.filter((row: any) => {
          const ts = new Date(row.triggeredAt ?? "").getTime();
          return ts >= new Date(from).getTime() && ts <= new Date(to).getTime();
        });
        const data: Record<string, unknown>[] = filtered.map((row: any) => ({
          id:          row.id,
          asset:       row.assetName,
          name:        row.name,
          severity:    row.severity,
          status:      row.status,
          alarmClass:  row.alarmClass ?? "",
          message:     row.message ?? "",
          triggeredAt: row.triggeredAt ? format(new Date(row.triggeredAt), "yyyy-MM-dd HH:mm:ss") : "",
          clearedAt:   row.clearedAt  ? format(new Date(row.clearedAt),   "yyyy-MM-dd HH:mm:ss") : "",
        }));
        setRows(data);
        setMeta({
          type: "alarms",
          generatedAt: new Date().toISOString(),
          totalRows: data.length,
          filters: { severity: severity === "all" ? "All" : severity, from, to },
        });

      } else {
        // Asset status snapshot
        const r = await fetch(`${BASE}/api/assets`, { credentials: "include" });
        const allAssets: any[] = await r.json();
        const data: Record<string, unknown>[] = allAssets.map((a: any) => ({
          id:              a.id,
          name:            a.name,
          identifier:      a.identifier,
          template:        a.templateName ?? "",
          attributes:      a.attributeCount,
          children:        a.childCount,
          maintenance:     a.maintenanceMode ? "Yes" : "No",
          maintenanceSince: a.maintenanceSince
            ? format(new Date(a.maintenanceSince), "yyyy-MM-dd HH:mm")
            : "",
          maintenanceNote: a.maintenanceNote ?? "",
          tags:            (a.tags ?? []).join(", "),
          updatedAt:       format(new Date(a.updatedAt), "yyyy-MM-dd HH:mm"),
        }));
        setRows(data);
        setMeta({
          type: "asset-status",
          generatedAt: new Date().toISOString(),
          totalRows: data.length,
          filters: { scope: "All Assets" },
        });
      }
    } finally {
      setLoading(false);
    }
  }

  const filenameBase = `ws-report-${reportType}-${format(new Date(), "yyyyMMdd-HHmm")}`;
  const previewRows  = (rows ?? []).slice(0, 50);
  const headers      = previewRows.length > 0 ? Object.keys(previewRows[0]) : [];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border bg-card flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Reports
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure and generate on-demand reports from live data
          </p>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Config panel */}
        <div className="w-72 shrink-0 border-r border-border overflow-y-auto p-4 space-y-5 bg-muted/20">
          {/* Report type */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Report Type</Label>
            <div className="space-y-1.5">
              {REPORT_TYPES.map((rt) => (
                <button
                  key={rt.value}
                  onClick={() => { setReportType(rt.value); setRows(null); setMeta(null); }}
                  className={`w-full text-left rounded-md border px-3 py-2.5 transition-colors ${
                    reportType === rt.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/60"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <rt.icon className={`w-3.5 h-3.5 ${reportType === rt.value ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="text-xs font-medium">{rt.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">{rt.description}</p>
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Date range */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date Range</Label>
            <div className="space-y-1.5">
              <div>
                <Label className="text-xs text-muted-foreground">From</Label>
                <Input type="datetime-local" className="h-8 text-xs mt-0.5" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input type="datetime-local" className="h-8 text-xs mt-0.5" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
            </div>
            {/* Quick range buttons */}
            <div className="flex flex-wrap gap-1">
              {[
                { label: "Last 1h",  hours: 1 },
                { label: "Last 24h", hours: 24 },
                { label: "Last 7d",  hours: 168 },
                { label: "Last 30d", hours: 720 },
              ].map((q) => (
                <button key={q.label} className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted/60 transition-colors"
                  onClick={() => {
                    const now = new Date();
                    setToDate(now.toISOString().slice(0, 16));
                    setFromDate(subHours(now, q.hours).toISOString().slice(0, 16));
                  }}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* Telemetry filters */}
          {reportType === "telemetry" && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filters</Label>
                <div>
                  <Label className="text-xs text-muted-foreground">Asset</Label>
                  <Select value={assetId} onValueChange={(v) => { setAssetId(v); setMetric("all"); }}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="All assets" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">All assets</SelectItem>
                      {assetList.map((a: any) => <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Metric</Label>
                  <Select value={metric} onValueChange={setMetric} disabled={assetId === "all"}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="All metrics" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">All metrics</SelectItem>
                      {metricAttrs.map((a: any) => <SelectItem key={metricKeyOf(a)} value={metricKeyOf(a)} className="text-xs">{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Aggregation Bucket</Label>
                  <Select value={bucket} onValueChange={setBucket}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BUCKETS.map((b) => <SelectItem key={b.value} value={b.value} className="text-xs">{b.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {/* Alarm filters */}
          {reportType === "alarms" && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filters</Label>
                <div>
                  <Label className="text-xs text-muted-foreground">Severity</Label>
                  <Select value={severity} onValueChange={setSeverity}>
                    <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">All severities</SelectItem>
                      {["critical","high","medium","low","info"].map((s) => (
                        <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Generate button */}
          <Button className="w-full gap-2" onClick={generate} disabled={loading}>
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {loading ? "Generating…" : "Generate Report"}
          </Button>
        </div>

        {/* Result panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!rows && !loading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium text-muted-foreground">Configure and generate a report</p>
                <p className="text-xs text-muted-foreground mt-1">Select a report type and date range, then click Generate.</p>
              </div>
            </div>
          )}

          {loading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <RefreshCw className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Fetching data…</p>
              </div>
            </div>
          )}

          {rows && meta && (
            <>
              {/* Result toolbar */}
              <div className="shrink-0 px-4 py-2.5 border-b border-border bg-card flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div>
                    <span className="text-xs font-medium">{REPORT_TYPES.find((r) => r.value === meta.type)?.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">{meta.totalRows.toLocaleString()} rows</span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {Object.entries(meta.filters).map(([k, v]) => (
                      <Badge key={k} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {k}: {v}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground hidden sm:block">
                    Generated {format(new Date(meta.generatedAt), "HH:mm:ss")}
                  </span>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => downloadCsv(rows, `${filenameBase}.csv`)}>
                    <Download className="w-3 h-3" /> CSV
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => downloadJson(rows, `${filenameBase}.json`)}>
                    <Download className="w-3 h-3" /> JSON
                  </Button>
                </div>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-auto">
                {previewRows.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Table className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No data found for the selected filters.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <table className="w-full text-xs min-w-max">
                      <thead className="bg-muted/50 sticky top-0 z-10">
                        <tr>
                          {headers.map((h) => (
                            <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap border-b border-border">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => (
                          <tr key={i} className={i % 2 === 0 ? "bg-card" : "bg-muted/20"}>
                            {headers.map((h) => (
                              <td key={h} className="px-3 py-1.5 whitespace-nowrap tabular-nums max-w-xs truncate">
                                {String(row[h] ?? "")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 50 && (
                      <p className="text-xs text-muted-foreground p-3 border-t border-border">
                        Showing first 50 of {rows.length.toLocaleString()} rows. Download CSV/JSON for the full dataset.
                      </p>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
