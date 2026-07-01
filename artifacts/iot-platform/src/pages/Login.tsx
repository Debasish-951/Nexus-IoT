import { useState } from "react";
import { useLocation } from "wouter";
import { useCurrentUser } from "@/contexts/UserContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Eye, EyeOff, Lock, Globe, ShieldCheck, ArrowRight, Check, ChevronDown,
} from "lucide-react";

const BLUE = "#2563EB";
const FEATURES = ["Asset Management", "Predictive Maintenance", "Live Sensor Analytics", "AI Anomaly Detection"];

// Web Synergies wordmark recreated in markup (renders with no image file / CSP-safe).
function WsLogo({ variant = "dark", size = "md" }: { variant?: "dark" | "light"; size?: "md" | "lg" }) {
  const web = variant === "light" ? "text-white" : "text-slate-900";
  const tag = variant === "light" ? "text-white/70" : "text-slate-500";
  const reg = variant === "light" ? "text-white/60" : "text-slate-400";
  const webSize = size === "lg" ? "text-4xl" : "text-2xl";
  const synSize = size === "lg" ? "text-2xl px-3 py-1.5" : "text-lg px-2 py-0.5";
  return (
    <div className="inline-flex flex-col leading-none select-none">
      <div className="flex items-center">
        <span className={cn("font-extrabold tracking-tighter", webSize, web)}>Web</span>
        <span className={cn("ml-1 inline-block bg-[#f47b20] text-white font-bold -skew-x-6 shadow-sm", synSize)}>
          <span className="inline-block skew-x-6">Synergies</span>
        </span>
        <span className={cn("text-[10px] ml-0.5 self-start", reg)}>®</span>
      </div>
      <span className={cn("text-[11px] mt-1.5 font-medium tracking-wide", tag)}>Bettering your Expectations</span>
    </div>
  );
}

// Uses the real logo file if present (drop web-synergies-logo.png in /public),
// otherwise falls back to the recreated wordmark so a logo always shows.
function BrandMark() {
  const [imgOk, setImgOk] = useState(true);
  if (!imgOk) return <WsLogo variant="dark" size="lg" />;
  return (
    <img
      src="/web-synergies-logo.png"
      alt="Web Synergies"
      className="h-56 w-auto object-contain select-none -ml-4"
      draggable={false}
      onError={() => setImgOk(false)}
    />
  );
}

// Logo for the dark hero: the black wordmark needs a white chip to be visible.
function HeroLogo() {
  const [imgOk, setImgOk] = useState(true);
  if (!imgOk) return <WsLogo variant="light" size="lg" />;
  return (
    <span className="inline-block bg-white rounded-lg px-4 py-3 shadow-lg">
      <img
        src="/web-synergies-logo.png"
        alt="Web Synergies"
        className="h-12 w-auto object-contain select-none"
        draggable={false}
        onError={() => setImgOk(false)}
      />
    </span>
  );
}

export default function Login() {
  const [, navigate] = useLocation();
  const { setCurrentUser } = useCurrentUser();
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email.trim(), password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Login failed. Please try again.");
        return;
      }
      const user = await res.json();
      setCurrentUser(user);
      localStorage.setItem("ws_authed", "1");
      navigate("/");
    } catch {
      setError("Network error — is the API server running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-white">
      {/* ── Left: industrial hero ── */}
      <div className="relative md:w-1/2 lg:w-3/5 h-56 md:h-auto overflow-hidden bg-[#0a1b38]">
        {/* Optional real photo: drop /public/hero.jpg and uncomment
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/hero.jpg')" }} /> */}
        {/* subtle tech grid (no blur) */}
        <div className="absolute inset-0" style={{
          backgroundImage: "linear-gradient(rgba(56,189,248,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.10) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }} />
        {/* transparent blue digital-twin overlay */}
        <div className="absolute inset-0 bg-[#0a2a5c]/40" />
        {/* faint binary accents (top-right) */}
        <div className="absolute top-6 right-6 font-mono text-[10px] leading-5 text-cyan-300/20 select-none hidden md:block text-right">
          1100101 0110011<br />1011001 1100110<br />0110100 1010011
        </div>
        {/* brand + headline (fills the upper-left space) */}
        <div className="absolute top-8 left-8 right-8 md:max-w-md text-white hidden md:block z-10">
          <HeroLogo />
          <h2 className="mt-10 text-3xl font-bold leading-tight">Monitor. Predict. Optimize.</h2>
          <p className="mt-3 text-sm text-white/70 leading-relaxed max-w-sm">
            Real-time industrial intelligence — track asset health, catch anomalies early, and act before failures happen.
          </p>
        </div>
        {/* stylized digital-twin (motor) */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 500" preserveAspectRatio="xMidYMid meet" aria-hidden>
          <g fill="none" stroke="#38bdf8" strokeWidth="1.4" opacity="0.7" style={{ filter: "drop-shadow(0 0 6px rgba(56,189,248,0.6))" }}>
            <ellipse cx="230" cy="270" rx="150" ry="90" />
            <ellipse cx="230" cy="270" rx="110" ry="66" />
            <ellipse cx="230" cy="270" rx="60" ry="36" />
            <line x1="80" y1="270" x2="380" y2="270" />
            <line x1="230" y1="180" x2="230" y2="360" />
            <rect x="380" y="235" width="150" height="70" rx="6" />
            <line x1="380" y1="255" x2="530" y2="255" />
            <line x1="380" y1="285" x2="530" y2="285" />
            <circle cx="230" cy="270" r="6" fill="#38bdf8" />
          </g>
        </svg>

        {/* glass card bottom-left */}
        <div className="absolute bottom-5 left-5 right-5 md:right-auto md:max-w-xs rounded-xl border border-white/20 bg-white/10 backdrop-blur-md p-5 text-white shadow-lg">
          <p className="text-sm font-semibold mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Real-Time Monitoring
          </p>
          <ul className="space-y-2">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-white/90">
                <Check className="w-4 h-4 text-cyan-300 shrink-0" /> {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Right: login form ── */}
      <div className="relative md:w-1/2 lg:w-2/5 flex flex-col">
        {/* language selector top-right */}
        <div className="absolute top-4 right-4">
          <button type="button" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 rounded-md px-2 py-1 hover:bg-slate-100 transition-colors" aria-label="Select language">
            <Globe className="w-4 h-4" /> English <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            {/* Brand */}
            <BrandMark />
            <h2 className="mt-4 text-base font-semibold text-slate-900">Industrial IoT Platform</h2>
            <p className="text-sm text-slate-500">Asset Management &amp; Predictive Maintenance</p>

            <h1 className="mt-8 text-3xl font-bold text-slate-900">Login</h1>

            <form onSubmit={onSubmit} className="mt-6 space-y-4" aria-label="Login form">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-slate-700">Username or email</Label>
                <Input id="email" type="text" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin" className="h-11" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-slate-700">Password</Label>
                <div className="relative">
                  <Input id="password" type={showPw ? "text" : "password"} autoComplete="current-password" required
                    value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="h-11 pr-10" />
                  <button type="button" onClick={() => setShowPw((s) => !s)} tabIndex={0}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                  <Checkbox id="remember" /> Remember me
                </label>
                <a href="#" className="text-sm font-medium hover:underline" style={{ color: BLUE }}>Forgot password?</a>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert">{error}</p>
              )}

              <Button type="submit" disabled={loading}
                className="w-full h-11 rounded-lg text-white font-medium transition-transform active:scale-[0.99] hover:brightness-110"
                style={{ backgroundColor: BLUE }}>
                {loading ? (
                  <span className="inline-flex items-center gap-2"><Spinner /> Authenticating…</span>
                ) : (
                  <span className="inline-flex items-center gap-2"><Lock className="w-4 h-4" /> Login <ArrowRight className="w-4 h-4" /></span>
                )}
              </Button>

              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Secure login · SSL encrypted
              </div>

              <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                <span className="font-medium text-slate-600">Demo accounts</span><br />
                admin / admin123 · jsmith / engineer123 · mwilson / operator123
              </div>
            </form>

            <div className="mt-6 text-center text-sm text-slate-500">
              Need help? <a href="#" className="font-medium hover:underline" style={{ color: BLUE }}>Contact Administrator</a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
          <span>Version 1.0.0 · © 2026 Web Synergies Pvt Ltd</span>
          <span className="flex items-center gap-3">
            <a href="#" className="hover:text-slate-600">Privacy Policy</a>
            <a href="#" className="hover:text-slate-600">Terms</a>
          </span>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
