import { useEffect, useState } from "react";
import { Clock, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { RANGES, GRANULARITY_OPTS, AGG_TYPE_OPTS, REFRESH_INTERVALS, rangeLabelOf, type TimeCfg } from "./timeRange";
import type { Widget } from "./types";

// Per-widget "Time Range & Aggregation" control — mirrors the popover on the
// former Analytics & KPI page (deleted) so both dashboards behave
// the same way, restyled with this app's light shadcn components.
//
// Scope: every setting in here — range, granularity, aggregation, refresh — is
// this widget's own. The dashboard-wide "Set all ranges…" control (in the
// toolbar) only ever touches a widget that has NOT been configured here yet
// (tracked by `timeIsCustom`); the moment Apply is clicked, this widget stops
// listening to that control. That is the fix for two symptoms of the same bug:
// a deliberately-set widget range silently reverting to whatever the dashboard
// selector last held, and this popover LOOKING tied to the dashboard because,
// before `timeIsCustom` existed, every widget always was.
export function WidgetTimePopover({ widget, updateConfig, dashTimeCfg, boundary }: {
  widget: Widget; updateConfig: (id: string, patch: Record<string, any>) => void;
  /** The dashboard-wide range, for the header badge to show what this widget is
   *  ACTUALLY using right now when it isn't customised — otherwise the badge
   *  showed a meaningless default instead of the truth. */
  dashTimeCfg?: TimeCfg | null;
  /** Keeps the panel inside the dashboard canvas instead of sprawling over the
   *  hierarchy sidebar. Radix's default boundary is the viewport, which the
   *  sidebar is part of — so it saw nothing to avoid. */
  boundary?: HTMLElement | null;
}) {
  const c = widget.config ?? {};
  const [open, setOpen] = useState(false);
  // Seeded from the dashboard's range when this widget is following it, so opening
  // the popover shows what the widget is really on rather than a 24h default it
  // was never using.
  const fallbackMinutes = dashTimeCfg?.rangeMinutes ?? 1440;
  const [rangeMinutes, setRangeMinutes] = useState<number>(c.rangeMinutes ?? (c.rangeHours != null ? c.rangeHours * 60 : fallbackMinutes));
  const [customFrom, setCustomFrom] = useState(c.customFrom ?? "");
  const [customTo, setCustomTo] = useState(c.customTo ?? "");
  const [granularity, setGranularity] = useState(c.granularity ?? "auto");
  const [aggType, setAggType] = useState(c.aggType ?? "avg");
  const [interpolated, setInterpolated] = useState(!!c.interpolated);
  const [refreshEnabled, setRefreshEnabled] = useState(!!c.refreshEnabled);
  const [refreshInterval, setRefreshInterval] = useState<number>(c.refreshInterval ?? 30_000);

  // True once this widget has its own explicit time settings (set below, the
  // instant Apply is clicked). Legacy widgets saved with the old, inverted
  // `allowOverride: false` field are honoured the same way, so a range someone
  // already deliberately locked down does not start following the dashboard
  // again just because this file changed.
  const isCustomised = !!c.timeIsCustom || c.allowOverride === false;

  // Re-sync local state whenever the popover opens, so stale edits from a
  // previous open (closed without Apply) don't linger.
  useEffect(() => {
    if (!open) return;
    setRangeMinutes(c.rangeMinutes ?? (c.rangeHours != null ? c.rangeHours * 60 : fallbackMinutes));
    setCustomFrom(c.customFrom ?? (dashTimeCfg?.customFrom ?? ""));
    setCustomTo(c.customTo ?? (dashTimeCfg?.customTo ?? ""));
    setGranularity(c.granularity ?? "auto");
    setAggType(c.aggType ?? "avg");
    setInterpolated(!!c.interpolated);
    setRefreshEnabled(!!c.refreshEnabled);
    setRefreshInterval(c.refreshInterval ?? 30_000);
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
      // Setting anything here IS the act of customising this widget — from now
      // on the dashboard-wide range selector leaves it alone.
      timeIsCustom: true,
      allowOverride: undefined,
    });
    setOpen(false);
  }

  // Opts back into the dashboard-wide range. Only the range fields are cleared —
  // granularity/aggregation/refresh are this widget's own regardless, so they
  // are left exactly as they are.
  function handleFollowDashboard() {
    updateConfig(widget.id, {
      timeIsCustom: false,
      allowOverride: undefined,
      rangeMinutes: undefined,
      rangeHours: undefined,
      customFrom: undefined,
      customTo: undefined,
    });
    setOpen(false);
  }

  /**
   * "Allow override" switch.
   *
   * The old switch only wired the ON direction (`if (checked) handleFollowDashboard()`)
   * — flipping it OFF called nothing, so the widget silently reverted to "following"
   * the next time the popover reopened, since nothing had actually been persisted.
   * That was the "the button doesn't work" bug.
   *
   * Semantics are also inverted from before, per request: ON now means override
   * enabled (this widget is independent of the dashboard-wide range); OFF means it
   * follows the dashboard. Turning override ON commits the range/aggregation
   * fields exactly as currently shown — so nothing visibly changes at the moment
   * of the flip — while marking the widget customised, the same `timeIsCustom`
   * flag Apply sets. Turning it OFF is exactly the old "follow dashboard" action.
   */
  function handleToggleOverride(overrideOn: boolean) {
    if (overrideOn) {
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
        timeIsCustom: true,
        allowOverride: undefined,
      });
      // Left open: the point of switching override on is usually to then change
      // something below and hit Apply, not to immediately close the panel.
    } else {
      handleFollowDashboard();
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-1 rounded hover:bg-muted transition-colors"
          title={isCustomised ? "Time Range & Aggregation — set for this widget" : "Time Range & Aggregation — following the dashboard's range"}>
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          {isCustomised && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom" align="end" sideOffset={6}
        collisionBoundary={boundary ?? undefined}
        collisionPadding={10}
        // Radix reports the room it actually has as a CSS var. Capping to it (and
        // scrolling past that) means opening Custom range — which makes this panel
        // taller — can never push content out through the bottom of the canvas.
        className="w-80 max-w-[calc(100vw-1.25rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0"
      >
        <div className="px-3 py-2 flex items-center gap-2 border-b border-border bg-muted/40">
          <Clock className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-primary">Time Range &amp; Aggregation</span>
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
            {rangeLabelOf(isCustomised ? c : (dashTimeCfg ?? {}))}
          </span>
        </div>

        {/* A single on/off control for "set my own vs. follow the dashboard" —
            replaces the old buried text link, which read as an afterthought and
            was easy to miss. ON = this widget is independent; OFF = it follows the
            dashboard-wide range. Both directions commit immediately — see
            handleToggleOverride for why the old version only worked one way. */}
        <div className="px-3 py-2 flex items-center justify-between border-b border-border">
          <span className={cn("text-[11px] font-medium", isCustomised ? "text-foreground" : "text-muted-foreground")}>
            Allow override
          </span>
          <Switch
            checked={isCustomised}
            onCheckedChange={handleToggleOverride}
            className="scale-90"
          />
        </div>
        <p className="px-3 pt-2 text-[10px] text-muted-foreground">
          {isCustomised
            ? "Overridden for this widget — the dashboard-wide range selector no longer affects it. Change anything below and hit Apply."
            : "Following the dashboard's range. Turn on Allow override to set one just for this widget."}
        </p>

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

          {/* Stacked, not side by side. A `datetime-local` input needs ~150px before
              its native picker button, so two of them plus an arrow and a decorative
              calendar icon could never fit this panel's width — they overflowed past
              its right edge. Each row is now full-width, and the redundant icon is
              gone since every date input already has its own picker. */}
          {isCustom && (
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                <CalendarDays className="w-3 h-3" /> Custom Time Range
              </Label>
              <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">From</span>
                <Input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-7 w-full min-w-0 text-[11px] px-1.5" />
                <span className="text-[10px] text-muted-foreground">To</span>
                <Input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-7 w-full min-w-0 text-[11px] px-1.5" />
              </div>
              {(!customFrom || !customTo) && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">Set both dates, then Apply.</p>
              )}
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

          <div className="flex items-center justify-end">
            {/* Applying "Custom range" with a missing date would commit a config that
                getFromTo silently reads as the 60-minute default — a range the user
                never asked for, with nothing on screen to explain it. */}
            <Button size="sm" className="h-7 text-xs" disabled={isCustom && (!customFrom || !customTo)} onClick={handleApply}>Apply</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
