import { ShieldCheck } from "lucide-react";

/**
 * Shared chrome for the unauthenticated account pages (activate, reset).
 *
 * Matches the dark "Split Signal" treatment of the login screen so the
 * activation link does not drop the user onto a page that looks like a
 * different product — which is exactly the cue that trains people to ignore
 * phishing warnings.
 */

const VIOLET = "#8b7bff";
const CYAN = "#2dd4ff";

export const AUTH_INPUT_CLASS =
  "h-11 bg-[#0a1024]/70 border-white/10 text-slate-100 placeholder:text-slate-500 " +
  "focus-visible:ring-[#8b7bff] focus-visible:ring-offset-0 focus-visible:border-[#8b7bff]";

export const AUTH_BUTTON_STYLE = {
  backgroundImage: `linear-gradient(135deg, ${VIOLET}, #b06bff)`,
} as const;

function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <path d="M24 3 42 13.5v21L24 45 6 34.5v-21L24 3Z" stroke={VIOLET} strokeWidth="1.6" />
      <path d="M24 12 34 18v12l-10 6-10-6V18l10-6Z" stroke={CYAN} strokeWidth="1.2" opacity="0.6" />
      <circle cx="24" cy="24" r="3.4" fill={VIOLET} />
    </svg>
  );
}

export default function AuthShell({
  children, title, subtitle,
}: { children: React.ReactNode; title?: string; subtitle?: string }) {
  return (
    <div
      className="min-h-screen w-full bg-[#060914] text-slate-100 flex flex-col items-center justify-center px-6 py-12"
      style={{ background: "radial-gradient(80% 60% at 50% 0%, rgba(139,123,255,0.16), transparent 60%), #060914" }}
    >
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3">
          <LogoMark className="h-10 w-10 shrink-0" />
          <div className="leading-none">
            <div className="text-xl font-extrabold tracking-tight text-white">
              Integrated<span style={{ color: VIOLET }}> Suite</span>
            </div>
            <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-slate-500">
              IS · Web Synergies
            </div>
          </div>
        </div>

        <div className="mt-9 rounded-2xl border border-white/10 bg-white/[0.03] p-7 backdrop-blur">
          {title && <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>}
          {subtitle && <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{subtitle}</p>}
          {children}
        </div>

        <div className="mt-6 flex items-center justify-center gap-1.5 font-mono text-[11px] tracking-wide text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> SECURE · SSL ENCRYPTED
        </div>
      </div>
    </div>
  );
}
