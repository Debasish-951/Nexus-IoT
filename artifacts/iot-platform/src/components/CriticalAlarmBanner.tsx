import { useState } from "react";
import { Link } from "wouter";
import { AlertCircle, X } from "lucide-react";
import { useOpenAlarms } from "@/hooks/useOpenAlarms";
import { useProjectScope } from "@/hooks/useProjectScope";

/**
 * One thin line under the top bar while a critical alarm is unacknowledged.
 *
 * Critical only, and never more than one line, so it cannot stack up the way alarm
 * pop-ups did. Dismissing applies to the alarms open at that moment: a new critical
 * alarm brings it back. Everything else is in the notification bell.
 */
export default function CriticalAlarmBanner() {
  const { alarms } = useOpenAlarms();
  // Global across projects, so the alarm names its project.
  const { whereLabel } = useProjectScope();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const critical = alarms.filter((a) => a.severity === "critical" && a.status === "active");
  const showing = critical.filter((a) => !dismissed.has(a.id));
  if (showing.length === 0) return null;

  const first = showing[0]!;
  return (
    <div role="alert" className="flex items-center gap-2 px-4 py-1.5 shrink-0 bg-red-600 text-white text-xs">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1 min-w-0 truncate font-medium">
        {showing.length > 1
          ? `${showing.length} critical alarms open`
          : `Critical: ${first.name || first.message || "Alarm"}, ${whereLabel(first.assetId, first.assetName)}`}
      </span>
      <Link href="/alarms" className="underline shrink-0 font-semibold">View</Link>
      <button type="button" aria-label="Dismiss" title="Dismiss" className="shrink-0 hover:opacity-80"
              onClick={() => setDismissed(new Set(critical.map((a) => a.id)))}>
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
