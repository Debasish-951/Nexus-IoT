import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Eye, EyeOff, Lock, Globe, ShieldCheck, ArrowRight, Check, ChevronDown,
} from "lucide-react";

const BLUE = "#2563EB";
const FEATURES = ["Asset Management", "Predictive Maintenance", "Live Sensor Analytics", "AI Anomaly Detection"];

function BrandMark() {
  return (
    // Drop the real logo at artifacts/iot-platform/public/web-synergies-logo.png
    // If missing, the alt text shows — swap the src if you use a different filename.
    <img
      src="/web-synergies-logo.png"
      alt="Web Synergies"
      className="h-16 w-auto object-contain select-none"
      draggable={false}
    />
  );
}

export default function Login() {
  const [, navigate] = useLocation();
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // No auth backend in this platform — mock authenticate then enter the app.
    setTimeout(() => {
      localStorage.setItem("ws_authed", "1");
      setLoading(false);
      navigate("/");
    }, 1200);
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
        {/* faint binary accents */}
        <div className="absolute top-6 left-6 font-mono text-[10px] leading-5 text-cyan-300/20 select-none hidden md:block">
          1100101 0110011<br />1011001 1100110<br />0110100 1010011
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
                <Label htmlFor="email" className="text-slate-700">Email address</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com" className="h-11" />
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
