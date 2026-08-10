import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle, WifiOff, Radio, KeyRound, CheckCircle2, ChevronRight, Activity as ActivityIcon,
  Box, User, Settings, Wrench, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/contexts/UserContext";
import type { DashboardAttention, AttentionItem } from "@workspace/api-client-react";
import {
  Panel, BandHeader, EmptyHint, PanelSkeleton, SEVERITY, severityOf, formatAge, formatDuration,
} from "./primitives";

/**
 * Band 2 — "What needs a human?"
 *
 * One ranked queue rather than four lists. The server does the merge and the
 * ranking (see /dashboard/attention) precisely because the order is only
 * meaningful across the whole set.
 */

const KIND_ICON: Record<AttentionItem["kind"], React.ElementType> = {
  alarm: AlertTriangle,
  stale: WifiOff,
  unbound_device: Radio,
  api_key: KeyRound,
};

/**
 * Which permission each action needs.
 *
 * The button is hidden without it. This mirrors the server rather than
 * replacing it — `middleware/authorize.ts` is what actually refuses the call.
 * Showing an operator an Acknowledge button that 403s is a worse experience
 * than not showing it, which is the only thing this map is for.
 */
const KIND_PERMISSION: Record<AttentionItem["kind"], string | null> = {
  alarm: "acknowledge_alarms",
  stale: null,
  unbound_device: "manage_assets",
  api_key: "manage_api_clients",
};

const ACTIVITY_ICON: Record<string, React.ElementType> = {
  asset: Box, alarm: AlertTriangle, user: User,
  system: Settings, maintenance: Wrench, template: FileText,
};

export interface ActivityEntry {
  id: string; action: string; category: string;
  actorName: string; targetName: string | null; detail: string | null; timestamp: string;
}

function QueueRow({ item }: { item: AttentionItem }) {
  const [, navigate] = useLocation();
  const { can } = useCurrentUser();
  const sev = severityOf(item.severity);
  const Icon = KIND_ICON[item.kind];
  const permission = KIND_PERMISSION[item.kind];
  const mayAct = !permission || can(permission);

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-border/50 last:border-0
                    hover:bg-muted/20 transition-colors">
      <span className={cn("w-[3px] self-stretch rounded-sm shrink-0 min-h-[38px]", SEVERITY[sev].bar)} />
      <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", SEVERITY[sev].text)} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold truncate">{item.title}</p>
        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{item.detail}</p>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
          {formatAge(item.ageSeconds)}
        </span>
        {mayAct && (
          <Button size="sm" variant={sev === "critical" ? "default" : "outline"}
                  className="h-6 px-2 text-[11px]"
                  onClick={() => navigate(item.action.href)}>
            {item.action.label}
          </Button>
        )}
      </div>
    </div>
  );
}

export function BandAttention({ data, activities, loading }: {
  data?: DashboardAttention;
  activities: ActivityEntry[];
  loading: boolean;
}) {
  const [, navigate] = useLocation();
  const items = data?.items ?? [];
  const inProgress = data?.inProgress ?? [];
  const clearedToday = data?.clearedToday ?? [];

  const avgOpen = clearedToday.length
    ? clearedToday.reduce((s, a) => s + (a.openSeconds ?? 0), 0) / clearedToday.length
    : null;

  return (
    <>
      <BandHeader n={2} title="Act now" question="“What needs a human?”" context="Live" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">

        <Panel
          className={cn("lg:col-span-2", items.length > 0 && "border-orange-500/25")}
          title="Attention queue"
          sub="Alarms, stale assets, unbound devices and expiring keys — one ranked list"
          badge={items.length > 0
            ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-500">
                {data?.counts.total}
              </span>
            : undefined}
          action={<button onClick={() => navigate("/alarms")}
                          className="text-muted-foreground hover:text-foreground">
                    <ChevronRight className="w-4 h-4" />
                  </button>}
        >
          {loading && !data ? <PanelSkeleton rows={4} /> : items.length === 0 ? (
            <EmptyHint
              icon={CheckCircle2}
              title="Nothing needs attention"
              hint={data
                ? `No open alarms, every asset with a device id has reported within ${data.staleMinutes} minutes, and no device is sending data without an asset bound.`
                : undefined}
            />
          ) : (
            <div>{items.map((item) => <QueueRow key={item.key} item={item} />)}</div>
          )}
        </Panel>

        <div className="flex flex-col gap-3.5">
          <Panel title="In progress" sub="Acknowledged, not yet cleared">
            {inProgress.length === 0 ? (
              <p className="px-4 py-5 text-xs text-muted-foreground text-center">
                Nothing acknowledged and still open
              </p>
            ) : (
              <div>
                {inProgress.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-4 py-2.5 border-b border-border/50 last:border-0">
                    <span className={cn("w-[3px] self-stretch rounded-sm shrink-0 min-h-[28px]",
                      SEVERITY[severityOf(a.severity)].bar)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{a.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {a.assetName ?? "—"}
                        {a.acknowledgedAt &&
                          ` · ${formatDistanceToNow(new Date(a.acknowledgedAt), { addSuffix: true })}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Cleared today"
            sub={clearedToday.length
              ? `${clearedToday.length} alarm${clearedToday.length === 1 ? "" : "s"}${avgOpen != null ? ` · avg ${formatDuration(avgOpen)} open` : ""}`
              : "Nothing cleared yet today"}
          >
            {clearedToday.length === 0 ? (
              <p className="px-4 py-5 text-xs text-muted-foreground text-center">
                Alarms cleared today will land here
              </p>
            ) : (
              <div className="px-4 py-1">
                {clearedToday.slice(0, 6).map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 py-1.5
                                             border-b border-border/40 last:border-0 text-[11.5px]">
                    <span className="text-muted-foreground truncate">
                      {a.name}{a.assetName ? ` — ${a.assetName}` : ""}
                    </span>
                    <span className="text-muted-foreground/70 tabular-nums shrink-0">
                      {formatDuration(a.openSeconds)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            className="flex-1"
            title="Recent activity"
            sub="Who changed what"
            action={<button onClick={() => navigate("/activity-log")}
                            className="text-muted-foreground hover:text-foreground">
                      <ChevronRight className="w-4 h-4" />
                    </button>}
          >
            {activities.length === 0 ? (
              <p className="px-4 py-5 text-xs text-muted-foreground text-center">No recent activity</p>
            ) : (
              <div>
                {activities.slice(0, 5).map((e) => {
                  const Icon = ACTIVITY_ICON[e.category] ?? ActivityIcon;
                  return (
                    <div key={e.id} className="flex items-start gap-2.5 px-4 py-2.5 border-b border-border/50 last:border-0">
                      <span className="p-1.5 rounded-md bg-muted shrink-0">
                        <Icon className="w-3 h-3 text-muted-foreground" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs truncate">
                          {e.detail ?? `${e.action}${e.targetName ? ` — ${e.targetName}` : ""}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">by {e.actorName}</p>
                      </div>
                      <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">
                        {formatDistanceToNow(new Date(e.timestamp), { addSuffix: false })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
