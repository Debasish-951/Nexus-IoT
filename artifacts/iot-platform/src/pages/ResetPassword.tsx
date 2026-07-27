import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, Check, AlertTriangle, Mail } from "lucide-react";
import AuthShell, { AUTH_INPUT_CLASS, AUTH_BUTTON_STYLE } from "./AuthShell";
import { PasswordInput, PasswordChecklist, PasswordStrengthMeter } from "@/components/PasswordFields";
import { apiGet, apiPost, usePasswordPolicy, validatePasswordAgainst } from "@/lib/auth-api";

/**
 * Password reset landing page — /reset-password?token=…
 *
 * Same two-step token handling as activation (validate on GET, consume on
 * POST). Completing a reset revokes every session for the account, so a
 * hijacked session cannot outlive the credential it was created with.
 */

interface Preview {
  email: string;
  username: string;
  fullName: string;
  expiresAt: string;
}

type Phase = "checking" | "form" | "invalid" | "done";

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const policy = usePasswordPolicy();

  const [token] = useState(() =>
    new URLSearchParams(window.location.search).get("token") ?? "");

  const [phase, setPhase] = useState<Phase>("checking");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [tokenError, setTokenError] = useState<{ message: string; code: string } | null>(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setTokenError({ message: "This reset link is missing its token. Please use the link exactly as it appears in your email.", code: "token_missing" });
      setPhase("invalid");
      return;
    }

    let cancelled = false;
    apiGet(`/api/auth/reset/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        const body = await res.json().catch(() => ({}));
        if (res.ok) { setPreview(body); setPhase("form"); }
        else {
          setTokenError({ message: body.error ?? "This reset link is not valid.", code: body.code ?? "token_invalid" });
          setPhase("invalid");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setTokenError({ message: "Could not reach the server. Please check your connection and try again.", code: "network" });
        setPhase("invalid");
      });

    return () => { cancelled = true; };
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) { setError("The two passwords do not match."); return; }
    const violations = validatePasswordAgainst(password, policy);
    if (violations.length > 0) { setError(violations[0]); return; }

    setSubmitting(true);
    try {
      const res = await apiPost("/api/auth/reset-password", { token, password });
      if (res.ok) {
        setPhase("done");
        setTimeout(() => navigate("/login"), 2200);
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(body.violations?.[0] ?? body.error ?? "Password reset failed. Please try again.");
      if (["token_expired", "token_consumed", "token_revoked", "token_invalid"].includes(body.code)) {
        setTokenError({ message: body.error, code: body.code });
        setPhase("invalid");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "checking") {
    return (
      <AuthShell>
        <div className="flex items-center gap-3 py-6 text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Checking your reset link…</span>
        </div>
      </AuthShell>
    );
  }

  if (phase === "invalid") {
    const expired = tokenError?.code === "token_expired" || tokenError?.code === "token_revoked";
    return (
      <AuthShell title={expired ? "This link has expired" : "This link is not valid"}>
        <div className="mt-5 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-sm leading-relaxed text-amber-200">{tokenError?.message}</p>
        </div>
        <p className="mt-5 text-sm leading-relaxed text-slate-400">
          Reset links are single-use and short-lived. Request a new one from the sign-in page.
        </p>
        <Button
          onClick={() => navigate("/login")}
          className="mt-6 h-11 w-full rounded-lg font-semibold text-[#0d0820] transition-transform hover:brightness-110 active:scale-[0.99]"
          style={AUTH_BUTTON_STYLE}
        >
          Back to sign in
        </Button>
      </AuthShell>
    );
  }

  if (phase === "done") {
    return (
      <AuthShell>
        <div className="flex flex-col items-center py-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10">
            <Check className="h-6 w-6 text-emerald-400" />
          </div>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">Password updated</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            You have been signed out everywhere else. Taking you to the sign-in page…
          </p>
        </div>
      </AuthShell>
    );
  }

  const expiresAt = preview ? new Date(preview.expiresAt) : null;

  return (
    <AuthShell title="Choose a new password" subtitle="Your new password replaces the old one immediately.">
      <div className="mt-5 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
        <Mail className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span className="truncate text-xs">{preview?.email}</span>
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" aria-label="Choose a new password">
        <div className="[&_label]:text-slate-400">
          <PasswordInput
            id="new-password" label="New password" value={password} onChange={setPassword}
            autoFocus inputClassName={AUTH_INPUT_CLASS}
          />
        </div>
        <PasswordStrengthMeter password={password} policy={policy} />
        <PasswordChecklist password={password} policy={policy} />

        <div className="[&_label]:text-slate-400">
          <PasswordInput
            id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm}
            inputClassName={AUTH_INPUT_CLASS}
            error={!!confirm && confirm !== password}
          />
        </div>
        {confirm && confirm !== password && (
          <p className="text-[11px] text-red-300">The two passwords do not match.</p>
        )}

        {error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={submitting || !password || !confirm}
          className="h-11 w-full rounded-lg font-semibold text-[#0d0820] transition-transform hover:brightness-110 active:scale-[0.99]"
          style={AUTH_BUTTON_STYLE}
        >
          {submitting
            ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Updating…</span>
            : <span className="inline-flex items-center gap-2">Update password <ArrowRight className="h-4 w-4" /></span>}
        </Button>

        {expiresAt && (
          <p className="text-center text-[11px] text-slate-500">
            This link expires {expiresAt.toLocaleString()}
          </p>
        )}
      </form>
    </AuthShell>
  );
}
