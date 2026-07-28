import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight } from "lucide-react";
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
 * of 403s. Deliberately bare: the whole step is new password → confirm → done.
 */
export default function ForcePasswordChange() {
  const [, navigate] = useLocation();
  const policy = usePasswordPolicy();
  const { currentUser, refresh, logout } = useCurrentUser();

  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (next !== confirm) { setError("The two passwords do not match."); return; }
    const violations = validatePasswordAgainst(next, policy);
    if (violations.length > 0) { setError(violations[0]); return; }

    setSubmitting(true);
    try {
      // No currentPassword: the temporary one was already proved at sign-in, and
      // this session cannot reach anything else until the change lands. Reuse of
      // the temporary password is rejected server-side, against the stored hash.
      const res = await apiPost("/api/auth/change-password", { newPassword: next });
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

  return (
    <AuthShell
      title="Generate your password"
      subtitle={`Set your own password to continue, ${currentUser?.fullName ?? ""}.`}
    >
      <form onSubmit={onSubmit} className="mt-6 space-y-4" aria-label="Generate your password">
        <div className="[&_label]:text-slate-400">
          <PasswordInput
            id="new-password" label="New password" value={next} onChange={setNext}
            autoComplete="new-password" autoFocus inputClassName={AUTH_INPUT_CLASS}
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
          disabled={submitting || !next || !confirm}
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
