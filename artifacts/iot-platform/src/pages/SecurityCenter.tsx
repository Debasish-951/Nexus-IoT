import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Shield, LogIn, Activity, Monitor, AlertTriangle, CheckCircle2, XCircle,
  Ban, Clock, Users as UsersIcon, RefreshCw, LogOut, Mail, KeyRound, Settings2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { apiGet, apiFetch } from "@/lib/auth-api";
import { useCurrentUser } from "@/contexts/UserContext";

/**
 * Security Center — the read side of the audit story plus live session control.
 *
 * Everything here comes from `security_events` and `sessions`, which the
 * auth upgrade introduced. It exists so an administrator can answer "who tried
 * to get in, what was refused, and who is signed in right now?" without a
 * database shell.
 */

// ── Presentation maps ────────────────────────────────────────────────────────

const EVENT_META: Record<string, { label: string; icon: React.ElementType; tone: string }> = {
  "login.success":            { label: "Sign-in",              icon: LogIn,         tone: "emerald" },
  "login.failure":            { label: "Failed sign-in",       icon: XCircle,       tone: "red" },
  "login.blocked":            { label: "Sign-in blocked",      icon: Ban,           tone: "amber" },
  "login.rate_limited":       { label: "Rate limited",         icon: Clock,         tone: "amber" },
  "logout":                   { label: "Sign-out",             icon: LogOut,        tone: "slate" },
  "session.expired":          { label: "Session expired",      icon: Clock,         tone: "slate" },
  "session.revoked":          { label: "Session revoked",      icon: Ban,           tone: "amber" },
  "account.locked":           { label: "Account locked",       icon: Ban,           tone: "red" },
  "account.unlocked":         { label: "Account unlocked",     icon: CheckCircle2,  tone: "emerald" },
  "account.status_changed":   { label: "Account changed",      icon: Settings2,     tone: "amber" },
  "user.invited":             { label: "User invited",         icon: Mail,          tone: "violet" },
  "user.activated":           { label: "Account activated",    icon: CheckCircle2,  tone: "emerald" },
  "invitation.resent":        { label: "Invitation resent",    icon: Mail,          tone: "violet" },
  "password_reset.requested": { label: "Reset requested",      icon: KeyRound,      tone: "violet" },
  "password_reset.completed": { label: "Reset completed",      icon: KeyRound,      tone: "emerald" },
  "password.changed":         { label: "Password changed",     icon: KeyRound,      tone: "emerald" },
  "authz.denied":             { label: "Access denied",        icon: Shield,        tone: "red" },
  "csrf.failed":              { label: "CSRF rejected",        icon: AlertTriangle, tone: "red" },
  "email.failed":             { label: "Email failed",         icon: Mail,          tone: "red" },
  "access.updated":           { label: "Permissions changed",  icon: Settings2,     tone: "violet" },
};

const TONE_CLASS: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  red:     "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  amber:   "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  violet:  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  slate:   "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

/** Machine reason codes → something an administrator can act on. */
const REASON_LABELS: Record<string, string> = {
  unknown_user: "No such user",
  bad_password: "Wrong password",
  locked: "Account was locked",
  rate_limited: "Too many attempts from this IP",
  legacy_credential: "Pre-upgrade credential — must re-activate",
  activation_pending: "Not yet activated",
  status_invited: "Not yet activated",
  status_suspended: "Account suspended",
  status_inactive: "Account inactive",
  failed_login_threshold: "Hit the failed-attempt threshold",
  idle_or_absolute_timeout: "Session timed out",
  admin_revoked: "Revoked by an administrator",
  admin_revoked_all: "All sessions revoked by an administrator",
  no_rule: "Endpoint has no authorisation rule",
  missing_header: "CSRF header not sent",
  cookie_mismatch: "CSRF cookie/header mismatch",
  self_service: "Requested by the user",
  admin_initiated: "Started by an administrator",
};

function reasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  if (REASON_LABELS[reason]) return REASON_LABELS[reason];
  if (reason.startsWith("missing_permission:")) return `Missing permission: ${reason.split(":")[1]}`;
  if (reason.startsWith("missing_module:")) return `Missing module access: ${reason.split(":")[1]}`;
  return reason.replace(/_/g, " ");
}

interface SecurityEvent {
  id: string;
  userId: string | null;
  username: string | null;
  eventType: string;
  outcome: string;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

interface SessionRow {
  id: string;
  userId: string;
  username: string;
  fullName: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

// ── Data hooks ───────────────────────────────────────────────────────────────

function useJson<T>(key: unknown[], path: string, refetchInterval?: number) {
  return useQuery<T>({
    queryKey: key,
    queryFn: async () => {
      const res = await apiGet(path);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Request failed");
      return res.json();
    },
    refetchInterval,
  });
}

// ── Summary tiles ────────────────────────────────────────────────────────────

function StatTile({
  icon: Icon, label, value, tone = "slate", hint,
}: { icon: React.ElementType; label: string; value: React.ReactNode; tone?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", TONE_CLASS[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

function SummaryPanel() {
  const { data, isLoading } = useJson<any>(["security-summary"], "/api/security/summary", 30_000);

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-lg" />)}
      </div>
    );
  }
  if (!data) return null;

  const cfg = data.config ?? {};

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={CheckCircle2} label="Successful sign-ins" value={data.loginSuccess} tone="emerald" hint="last 24 hours" />
        <StatTile icon={XCircle} label="Failed sign-ins" value={data.loginFailure}
          tone={data.loginFailure > 0 ? "red" : "slate"} hint="last 24 hours" />
        <StatTile icon={Shield} label="Access denials" value={data.authzDenied}
          tone={data.authzDenied > 0 ? "amber" : "slate"} hint="last 24 hours" />
        <StatTile icon={Monitor} label="Active sessions" value={data.activeSessions} tone="violet" />
        <StatTile icon={Ban} label="Locked accounts" value={data.lockedAccounts}
          tone={data.lockedAccounts > 0 ? "red" : "slate"} hint="auto-unlock on expiry" />
        <StatTile icon={Mail} label="Pending invitations" value={data.pendingInvitations} tone="violet"
          hint="awaiting activation" />
        <StatTile icon={Clock} label="Session timeout" value={`${cfg.sessionIdleMinutes}m`}
          hint={`${cfg.sessionAbsoluteHours}h absolute`} />
        <StatTile icon={Ban} label="Lockout policy" value={`${cfg.lockoutThreshold} tries`}
          hint={`${cfg.lockoutMinutes} minute lock`} />
      </div>

      {/* Deployed configuration, so an admin can verify policy without shell access. */}
      <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deployed policy</h3>
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Activation link validity", `${cfg.activationTtlHours} hours`],
            ["Password reset validity", `${cfg.passwordResetTtlMinutes} minutes`],
            ["Email transport", cfg.emailTransport],
            ["Route authorisation", cfg.enforcementEnabled ? "Enforced" : "DISABLED"],
          ].map(([k, v]) => (
            <div key={k as string} className="flex justify-between gap-3 border-b border-border/40 pb-1">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className={cn("font-medium",
                k === "Route authorisation" && !cfg.enforcementEnabled && "text-red-600 dark:text-red-400")}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {cfg.emailTransport === "console" && (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Email transport is <strong>console</strong> — activation and reset links are written to the
            server log instead of being emailed. Set <code>AUTH_EMAIL_TRANSPORT</code> before going live.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Event table ──────────────────────────────────────────────────────────────

function EventTable({ path, queryKey, showTypeFilter }: {
  path: string; queryKey: string; showTypeFilter: boolean;
}) {
  const [days, setDays] = useState("7");
  const [outcome, setOutcome] = useState("all");
  const [eventType, setEventType] = useState("all");

  const params = new URLSearchParams({ limit: "200", days });
  if (outcome !== "all") params.set("outcome", outcome);
  if (eventType !== "all") params.set("eventType", eventType);

  const { data, isLoading, refetch, isFetching } =
    useJson<{ entries: SecurityEvent[]; total: number }>(
      [queryKey, days, outcome, eventType], `${path}?${params}`, 20_000);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 24 hours</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>

        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            <SelectItem value="success">Success only</SelectItem>
            <SelectItem value="failure">Failures only</SelectItem>
          </SelectContent>
        </Select>

        {showTypeFilter && (
          <Select value={eventType} onValueChange={setEventType}>
            <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All event types</SelectItem>
              {Object.entries(EVENT_META).map(([key, meta]) => (
                <SelectItem key={key} value={key}>{meta.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button variant="outline" size="sm" className="ml-auto h-8" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-4 py-2.5 font-medium text-muted-foreground">When</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Event</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">User</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Detail</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Source IP</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 5 }).map((__, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>
                      ))}
                    </tr>
                  ))
                : (data?.entries.length ?? 0) === 0
                ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                      <Shield className="mx-auto mb-2 h-8 w-8 opacity-30" />
                      No events in this window
                    </td>
                  </tr>
                )
                : data!.entries.map((e) => {
                  const meta = EVENT_META[e.eventType] ?? { label: e.eventType, icon: Activity, tone: "slate" };
                  const Icon = meta.icon;
                  const created = new Date(e.createdAt);
                  return (
                    <tr key={e.id} className="border-b border-border/50 transition-colors hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                        <span title={created.toISOString()}>{format(created, "MMM d, HH:mm:ss")}</span>
                        <span className="block text-[10px] opacity-70">
                          {formatDistanceToNow(created, { addSuffix: true })}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                          TONE_CLASS[e.outcome === "failure" && meta.tone === "slate" ? "red" : meta.tone],
                        )}>
                          <Icon className="h-3 w-3" /> {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {e.username ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {reasonLabel(e.reason) ?? "—"}
                        {typeof e.detail?.path === "string" && (
                          <code className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px]">
                            {String(e.detail.method ?? "")} {e.detail.path}
                          </code>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                        {e.ip ?? "—"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {data && (
        <p className="text-xs text-muted-foreground">
          Showing {data.entries.length} of {data.total} event{data.total === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}

// ── Sessions ─────────────────────────────────────────────────────────────────

function SessionsPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useJson<SessionRow[]>(["security-sessions"], "/api/security/sessions", 20_000);
  const [busy, setBusy] = useState<string | null>(null);

  async function revoke(session: SessionRow) {
    setBusy(session.id);
    try {
      const csrf = document.cookie.split(";").find((c) => c.trim().startsWith("is_csrf="))?.split("=")[1];
      const res = await apiFetch(`/api/security/sessions/${session.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {},
      });
      if (!res.ok) throw new Error();
      toast({ title: `Signed out ${session.fullName}` });
      qc.invalidateQueries({ queryKey: ["security-sessions"] });
      qc.invalidateQueries({ queryKey: ["security-summary"] });
    } catch {
      toast({ title: "Could not revoke that session", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>;
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-muted-foreground">
        <Monitor className="mx-auto mb-2 h-8 w-8 opacity-30" />
        <p className="text-sm">No active sessions</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((s) => (
        <div key={s.id} className={cn(
          "flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm",
          s.isCurrent ? "border-primary/40 bg-primary/5" : "border-border",
        )}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{s.fullName}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{s.username}</span>
              {s.isCurrent && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                  This device
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {s.ip ?? "unknown IP"} · last seen {formatDistanceToNow(new Date(s.lastSeenAt), { addSuffix: true })}
              {" · expires "}{format(new Date(s.expiresAt), "HH:mm")}
            </p>
            {s.userAgent && (
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground/70" title={s.userAgent}>
                {s.userAgent}
              </p>
            )}
          </div>
          <Button
            variant="outline" size="sm" className="h-8"
            disabled={busy === s.id || s.isCurrent}
            title={s.isCurrent ? "Use the profile menu to sign yourself out" : "Revoke this session"}
            onClick={() => revoke(s)}
          >
            <LogOut className="mr-1.5 h-3.5 w-3.5" /> Revoke
          </Button>
        </div>
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SecurityCenter() {
  const { currentUser } = useCurrentUser();

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Shield className="h-5 w-5 text-primary" /> Security Center
        </h1>
        <p className="text-sm text-muted-foreground">
          Sign-in history, security events, and active sessions across the platform.
        </p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview"><Activity className="mr-1.5 h-3.5 w-3.5" /> Overview</TabsTrigger>
          <TabsTrigger value="logins"><LogIn className="mr-1.5 h-3.5 w-3.5" /> Login History</TabsTrigger>
          <TabsTrigger value="events"><Shield className="mr-1.5 h-3.5 w-3.5" /> Security Events</TabsTrigger>
          <TabsTrigger value="sessions"><Monitor className="mr-1.5 h-3.5 w-3.5" /> Active Sessions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4"><SummaryPanel /></TabsContent>
        <TabsContent value="logins" className="mt-4">
          <EventTable path="/api/security/login-history" queryKey="login-history" showTypeFilter={false} />
        </TabsContent>
        <TabsContent value="events" className="mt-4">
          <EventTable path="/api/security/events" queryKey="security-events" showTypeFilter />
        </TabsContent>
        <TabsContent value="sessions" className="mt-4"><SessionsPanel /></TabsContent>
      </Tabs>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <UsersIcon className="h-3 w-3" />
        Viewing as {currentUser?.fullName}. Security events are retained
        independently of the Audit Log and survive user deletion.
      </p>
    </div>
  );
}
