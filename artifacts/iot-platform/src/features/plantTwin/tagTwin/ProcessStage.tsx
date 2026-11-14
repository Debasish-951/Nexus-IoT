import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import { TAGS, fmt } from "./tags";
import type { Getter } from "./MachineStage";

/**
 * Process Twin: feed tank → transfer pump → control valve → cooler → reactor,
 * with recycle and cooling water. Pipe flow moves at the measured flow, the tank
 * fills from its level, the valve shading follows its opening, the agitator turns,
 * equipment in alarm pulses. Values come from the shared getter (live, demo or none).
 */
const BUBBLES: [string, string, number, number, number][] = [
  ["level", "LT-101 level", 70, 62, 120], ["pres", "PT-101 disch.", 214, 440, 120], ["flow", "FT-101 flow", 470, 156, 120],
  ["valve", "ZT-101 open", 386, 276, 120], ["hxOut", "TT-201 out", 600, 150, 120], ["rx", "TT-301 rx", 722, 340, 112], ["agit", "SIC-101 agit.", 760, 64, 114],
];

/** Heat map: temperature ranges (°C) that run from blue to red, per equipment. */
const HEAT: [string, string, number, number][] = [["#p-hx", "hxOut", 25, 55], ["#p-rx", "rx", 25, 90]];
const heatColour = (f: number) => { const c = Math.max(0, Math.min(1, f)); return `rgb(${Math.round(29 + c * 210)},${Math.round(78 - c * 10)},${Math.round(216 - c * 148)})`; };

export function ProcessStage({ get }: { get: Getter }) {
  const tr = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const getRef = useRef(get); getRef.current = get;
  // X-ray and Auto-rotate belong to the 3D views; a 2D diagram has the heat map only.
  const [heat, setHeat] = useState(false);
  const heatRef = useRef(heat); heatRef.current = heat;

  useEffect(() => {
    const svg = svgRef.current!;
    const q = <T extends Element>(s: string) => svg.querySelector(s) as unknown as T;
    const flows = Array.from(svg.querySelectorAll<SVGPathElement>(".pt-flow"));
    const off: Record<string, number> = { main: 0, cw: 0, rec: 0 };
    const imp = q<SVGGElement>("#p-imp"), agit = q<SVGGElement>("#p-agit"), liq = q<SVGRectElement>("#p-tank-liq"), wave = q<SVGPathElement>("#p-tank-wave"), vfill = q<SVGPathElement>("#p-valve-fill");
    let ia = 0, aa = 0, raf = 0, last = performance.now();
    const v = (k: string) => getRef.current(k).v ?? TAGS[k].rest;
    const eq = (id: string, s: string) => q<SVGElement>(id).setAttribute("class", "pt-eq" + (s === "crit" ? " alarm" : s === "warn" ? " alarmw" : ""));
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now / 1000;
      const flow = v("flow");
      off.main -= dt * flow * 0.55; off.cw -= dt * 40; off.rec -= dt * flow * 0.12;
      flows.forEach((f) => { f.style.strokeDashoffset = String(off[f.dataset.k!]); if (f.dataset.k !== "cw") f.style.opacity = flow < 3 ? "0.15" : ""; });
      ia += dt * v("rpm") / 60 * 1.2 * 360 * 0.1; imp.setAttribute("transform", `rotate(${ia} 300 370)`);
      aa += dt * v("agit") / 60 * Math.PI; agit.setAttribute("transform", `translate(900 0) scale(${Math.cos(aa).toFixed(3)} 1) translate(-900 0)`);
      const h = 276 * Math.max(0, Math.min(1, v("level") / 100)), top = 398 - h;
      liq.setAttribute("y", String(top)); liq.setAttribute("height", String(h + 2));
      let d = `M60 ${top}`; for (let x = 60; x <= 200; x += 7) d += ` L${x} ${top + Math.sin(x / 14 + t * 3) * 2.5}`; wave.setAttribute("d", d + ` L200 ${top + 8} L60 ${top + 8} Z`);
      vfill.setAttribute("opacity", (0.15 + 0.75 * Math.max(0, Math.min(100, v("valve"))) / 100).toFixed(2));
      BUBBLES.forEach(([k]) => {
        const g = getRef.current(k), el = q<SVGGElement>(`#b-${k}`);
        (el.querySelector(".pt-bv") as SVGTextElement).textContent = g.src === "none" ? "not linked" : fmt(k, g.v) + (g.src === "demo" ? " ·demo" : "");
        el.setAttribute("class", "pt-bub " + (g.status === "warn" || g.status === "crit" ? g.status : g.src === "none" ? "nolink" : ""));
      });
      eq("#p-tank", getRef.current("level").status);
      const pump = ["flow", "pres"].map((k) => getRef.current(k).status);
      eq("#p-pump", pump.includes("crit") ? "crit" : pump.includes("warn") ? "warn" : "ok");
      eq("#p-hx", getRef.current("hxOut").status);
      HEAT.forEach(([id, k, lo, hi]) => {
        const el = q<SVGElement>(id); if (!el) return;
        const g = getRef.current(k);
        if (heatRef.current && g.v != null) { const col = heatColour((g.v - lo) / (hi - lo)); el.style.filter = `drop-shadow(0 0 10px ${col}) drop-shadow(0 0 4px ${col})`; }
        else el.style.filter = "";
      });
      const pumpEl = q<SVGElement>("#p-pump");
      const ps = pump.includes("crit") ? 1 : pump.includes("warn") ? 0.65 : 0.15;
      pumpEl.style.filter = heatRef.current ? `drop-shadow(0 0 10px ${heatColour(ps)})` : "";
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pt-stage pt-fill rounded-md">
      <div className="absolute right-2 top-2 z-10 flex gap-1.5">
        <button onClick={() => setHeat(!heat)} aria-pressed={heat}
          className={"font-mono text-xs px-2.5 py-1 rounded border " + (heat ? "bg-blue-600/80 border-blue-400 text-white" : "bg-slate-900/70 border-blue-500/60 text-slate-100 hover:bg-slate-800/80")}>{tr("Heat map")}</button>
      </div>
      <svg ref={svgRef} viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid meet" className="block w-full h-full" aria-label="Animated process diagram">
        <defs>
          <clipPath id="ptTankClip"><rect x="62" y="122" width="136" height="276" rx="12" /></clipPath>
          <clipPath id="ptRxClip"><rect x="842" y="142" width="116" height="256" rx="28" /></clipPath>
          <linearGradient id="ptLiq" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#38bdf8" stopOpacity=".75" /><stop offset="1" stopColor="#1d4ed8" stopOpacity=".85" /></linearGradient>
          <linearGradient id="ptLiq2" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#fb923c" stopOpacity=".65" /><stop offset="1" stopColor="#9a3412" stopOpacity=".85" /></linearGradient>
        </defs>
        {["M200 370 H266", "M300 336 V250 H420", "M460 250 H560", "M760 250 H800 V200 H842", "M610 470 V285", "M710 285 V470"].map((d) => <path key={d} className="pt-pipe" d={d} />)}
        <path className="pt-pipe" d="M900 400 V500 H130 V400" style={{ strokeWidth: 7 }} />
        <path className="pt-flow" data-k="main" d="M200 370 H266" />
        <path className="pt-flow" data-k="main" d="M300 336 V250 H420" />
        <path className="pt-flow" data-k="main" d="M460 250 H560" />
        <path className="pt-flow hot" data-k="main" d="M760 250 H800 V200 H842" />
        <path className="pt-flow cold" data-k="cw" d="M610 470 V285" />
        <path className="pt-flow cold" data-k="cw" d="M710 285 V470" />
        <path className="pt-flow rec" data-k="rec" d="M900 400 V500 H130 V400" />
        <rect id="p-tank" className="pt-eq" x="60" y="120" width="140" height="280" rx="14" />
        <rect id="p-tank-liq" x="60" y="200" width="140" height="200" fill="url(#ptLiq)" clipPath="url(#ptTankClip)" />
        <path id="p-tank-wave" d="" fill="#7dd3fc" opacity=".35" clipPath="url(#ptTankClip)" />
        <text className="pt-lbl" x="130" y="425" textAnchor="middle">T-101 Feed tank</text>
        <circle id="p-pump" className="pt-eq" cx="300" cy="370" r="34" />
        <g id="p-imp">
          {["M300 370 q10 -14 2 -26", "M300 370 q14 10 26 2", "M300 370 q-10 14 -2 26", "M300 370 q-14 -10 -26 -2"].map((d) => <path key={d} d={d} stroke="#9fb3cc" strokeWidth="3" fill="none" />)}
          <circle cx="300" cy="370" r="5" fill="#9fb3cc" />
        </g>
        <text className="pt-lbl" x="300" y="425" textAnchor="middle">P-101</text>
        <path className="pt-eq" d="M420 236 L460 264 L460 236 L420 264 Z" />
        <path id="p-valve-fill" d="M420 236 L440 250 L420 264 Z M460 236 L440 250 L460 264 Z" fill="#3b82f6" opacity=".5" />
        <line x1="440" y1="250" x2="440" y2="222" stroke="#4a5a72" strokeWidth="2" />
        <path d="M428 222 a12 12 0 0 1 24 0 Z" className="pt-eq" />
        <text className="pt-lbl sm" x="440" y="208" textAnchor="middle">FCV-101</text>
        <rect id="p-hx" className="pt-eq" x="560" y="215" width="200" height="70" rx="35" />
        <g stroke="#3d4d64" strokeWidth="2">{[232, 244, 256, 268].map((y) => <line key={y} x1="590" y1={y} x2="730" y2={y} />)}</g>
        <text className="pt-lbl" x="660" y="320" textAnchor="middle">E-101 Cooler</text>
        <text className="pt-lbl sm" x="610" y="530" textAnchor="middle">CW in</text>
        <text className="pt-lbl sm" x="710" y="530" textAnchor="middle">CW out</text>
        <rect id="p-rx" className="pt-eq" x="840" y="140" width="120" height="260" rx="30" />
        <rect x="840" y="230" width="120" height="170" fill="url(#ptLiq2)" clipPath="url(#ptRxClip)" />
        <rect x="884" y="96" width="32" height="26" rx="4" className="pt-eq" />
        <line x1="900" y1="122" x2="900" y2="350" stroke="#9fb3cc" strokeWidth="3" />
        <g id="p-agit"><rect x="868" y="340" width="64" height="8" rx="3" fill="#9fb3cc" /><rect x="872" y="285" width="56" height="7" rx="3" fill="#9fb3cc" /></g>
        <text className="pt-lbl" x="900" y="425" textAnchor="middle">R-101 Reactor</text>
        <text className="pt-lbl sm" x="515" y="492" textAnchor="middle">recycle</text>
        {BUBBLES.map(([k, label, x, y, w]) => (
          <g key={k} id={`b-${k}`} className="pt-bub" transform={`translate(${x} ${y})`}>
            <rect width={w} height="44" rx="6" /><text className="pt-bt" x="9" y="16">{label}</text><text className="pt-bv" x="9" y="35">—</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
