/**
 * Second-administrator rules for sensitive-action alerts (audit 23 Nov 2026, L-27).
 *
 * The alerts exist to tell other administrators what one administrator did. One
 * administrator could switch them off, and acknowledge the alerts their own
 * actions raised, so nobody else would see them.
 *
 *   - Switching an alert OFF needs two different administrators: the first
 *     request is recorded as pending, and it takes effect when another
 *     administrator makes the same change within PENDING_TTL_MS. Switching an
 *     alert ON is immediate and cancels a pending request.
 *   - An alert raised by an administrator's own action cannot be acknowledged by
 *     that administrator.
 *
 * AUDIT_ALERTS_SECOND_ADMIN=false restores the previous single-administrator
 * behaviour, for an installation with only one administrator.
 */

export const PENDING_TTL_MS = 7 * 86_400_000;

export interface PendingDisable {
  rule: string;
  requestedById: string;
  requestedBy: string;
  requestedAt: string;
}

export function secondAdminRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AUDIT_ALERTS_SECOND_ADMIN ?? "true").trim().toLowerCase() !== "false";
}

export interface AlertPlan {
  /** Alert switches to save now. */
  apply: Record<string, boolean>;
  /** Pending requests after this change. */
  pending: PendingDisable[];
  /** Rules this request asked to switch off that now wait for a second administrator. */
  waiting: string[];
  /** Rules switched off now because a second administrator confirmed. */
  confirmed: string[];
}

/** Pure decision; the route loads and stores the state. */
export function planAlertChanges(
  current: Record<string, boolean>,
  requested: Record<string, boolean> | undefined,
  pendingIn: PendingDisable[],
  actor: { id: string; name: string },
  now = Date.now(),
): AlertPlan {
  let pending = pendingIn.filter((p) => now - Date.parse(p.requestedAt) < PENDING_TTL_MS);
  const apply: Record<string, boolean> = {};
  const waiting: string[] = [];
  const confirmed: string[] = [];

  for (const [rule, on] of Object.entries(requested ?? {})) {
    const isOn = current[rule] ?? true;
    if (on) {
      apply[rule] = true;
      pending = pending.filter((p) => p.rule !== rule);
      continue;
    }
    if (!isOn) { apply[rule] = false; continue; }
    const existing = pending.find((p) => p.rule === rule);
    if (existing && existing.requestedById !== actor.id) {
      apply[rule] = false;
      confirmed.push(rule);
      pending = pending.filter((p) => p.rule !== rule);
    } else {
      waiting.push(rule);
      if (!existing) pending.push({ rule, requestedById: actor.id, requestedBy: actor.name, requestedAt: new Date(now).toISOString() });
    }
  }
  return { apply, pending, waiting, confirmed };
}
