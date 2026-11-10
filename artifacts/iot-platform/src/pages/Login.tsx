import { useState } from "react";
import { useLocation } from "wouter";
import { useCurrentUser } from "@/contexts/UserContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Eye, EyeOff, Lock, ShieldCheck, ArrowRight, ArrowLeft, User, Mail, Check, Loader2, AlertTriangle,
} from "lucide-react";
import { apiPost } from "@/lib/auth-api";
import { NodeMesh } from "@/components/NodeMesh";

// ── Concept B "Split Signal": animated sensor-mesh hero (left) + sign-in (right).
// Deliberately dark, digital-twin themed. Lives outside the app Layout (no sidebar).
const VIOLET = "#8b7bff";
const VIOLET_HI = "#b06bff";
const CYAN = "#2dd4ff";

const INPUT_CLASS =
  "h-11 bg-[#0a1024]/70 border-white/10 text-slate-100 placeholder:text-slate-500 " +
  "focus-visible:ring-[#8b7bff] focus-visible:ring-offset-0 focus-visible:border-[#8b7bff]";

// Hexagon brand mark (CSP-safe, no image needed).
function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <path d="M24 3 42 13.5v21L24 45 6 34.5v-21L24 3Z" stroke={VIOLET} strokeWidth="1.6" />
      <path d="M24 12 34 18v12l-10 6-10-6V18l10-6Z" stroke={CYAN} strokeWidth="1.2" opacity="0.6" />
      <circle cx="24" cy="24" r="3.4" fill={VIOLET} />
    </svg>
  );
}

// Real Web Synergies logo on a white chip (the wordmark is dark, so it needs a
// light ground to read on this dark theme). Falls back to the mark + wordmark
// if the image file is missing.
function Brand() {
  const [imgOk, setImgOk] = useState(true);
  if (imgOk) {
    return (
      <div className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center rounded-xl bg-white px-6 py-4 shadow-lg shadow-black/30">
          <img src="/web-synergies-logo-login.png" alt="Web Synergies" draggable={false}
            className="h-28 w-auto select-none object-contain" onError={() => setImgOk(false)} />
        </span>
        <span className="font-mono text-base font-bold uppercase tracking-[0.22em] text-slate-300">
          Integrated Suite (IS)
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <LogoMark className="h-12 w-12 shrink-0" />
      <div className="leading-none">
        <div className="text-2xl font-extrabold tracking-tight text-white">
          Integrated<span style={{ color: VIOLET }}> Suite</span>
        </div>
        <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-slate-500">
          IS · Web Synergies
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  const [, navigate] = useLocation();
  const { applySession } = useCurrentUser();

  const [view, setView] = useState<"signin" | "forgot">("signin");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinguishes recoverable states (locked, not yet activated) from a plain
  // bad password, so the message can offer the right next step.
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Forgot-password — now a real server round trip.
  const [fpValue, setFpValue] = useState("");
  const [fpSent, setFpSent] = useState(false);
  const [fpLoading, setFpLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    setLoading(true);
    try {
      const res = await apiPost("/api/auth/login", {
        username: email.trim(),
        password,
        rememberMe,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Login failed. Please try again.");
        setErrorCode(body.code ?? null);
        return;
      }
      // The response carries identity AND the effective permission set, so the
      // app renders correctly on the very first paint with no extra round trip.
      applySession(await res.json());
      // Return them to whatever they were trying to reach, which for a project
      // workspace carries the /p/<projectId> prefix. Only same-origin relative
      // paths are honoured — an open redirect is the classic way this parameter
      // gets abused, so anything not starting with a single "/" is discarded.
      const next = new URLSearchParams(window.location.search).get("next");
      navigate(next && /^\/(?!\/)/.test(next) ? next : "/");
    } catch {
      setError("Network error — is the API server running?");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Always reports success, whatever the server says.
   *
   * The endpoint answers 204 for unknown addresses too — echoing anything
   * else here would reintroduce the account-enumeration oracle the server
   * deliberately avoids.
   */
  async function onForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fpValue.trim()) return;
    setFpLoading(true);
    try {
      await apiPost("/api/auth/forgot-password", { identifier: fpValue.trim() });
    } catch {
      /* deliberately ignored — see above */
    } finally {
      setFpLoading(false);
      setFpSent(true);
    }
  }

  function openForgot() {
    setError(null);
    setErrorCode(null);
    setFpValue(email);
    setFpSent(false);
    setView("forgot");
  }
  function backToSignIn() {
    setFpSent(false);
    setView("signin");
  }

  return (
    <div className="min-h-screen w-full bg-[#060914] text-slate-100 flex flex-col md:flex-row">
      {/* ── Left: sensor-mesh hero ── */}
      <div className="relative hidden md:block md:w-[54%] lg:w-[56%] overflow-hidden border-r border-white/5"
        style={{ background: "radial-gradient(90% 90% at 20% 8%, rgba(139,123,255,0.20), transparent 60%), #060914" }}>
        <NodeMesh />
        {/* faint grid */}
        <div className="pointer-events-none absolute inset-0" style={{
          backgroundImage:
            "linear-gradient(rgba(120,180,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(120,180,255,0.05) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(80% 80% at 40% 40%, #000, transparent 85%)",
          WebkitMaskImage: "radial-gradient(80% 80% at 40% 40%, #000, transparent 85%)",
        }} />

        <div className="relative z-10 flex h-full flex-col justify-center p-10 lg:p-14">
          <div>
            <div className="inline-flex items-center gap-2.5 font-mono text-xs uppercase tracking-[0.24em]"
              style={{ color: VIOLET }}>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                  style={{ backgroundColor: "#3ee08a" }} />
                <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: "#3ee08a" }} />
              </span>
              Sensor Network · Live
            </div>
            <h1 className="mt-6 max-w-md text-4xl lg:text-5xl font-extrabold leading-[1.03] tracking-tight text-balance">
              Monitor. Predict.<br />Optimize.
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
              Real-time industrial intelligence — track asset health, catch anomalies early,
              and act before failures happen.
            </p>
          </div>
        </div>
      </div>

      {/* ── Right: form ── */}
      <div className="relative flex flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <Brand />

            {view === "signin" ? (
              <>
                <h2 className="mt-10 text-3xl font-bold tracking-tight text-white">Welcome Back!</h2>
                <p className="mt-1.5 text-sm text-slate-400">Enter your email and password to access your account.</p>

                <form onSubmit={onSubmit} className="mt-8 space-y-4" aria-label="Sign in form">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
                      Username or email
                    </Label>
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input id="email" type="text" autoComplete="username" required value={email}
                        onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
                        className={cn(INPUT_CLASS, "pl-10")} />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="password" className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
                      Password
                    </Label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input id="password" type={showPw ? "text" : "password"} autoComplete="current-password" required
                        value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                        className={cn(INPUT_CLASS, "pl-10 pr-10")} />
                      <button type="button" onClick={() => setShowPw((s) => !s)} tabIndex={0}
                        aria-label={showPw ? "Hide password" : "Show password"}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-400">
                      <Checkbox id="remember" checked={rememberMe}
                        onCheckedChange={(v) => setRememberMe(v === true)}
                        className="border-white/20 data-[state=checked]:border-[#8b7bff] data-[state=checked]:bg-[#8b7bff]" />
                      Remember me
                    </label>
                    <button type="button" onClick={openForgot}
                      className="text-sm font-medium hover:underline" style={{ color: "#b9adff" }}>
                      Forgot password?
                    </button>
                  </div>

                  {error && (
                    <div
                      className={cn(
                        "rounded-md border px-3 py-2.5 text-sm",
                        errorCode === "account_locked" || errorCode === "rate_limited"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                          : "border-red-500/30 bg-red-500/10 text-red-300",
                      )}
                      role="alert"
                    >
                      <p className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{error}</span>
                      </p>
                      {/* Point recoverable states at the action that fixes them,
                          rather than leaving the user to guess. */}
                      {(errorCode === "activation_pending" || errorCode === "credential_upgrade_required") && (
                        <button type="button" onClick={openForgot}
                          className="mt-1.5 ml-5.5 text-xs font-medium underline hover:no-underline">
                          Resend my activation link
                        </button>
                      )}
                      {errorCode === "account_locked" && (
                        <button type="button" onClick={openForgot}
                          className="mt-1.5 ml-5.5 text-xs font-medium underline hover:no-underline">
                          Reset my password instead
                        </button>
                      )}
                    </div>
                  )}

                  <Button type="submit" disabled={loading}
                    className="h-11 w-full rounded-lg font-semibold text-[#0d0820] transition-transform hover:brightness-110 active:scale-[0.99]"
                    style={{ backgroundImage: `linear-gradient(135deg, ${VIOLET}, ${VIOLET_HI})` }}>
                    {loading ? (
                      <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Authenticating…</span>
                    ) : (
                      <span className="inline-flex items-center gap-2"><Lock className="h-4 w-4" /> Sign in <ArrowRight className="h-4 w-4" /></span>
                    )}
                  </Button>

                  <div className="flex items-center justify-center gap-1.5 font-mono text-[11px] tracking-wide text-slate-500">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> SECURE · SSL ENCRYPTED
                  </div>
                </form>
              </>
            ) : (
              /* ── Forgot password ── */
              <div className="mt-10">
                {!fpSent ? (
                  <>
                    <h2 className="text-3xl font-bold tracking-tight text-white">Reset your password</h2>
                    <p className="mt-1.5 text-sm text-slate-400">
                      Enter your username or email and we will send you a secure reset link.
                    </p>
                    <form
                      onSubmit={onForgotSubmit}
                      className="mt-8 space-y-4" aria-label="Reset password form">
                      <div className="space-y-1.5">
                        <Label htmlFor="fp" className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
                          Username or email
                        </Label>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                          <Input id="fp" type="text" autoFocus required value={fpValue}
                            onChange={(e) => setFpValue(e.target.value)} placeholder="you@plant.io"
                            className={cn(INPUT_CLASS, "pl-10")} />
                        </div>
                      </div>
                      <Button type="submit" disabled={!fpValue.trim() || fpLoading}
                        className="h-11 w-full rounded-lg font-semibold text-[#0d0820] transition-transform hover:brightness-110 active:scale-[0.99]"
                        style={{ backgroundImage: `linear-gradient(135deg, ${VIOLET}, ${VIOLET_HI})` }}>
                        {fpLoading
                          ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Sending…</span>
                          : <>Send reset link <ArrowRight className="ml-1.5 h-4 w-4" /></>}
                      </Button>
                      <button type="button" onClick={backToSignIn}
                        className="flex w-full items-center justify-center gap-1.5 text-sm text-slate-400 hover:text-slate-200">
                        <ArrowLeft className="h-4 w-4" /> Back to sign in
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10">
                      <Check className="h-6 w-6 text-emerald-400" />
                    </div>
                    <h2 className="mt-5 text-2xl font-bold tracking-tight text-white">Check your email</h2>
                    {/* Intentionally does not confirm whether the account exists —
                        the server responds identically either way. */}
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">
                      If an account matches <span className="font-mono text-slate-200">{fpValue.trim()}</span>, a
                      reset link is on its way. The link is single-use and expires shortly, so use it soon.
                    </p>
                    <p className="mt-3 text-xs leading-relaxed text-slate-500">
                      Nothing arrived? Check your spam folder, or ask your administrator to confirm the
                      email address on your account.
                    </p>
                    <Button onClick={backToSignIn}
                      className="mt-6 h-11 w-full rounded-lg font-semibold text-[#0d0820] transition-transform hover:brightness-110 active:scale-[0.99]"
                      style={{ backgroundImage: `linear-gradient(135deg, ${VIOLET}, ${VIOLET_HI})` }}>
                      <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to sign in
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col items-center justify-between gap-2 border-t border-white/5 px-6 py-4 text-xs text-slate-500 sm:flex-row">
          <span>Version 1.0.0 · © 2026 Web Synergies Pvt Ltd</span>
          <span className="flex items-center gap-3">
            {/* Plain text until real policy URLs exist; they were dead href="#" links. */}
            <span>Privacy Policy</span>
            <span>Terms</span>
          </span>
        </div>
      </div>
    </div>
  );
}
