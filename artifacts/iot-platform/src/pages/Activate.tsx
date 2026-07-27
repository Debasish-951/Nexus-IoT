import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, Check, AlertTriangle, Mail, User } from "lucide-react";
import AuthShell, { AUTH_INPUT_CLASS, AUTH_BUTTON_STYLE } from "./AuthShell";
import { PasswordInput, PasswordChecklist, PasswordStrengthMeter } from "@/components/PasswordFields";
import { apiGet, apiPost, usePasswordPolicy, validatePasswordAgainst } from "@/lib/auth-api";

/**
 * Step 5 of the onboarding workflow — first-time account activation.
 *
 * Reached from the emailed link at /activate?token=…
 *
 * The token is validated by a GET first, and only consumed by the POST once a
 * policy-compliant password is submitted. That split matters: corporate mail
 * scanners follow links, so a GET that consumed the token would burn every
 * invitation before the recipient ever clicked it.
 */

interface Preview {
  email: string;
  username: string;
  fullName: string;
  role: string;
  expiresAt: string;
}

type Phase = "checking" | "form" | "invalid" | "done";

export default function Activate() {
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
      setTokenError({ message: "This activation link is missing its token. Please use the link exactly as it appears in your email.", code: "token_missing" });
      setPhase("invalid");
      return;
    }

    let cancelled = false;
    apiGet(`/api/auth/activation/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          setPreview(body);
          setPhase("form");
        } else {
          setTokenError({ message: body.error ?? "This activation link is not valid.", code: body.code ?? "token_invalid" });
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
      const res = await apiPost("/api/auth/activate", { token, password });
      if (res.ok) {
        setPhase("done");
        // Brief confirmation, then hand off to the real login — activation
        // deliberately does not sign the user in, so the first thing they do is
        // prove the password works.
        setTimeout(() => navigate("/login"), 2200);
        return;
      }
      const body = await res.json().catch(() => ({}));
      // The server's message is authoritative — it knows about the common-password
      // and contextual rules the client cannot check.
      setError(body.violations?.[0] ?? body.error ?? "Activation failed. Please try again.");
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

  // ── Checking ───────────────────────────────────────────────────────────────
  if (phase === "checking") {
    return (
      <AuthShell>
        <div className="flex items-center gap-3 py-6 text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Checking your activation link…</span>
        </div>
      </AuthShell>
    );
  }

  // ── Invalid / expired ──────────────────────────────────────────────────────
  if (phase === "invalid") {
    const expired = tokenError?.code === "token_expired" || tokenError?.code === "token_revoked";
    return (
      <AuthShell title={expired ? "This link has expired" : "This link is not valid"}>
        <div className="mt-5 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-sm leading-relaxed text-amber-200">{tokenError?.message}</p>
        </div>
        <p className="mt-5 text-sm leading-relaxed text-slate-400">
          Ask your administrator to resend your invitation from the Users console. Activation links are
          single-use, and sending a new one invalidates the old one.
        </p>
        <Button
          onClick={() => navigate("/login")}
          className="mt-6 h-11 w-full rounded-lg font-semibold text-[#0d0820] transition-transform hover:brightness-110 active:scale-[0.99]"
          style={AUTH_BUTTON_STYLE}
        >
          Go to sign in
        </Button>
      </AuthShell>
    );
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (phase === "done") {
    return (
      <AuthShell>
        <div className="flex flex-col items-center py-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10">
            <Check className="h-6 w-6 text-emerald-400" />
          </div>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">Account activated</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Your password is set. Taking you to the sign-in page…
          </p>
        </div>
      </AuthShell>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  const expiresAt = preview ? new Date(preview.expiresAt) : null;

  return (
    <AuthShell
      title={`Welcome, ${preview?.fullName ?? ""}`}
      subtitle="Choose a password to finish setting up your account."
    >
      <div className="mt-5 space-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
        <div className="flex items-center gap-2 text-slate-300">
          <User className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span className="font-mono text-xs">{preview?.username}</span>
          <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
            {preview?.role}
          </span>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <Mail className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span className="truncate text-xs">{preview?.email}</span>
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" aria-label="Set your password">
        <div className="[&_label]:text-slate-400">
          <PasswordInput
            id="new-password" label="Create password" value={password} onChange={setPassword}
            autoFocus inputClassName={AUTH_INPUT_CLASS}
          />
        </div>
        <PasswordStrengthMeter password={password} policy={policy} />
        <PasswordChecklist password={password} policy={policy} />

        <div className="[&_label]:text-slate-400">
          <PasswordInput
            id="confirm-password" label="Confirm password" value={confirm} onChange={setConfirm}
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
            ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Activating…</span>
            : <span className="inline-flex items-center gap-2">Activate my account <ArrowRight className="h-4 w-4" /></span>}
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
