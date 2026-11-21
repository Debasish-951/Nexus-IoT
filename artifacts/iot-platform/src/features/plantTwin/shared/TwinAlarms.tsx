import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { useListAlarms, useAcknowledgeAlarm, getListAlarmsQueryKey } from "@workspace/api-client-react";
import { useCurrentUser } from "@/contexts/UserContext";
import { useWsEvents } from "@/hooks/useWsEvents";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BellRing, Check } from "lucide-react";

/**
 * Active alarms for the assets a twin shows. Click an alarm to focus its machine
 * (or point); acknowledge it here when the user may. Users without access to
 * alarms see a short note instead.
 */
const SEV: Record<string, string> = { critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-500", low: "bg-sky-500", info: "bg-slate-400" };

export function useTwinAlarms(assetIds: string[]) {
  const { canModule } = useCurrentUser();
  const allowed = canModule("alarms", "read");
  const params = { status: "active" as any, limit: 200 } as any;
  const q = useListAlarms(params, { query: { enabled: allowed, refetchInterval: 30_000, retry: false } as any });
  const qc = useQueryClient();
  useWsEvents({ alarm: () => { if (allowed) qc.invalidateQueries({ queryKey: getListAlarmsQueryKey(params) }); } } as any);
  const ids = useMemo(() => new Set(assetIds.filter(Boolean)), [assetIds.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => ((q.data as any[] | undefined) ?? []).filter((a) => ids.has(a.assetId) && a.status !== "cleared"), [q.data, ids]);
  return { allowed, alarms: list as { id: string; name: string; assetId: string; assetName?: string; severity: string; status: string; message?: string | null; triggeredAt: string }[] };
}

export function TwinAlarms({ assetIds, onFocus, label }: { assetIds: string[]; onFocus?: (assetId: string) => void; label?: (assetId: string) => string | undefined }) {
  const t = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { can } = useCurrentUser() as any;
  const { allowed, alarms } = useTwinAlarms(assetIds);
  const ack = useAcknowledgeAlarm();
  const canAck = typeof can === "function" ? can("acknowledge_alarms") : false;
  return (
    <div className="space-y-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <BellRing className="w-3.5 h-3.5" /> {t("Active alarms")} {allowed && <span className="font-mono">{alarms.length}</span>}
      </h3>
      {!allowed ? <p className="text-xs text-muted-foreground">{t("You do not have access to alarms.")}</p>
        : !assetIds.length ? <p className="text-xs text-muted-foreground">{t("Link machines to assets to see their alarms here.")}</p>
        : !alarms.length ? <p className="text-xs text-muted-foreground">{t("No active alarms on the linked assets.")}</p>
        : (
          <div className="space-y-1 max-h-56 overflow-auto">
            {alarms.map((a) => (
              <div key={a.id} className="flex items-start gap-2 rounded border border-border px-2 py-1.5 text-xs hover:bg-muted/50">
                <span className={cn("mt-1 w-2 h-2 rounded-full shrink-0", SEV[a.severity] ?? "bg-slate-400")} />
                <button className="flex-1 min-w-0 text-left" onClick={() => onFocus?.(a.assetId)} title={t("Show this machine")}>
                  <span className="block font-medium truncate">{a.name}</span>
                  <span className="block text-muted-foreground truncate">{label?.(a.assetId) ?? a.assetName} · {new Date(a.triggeredAt).toLocaleTimeString()}{a.status === "acknowledged" ? ` · ${t("acknowledged")}` : ""}</span>
                </button>
                {canAck && a.status === "active" && (
                  <Button size="sm" variant="outline" className="h-6 px-1.5 text-[11px]" disabled={ack.isPending}
                    onClick={() => ack.mutate({ id: a.id } as any, {
                      onSuccess: () => qc.invalidateQueries({ queryKey: getListAlarmsQueryKey({ status: "active", limit: 200 } as any) }),
                      onError: (e: any) => toast({ title: t("Could not acknowledge the alarm"), description: e?.message, variant: "destructive" }),
                    })}>
                    <Check className="w-3 h-3 mr-0.5" />{t("Ack")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
