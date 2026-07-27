import { useEffect, useState } from "react";
import { Clock, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { RANGES, GRANULARITY_OPTS, AGG_TYPE_OPTS, REFRESH_INTERVALS, rangeLabelOf } from "./timeRange";
import type { Widget } from "./types";

// Per-widget "Time Range & Aggregation" control — mirrors the popover on the
// Analytics & KPI page (src/pages/AnalyticsKpi.tsx) so both dashboards behave
// the same way, restyled with this app's light shadcn components.
export function WidgetTimePopover({ widget, updateConfig }: { widget: Widget; updateConfig: (id: string, patch: Record<string, any>) => void }) {
  const c = widget.config ?? {};
  const [open, setOpen] = useState(false);
  const [rangeMinutes, setRangeMinutes] = useState<number>(c.rangeMinutes ?? (c.rangeHours != null ? c.rangeHours * 60 : 1440));
  const [customFrom, setCustomFrom] = useState(c.customFrom ?? "");
  const [customTo, setCustomTo] = useState(c.customTo ?? "");
  const [granularity, setGranularity] = useState(c.granularity ?? "auto");
  const [aggType, setAggType] = useState(c.aggType ?? "avg");
  const [interpolated, setInterpolated] = useState(!!c.interpolated);
  const [refreshEnabled, setRefreshEnabled] = useState(!!c.refreshEnabled);
  const [refreshInterval, setRefreshInterval] = useState<number>(c.refreshInterval ?? 30_000);
  const [allowOverride, setAllowOverride] = useState(c.allowOverride !== false);

  // Re-sync local state whenever the popover opens, so stale edits from a
  // previous open (closed without Apply) don't linger.
  useEffect(() => {
    if (!open) return;
    setRangeMinutes(c.rangeMinutes ?? (c.rangeHours != null ? c.rangeHours * 60 : 1440));
    setCustomFrom(c.customFrom ?? "");
    setCustomTo(c.customTo ?? "");
    setGranularity(c.granularity ?? "auto");
    setAggType(c.aggType ?? "avg");
    setInterpolated(!!c.interpolated);
    setRefreshEnabled(!!c.refreshEnabled);
    setRefreshInterval(c.refreshInterval ?? 30_000);
    setAllowOverride(c.allowOverride !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isCustom = rangeMinutes === -1;

  function handleApply() {
    updateConfig(widget.id, {
      rangeMinutes,
      rangeHours: undefined,
      customFrom: isCustom ? customFrom : undefined,
      customTo: isCustom ? customTo : undefined,
      granularity,
      aggType,
      interpolated,
      refreshEnabled,
      refreshInterval,
      allowOverride,
    });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="p-1 rounded hover:bg-muted transition-colors" title="Time Range & Aggregation">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" sideOffset={6} className="w-80 p-0">
        <div className="px-3 py-2 flex items-center gap-2 border-b border-border bg-muted/40">
          <Clock className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary">Time Range &amp; Aggregation</span>
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{rangeLabelOf(c)}</span>
        </div>

        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Time Range</Label>
              <Select value={String(rangeMinutes)} onValueChange={(v) => setRangeMinutes(Number(v))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{RANGES.map((r) => <SelectItem key={r.minutes} value={String(r.minutes)}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">To Future</Label>
              <Select
                disabled={!isCustom}
                defaultValue="now"
                onValueChange={(v) => {
                  const offsets: Record<string, number> = { "+1h": 3_600_000, "+6h": 21_600_000, "+1d": 86_400_000 };
                  const ms = offsets[v] ?? 0;
                  const d = new Date(Date.now() + ms);
                  setCustomTo(new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
                }}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="To Future" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="now">Now</SelectItem>
                  <SelectItem value="+1h">+1 hour</SelectItem>
                  <SelectItem value="+6h">+6 hours</SelectItem>
                  <SelectItem value="+1d">+1 day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isCustom && (
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Custom Time Range</Label>
              <div className="flex items-center gap-1.5">
                <Input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-7 text-[11px] px-1.5" />
                <span className="text-[10px] text-muted-foreground">→</span>
                <Input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-7 text-[11px] px-1.5" />
                <CalendarDays className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Granularity</Label>
              <Select value={granularity} onValueChange={setGranularity}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{GRANULARITY_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Aggregation Type</Label>
              <Select value={aggType} onValueChange={setAggType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{AGG_TYPE_OPTS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex items-center gap-1.5 -mt-1 cursor-pointer">
            <input type="checkbox" checked={interpolated} onChange={(e) => setInterpolated(e.target.checked)} className="w-3 h-3 accent-primary" />
            <span className="text-[10px] text-muted-foreground">Interpolated</span>
          </label>

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Switch checked={refreshEnabled} onCheckedChange={setRefreshEnabled} className="scale-75 origin-left shrink-0" />
            <span className={cn("text-[10px] shrink-0", refreshEnabled ? "text-foreground" : "text-muted-foreground")}>Refresh Time</span>
            <Select value={String(refreshInterval)} onValueChange={(v) => setRefreshInterval(Number(v))} disabled={!refreshEnabled}>
              <SelectTrigger className="h-7 text-[11px] flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>{REFRESH_INTERVALS.map((r) => <SelectItem key={r.ms} value={String(r.ms)}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
            <label className="flex items-center gap-1 shrink-0 cursor-pointer">
              <input type="checkbox" className="w-3 h-3 accent-primary" />
              <span className="text-[10px] text-muted-foreground">Offset</span>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={allowOverride} onCheckedChange={setAllowOverride} className="scale-75 origin-left" />
              <span className={cn("text-[10px]", allowOverride ? "text-foreground" : "text-muted-foreground")}>Allow Override</span>
            </div>
            <Button size="sm" className="h-7 text-xs" onClick={handleApply}>Apply</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
