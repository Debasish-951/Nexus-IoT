import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, ShieldAlert, Clock } from "lucide-react";
import AuthShell, { AUTH_INPUT_CLASS, AUTH_BUTTON_STYLE } from "./AuthShell";
import { PasswordInput, PasswordChecklist, PasswordStrengthMeter } from "@/components/PasswordFields";
import { apiPost, usePasswordPolicy, validatePasswordAgainst } from "@/lib/auth-api";
import { useCurrentUser } from "@/contexts/UserContext";

/**
 * Blocking screen shown when the signed-in account is on an admin-issued
 * temporary password (`mustChangePassword`).
 *
 * This is not a nag — the API refuses every endpoint except /auth/change-password
 * while the flag is set, so without this screen the app would just render a wall
 * of 403s. Rendering it in place of the whole application keeps the UI honest
 * about what the session can actually do.
 */
export default function ForcePasswordChange() {
  const [, navigate] = useLocation();
  const policy = usePasswordPolicy();
  const { currentUser, session, refresh, logout } = useCurrentUser();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  // Live countdown on the temporary credential. Once it lapses the session is
  // still valid, but re-authenticating would fail — so say so plainly.
  useEffect(() => {
    const expiry = session?.passwordExpiresAt;
    if (!expiry) return;
    const tick = () => setRemaining(new Date(expiry).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session?.passwordExpiresAt]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (next !== confirm) { setError("The two passwords do not match."); return; }
    if (next === current) { setError("Your new password must be different from the temporary one."); return; }
    const violations = validatePasswordAgainst(next, policy);
    if (violations.length > 0) { setError(violations[0]); return; }

    setSubmitting(true);
    try {
      const res = await apiPost("/api/auth/change-password", {
        currentPassword: current,
        newPassword: next,
      });
      if (res.ok) {
        // Re-read the session so mustChangePassword clears and the app unlocks.
        await refresh();
        navigate("/");
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(body.violations?.[0] ?? body.error ?? "Could not change your password.");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const expired = remaining !== null && remaining <= 0;
  const minutes = remaining !== null ? Math.max(0, Math.floor(remaining / 60_000)) : null;
  const seconds = remaining !== null ? Math.max(0, Math.floor((remaining % 60_000) / 1000)) : null;

  return (
    <AuthShell
      title="Choose your password"
      subtitle={`You signed in with a temporary password. Set your own to continue, ${currentUser?.fullName ?? ""}.`}
    >
      <div className="mt-5 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <p className="text-sm leading-relaxed text-amber-200">
          Until you do this, every part of the platform is locked. This is enforced by the
          API, not just hidden in the interface.
        </p>
      </div>

      {remaining !== null && (
        <div className={`mt-3 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm ${
          expired
            ? "border-red-500/30 bg-red-500/10 text-red-300"
            : "border-white/10 bg-white/[0.03] text-slate-300"
        }`}>
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {expired
            ? <span>The temporary password has expired. Finish now if you can — if it fails, ask for a new one.</span>
            : <span>Temporary password expires in <strong className="tabular-nums">{minutes}m {seconds}s</strong></span>}
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-4" aria-label="Choose your password">
        <div className="[&_label]:text-slate-400">
          <PasswordInput
            id="current-password" label="Temporary password" value={current} onChange={setCurrent}
            autoComplete="current-password" autoFocus inputClassName={AUTH_INPUT_CLASS}
          />
        </div>
        <div className="[&_label]:text-slate-400">
          <PasswordInput
            id="new-password" label="New password" value={next} onChange={setNext}
            inputClassName={AUTH_INPUT_CLASS}
          />
        </div>
        <PasswordStrengthMeter password={next} policy={policy} />
        <PasswordChecklist password={next} policy={policy} />

        <div className="[&_label]:text-slate-400">
          <PasswordInput
            id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm}
            inputClassName={AUTH_INPUT_CLASS}
            error={!!confirm && confirm !== next}
          />
        </div>
        {confirm && confirm !== next && (
          <p className="text-[11px] text-red-300">The two passwords do not match.</p>
        )}

        {error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={submitting || !current || !next || !confirm}
          className="h-11 w-full rounded-lg font-semibold text-[#0d0820] transition-transform hover:brightness-110 active:scale-[0.99]"
          style={AUTH_BUTTON_STYLE}
        >
          {submitting
            ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Saving…</span>
            : <span className="inline-flex items-center gap-2">Set my password <ArrowRight className="h-4 w-4" /></span>}
        </Button>

        <button
          type="button"
          onClick={async () => { await logout(); navigate("/login"); }}
          className="w-full text-center text-sm text-slate-400 hover:text-slate-200"
        >
          Sign out instead
        </button>
      </form>
    </AuthShell>
  );
}
