import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/auth-api";
import { useCurrentUser } from "@/contexts/UserContext";

export interface OpenAlarm {
  id: string;
  name: string;
  assetId?: string;
  assetName: string;
  severity: string;
  status: "active" | "acknowledged";
  message: string | null;
  triggeredAt: string;
}

export const OPEN_ALARMS_KEY = ["open-alarms"];

async function fetchStatus(status: string): Promise<OpenAlarm[]> {
  const res = await apiFetch(`/api/alarms?status=${status}`);
  if (!res.ok) throw new Error(`Could not load alarms (${res.status})`);
  return res.json();
}

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/**
 * Alarms open right now, most severe first, from the server. The bell and the
 * critical banner share this, so they cannot disagree and a page refresh loses nothing.
 * NotificationBell refreshes it when a live alarm event arrives.
 */
export function useOpenAlarms() {
  const { canModule } = useCurrentUser();
  const enabled = canModule("alarms");
  const query = useQuery({
    queryKey: OPEN_ALARMS_KEY,
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [active, acknowledged] = await Promise.all([fetchStatus("active"), fetchStatus("acknowledged")]);
      return [...active, ...acknowledged].sort((a, b) =>
        (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || b.triggeredAt.localeCompare(a.triggeredAt));
    },
  });
  return { enabled, alarms: query.data ?? [] };
}
