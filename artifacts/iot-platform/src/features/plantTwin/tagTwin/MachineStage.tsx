import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import * as THREE from "three";
import { PI, DS, clamp, rnd, P, M, cyl, box, X, pipe, polyline, particles, lights, lamp } from "../engine/kit";
import { TAGS, fmt, type Src } from "./tags";

/**
 * 3D Machine Twin: a centrifugal pump skid with moving parts. Shaft, coupling and
 * impeller turn with speed; the bearing glows with temperature; the skid shakes
 * with vibration; flow particles follow flow; the needle follows pressure; the
 * beacon shows overall status. X-ray shows inside the casing and pipes.
 */
export type Getter = (key: string) => { v: number | null; src: Src; status: "ok" | "warn" | "crit" | "nolink" };

const PINS = [
  { key: "temp", title: "TT-101 bearing", a: [0.78, 1.32, 0] },
  { key: "vib", title: "VT-101 vibration", a: [0.95, 0.45, 0.45] },
  { key: "rpm", title: "SI-101 speed", a: [0.15, 0.3, 0.75] },
  { key: "flow", title: "FT-101 flow", a: [2.6, 2.6, 0] },
  { key: "pres", title: "PT-101 discharge", a: [1.35, 2.05, 0.45] },
  { key: "amps", title: "IT-101 motor", a: [-1.5, 1.45, 0] },
] as const;
const SC: Record<string, number> = { ok: 0x22c55e, warn: 0xf59e0b, crit: 0xef4444, nolink: 0x64748b };

export function MachineStage({ get }: { get: Getter }) {
  const tr = useT();
  const hostRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null), overlayRef = useRef<HTMLDivElement>(null);
  const getRef = useRef(get); getRef.current = get;
  const [xray, setXray] = useState(true), [auto, setAuto] = useState(true), [heat, setHeat] = useState(true);
  const opts = useRef({ xray, auto, heat }); opts.current = { xray, auto, heat };

  useEffect(() => {
    const host = hostRef.current!, canvas = canvasRef.current!, overlay = overlayRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, 1.6, 0.1, 100);
    lights(scene);
    scene.add(new THREE.GridHelper(14, 28, 0x2a3a52, 0x18212f));
    const steel = M(0x2c3646, { metalness: 0.6, roughness: 0.55 });
    const skid = box(4.4, 0.22, 1.5, steel); skid.position.y = 0.11; scene.add(skid);
    const rig = new THREE.Group(); scene.add(rig);
    // motor
    const motorMat = M(0x2f5f9e, { metalness: 0.35, roughness: 0.45 });
    const motor = X(cyl(0.46, 0.46, 1.5, motorMat)); motor.position.set(-1.05, 0.86, 0); rig.add(motor);
    const finMat = M(0x2a5590, { metalness: 0.35 });
    for (let i = 0; i < 11; i++) { const f = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.03, 8, 40), finMat); f.rotation.y = PI / 2; f.position.set(-1.7 + i * 0.13, 0.86, 0); rig.add(f); }
    const fanCover = X(cyl(0.42, 0.42, 0.28, M(0x1e2b3d))); fanCover.position.set(-1.95, 0.86, 0); rig.add(fanCover);
    const tbox = box(0.38, 0.3, 0.4, motorMat); tbox.position.set(-0.9, 1.43, 0); rig.add(tbox);
    [-1.6, -0.5].forEach((x) => { const ft = box(0.22, 0.42, 1.0, steel); ft.position.set(x, 0.43, 0); rig.add(ft); });
    const beaconM = lamp(0x22c55e); const bc = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 16), beaconM); bc.position.set(-0.9, 1.88, 0); rig.add(bc);
    const post = cyl(0.03, 0.03, 0.25, M(0x555f6e)); post.position.set(-0.9, 1.71, 0); rig.add(post);
    // rotating train
    const rotor = new THREE.Group(); rotor.position.set(0, 0.86, 0); rig.add(rotor);
    const shaft = X(cyl(0.06, 0.06, 1.6, M(0xb8c2d0, { metalness: 0.9, roughness: 0.25 }))); shaft.position.x = 0.5; rotor.add(shaft);
    [0.12, 0.3].forEach((x) => {
      const disc = X(cyl(0.21, 0.21, 0.12, M(0x8b97a8, { metalness: 0.8 }))); disc.position.x = x; rotor.add(disc);
      for (let i = 0; i < 6; i++) { const a = i / 6 * PI * 2, b = box(0.14, 0.05, 0.05, M(0xf59e0b)); b.position.set(x, Math.cos(a) * 0.15, Math.sin(a) * 0.15); rotor.add(b); }
    });
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.7, 24, 1, true, 0, PI), M(0xf59e0b, { transparent: true, opacity: 0.35, side: DS }));
    guard.rotation.z = PI / 2; guard.rotation.y = PI / 2; guard.position.set(0.21, 0.86, 0); rig.add(guard);
    // bearing housing
    const bearMat = M(0x4b5768);
    const bear = X(cyl(0.24, 0.24, 0.55, bearMat)); bear.position.set(0.72, 0.86, 0); rig.add(bear);
    const bped = box(0.3, 0.55, 0.5, steel); bped.position.set(0.72, 0.4, 0); rig.add(bped);
    // casing + impeller
    const caseMat = M(0x5b6b80, { metalness: 0.55, roughness: 0.4, transparent: true, opacity: 0.28, side: DS, depthWrite: false });
    const volute = X(cyl(0.68, 0.68, 0.48, caseMat, 40)); volute.position.set(1.35, 0.95, 0); rig.add(volute);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.04, 8, 48), M(0x7d8ca2)); rim.rotation.y = PI / 2; rim.position.set(1.12, 0.95, 0); rig.add(rim);
    const rim2 = rim.clone(); rim2.position.x = 1.58; rig.add(rim2);
    const cped = box(0.6, 0.3, 0.9, steel); cped.position.set(1.35, 0.27, 0); rig.add(cped);
    const imp = new THREE.Group(); imp.position.set(1.35, 0.95, 0); rig.add(imp);
    const impMat = M(0xd4a23a, { metalness: 0.85, roughness: 0.3 });
    imp.add(X(cyl(0.13, 0.13, 0.32, impMat)));
    const shroud = X(cyl(0.5, 0.5, 0.03, impMat)); shroud.position.x = -0.15; imp.add(shroud);
    for (let i = 0; i < 7; i++) { const piv = new THREE.Group(); piv.rotation.x = i / 7 * PI * 2; const vane = box(0.28, 0.36, 0.04, impMat); vane.position.y = 0.3; vane.rotation.x = 0.45; piv.add(vane); imp.add(piv); }
    // piping, gauge, flow
    const pipeMat = M(0x6c7a8f, { metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.3, side: DS, depthWrite: false });
    [pipe(P(1.58, 0.95, 0), P(3.0, 0.95, 0), 0.19, pipeMat), pipe(P(1.35, 1.6, 0), P(1.35, 2.35, 0), 0.16, pipeMat), pipe(P(1.35, 2.35, 0), P(3.0, 2.35, 0), 0.16, pipeMat)].forEach((m) => rig.add(m));
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 20), pipeMat); elbow.position.set(1.35, 2.35, 0); rig.add(elbow);
    const flangeMat = M(0x8794a8, { metalness: 0.7 });
    ([[2.1, 0.95, 0.27], [2.1, 2.35, 0.24]] as const).forEach(([x, y, r]) => { const f = X(cyl(r, r, 0.06, flangeMat)); f.position.set(x, y, 0); rig.add(f); });
    const gauge = new THREE.Group(); gauge.position.set(1.35, 2.0, 0.32); rig.add(gauge);
    const gface = cyl(0.13, 0.13, 0.05, M(0xe8edf3, { metalness: 0.1, roughness: 0.6 })); gface.rotation.x = PI / 2; gauge.add(gface);
    const needle = box(0.015, 0.11, 0.01, new THREE.MeshBasicMaterial({ color: 0xef4444 })); needle.geometry.translate(0, 0.045, 0); needle.position.z = 0.03; gauge.add(needle);
    const stem = cyl(0.025, 0.025, 0.18, steel); stem.rotation.x = PI / 2; stem.position.set(1.35, 2.0, 0.17); rig.add(stem);
    const flow = particles(rig, polyline([P(3.0, 0.95, 0), P(1.6, 0.95, 0), P(1.35, 0.95, 0), P(1.35, 2.35, 0), P(3.0, 2.35, 0)]), 46, 0x38bdf8, 0.045);
    // pins
    const pins = PINS.map((pd) => {
      const el = document.createElement("div"); el.className = "pt-pin";
      el.innerHTML = `<span class="pt-dot"></span><span class="pt-card"><b></b><span></span></span>`;
      (el.querySelector("b") as HTMLElement).textContent = pd.title; overlay.appendChild(el);
      return { ...pd, el, v: new THREE.Vector3(...pd.a) };
    });
    // orbit
    const tgt = P(0.4, 1.0, 0); let th = 0.38, ph = 1.15, r = 7.2, drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!drag) return; th -= (e.clientX - drag.x) * 0.008; ph = clamp(ph - (e.clientY - drag.y) * 0.008, 0.2, 1.45); drag = { x: e.clientX, y: e.clientY }; };
    const up = () => { drag = null; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); r = clamp(r * (1 + Math.sign(e.deltaY) * 0.08), 3, 12); };
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("wheel", wheel, { passive: false });

    let raf = 0, last = performance.now(), spin = 0, xr = true;
    const val = (k: string) => { const g = getRef.current(k); return g.v ?? TAGS[k].rest; };
    const proj = new THREE.Vector3();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now / 1000;
      const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
      if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
      const o = opts.current;
      if (o.xray !== xr) { xr = o.xray; caseMat.opacity = xr ? 0.28 : 1; caseMat.depthWrite = !xr; pipeMat.opacity = xr ? 0.3 : 1; pipeMat.depthWrite = !xr; caseMat.needsUpdate = pipeMat.needsUpdate = true; }
      spin += (val("rpm") / 60 * PI * 2) * 0.12 * dt; rotor.rotation.x = spin; imp.rotation.x = spin;
      const amp = val("vib") * 0.0035; rig.position.set(rnd(amp), rnd(amp * 0.6), rnd(amp));
      const hb = o.heat ? clamp((val("temp") - 55) / 45, 0, 1) : 0, hm = o.heat ? clamp((val("amps") - 30) / 25, 0, 1) * 0.5 : 0;
      bearMat.emissive.setRGB(hb * 0.9, hb * 0.18, 0); motorMat.emissive.setRGB(hm * 0.5, hm * 0.12, 0);
      needle.rotation.z = -(clamp(val("pres") / 6, 0, 1) * 4.2 - 2.1);
      flow.update(dt, val("flow") / 120 * 1.2);
      const sts = PINS.map((pd) => getRef.current(pd.key).status);
      const worst = sts.includes("crit") ? "crit" : sts.includes("warn") ? "warn" : sts.every((s) => s === "nolink") ? "nolink" : "ok";
      beaconM.color.setHex(SC[worst]); beaconM.emissive.setHex(SC[worst]); beaconM.emissiveIntensity = worst === "crit" ? (Math.sin(t * 10) > 0 ? 1.6 : 0.15) : worst === "nolink" ? 0.2 : 1.1;
      if (o.auto && !drag) th += dt * 0.12;
      cam.position.set(tgt.x + r * Math.sin(ph) * Math.sin(th), tgt.y + r * Math.cos(ph), tgt.z + r * Math.sin(ph) * Math.cos(th)); cam.lookAt(tgt);
      renderer.render(scene, cam);
      pins.forEach((p) => {
        proj.copy(p.v).project(cam);
        p.el.style.transform = proj.z > 1 ? "translate(-9999px,0)" : `translate(${(proj.x + 1) / 2 * w - 6}px, ${(1 - proj.y) / 2 * h - 6}px)`;
        const g = getRef.current(p.key);
        p.el.className = "pt-pin " + (g.status === "ok" ? "" : g.status);
        (p.el.querySelector(".pt-card > span") as HTMLElement).textContent = g.src === "none" ? "not linked" : fmt(p.key, g.v) + (g.src === "demo" ? " · demo" : "");
      });
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("wheel", wheel);
      pins.forEach((p) => p.el.remove());
      scene.traverse((q: any) => { q.geometry?.dispose(); (Array.isArray(q.material) ? q.material : q.material ? [q.material] : []).forEach((m: any) => m.dispose()); });
      renderer.dispose();
    };
  }, []);

  const chip = (on: boolean, set: (b: boolean) => void, label: string) => (
    <button onClick={() => set(!on)} aria-pressed={on} className={`text-xs font-mono px-2.5 py-1 rounded border ${on ? "border-blue-500 bg-blue-500/30 text-white" : "border-slate-600 bg-slate-900/70 text-slate-200"}`}>{label}</button>
  );
  return (
    <div ref={hostRef} className="pt-stage pt-fill rounded-md">
      <canvas ref={canvasRef} aria-label="3D model of a centrifugal pump skid" />
      <div ref={overlayRef} className="pt-overlay" />
      <div className="absolute right-2 top-2 flex gap-1.5">{chip(xray, setXray, tr("X-ray"))}{chip(auto, setAuto, tr("Auto-rotate"))}{chip(heat, setHeat, tr("Heat map"))}</div>
      <div className="absolute left-3 bottom-2 text-[11px] font-mono text-slate-400 pointer-events-none">{tr("Drag to rotate · scroll to zoom")}</div>
    </div>
  );
}
