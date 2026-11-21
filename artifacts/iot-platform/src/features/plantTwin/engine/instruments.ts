/* eslint-disable */
// Field instruments and meters for the Live Twin library: energy meter, pressure
// gauge, magnetic / Coriolis / vortex flow meters, temperature transmitter,
// radar level transmitter, gas detector, control valve with positioner and a
// VFD panel. Real instruments are small, so each is drawn larger than life
// (the Size setting scales it further) and mounted on the pipe, tank or panel
// it belongs to, so it reads on a plant floor next to pumps and tanks.
//
// Displays are canvas textures redrawn about twice a second from the readings.
import * as THREE from "three";
import { PI, AMB, clamp, rnd, P, C, SCOL, M, glass, lamp, cyl, box, X, pipe, polyline, particles, heatTo, fanRotor, holder, lathe, canvas2d, T } from "./kit";
import type { ModelDef } from "./types";

/** A live digital display: a plane whose texture is redrawn at most every 0.5 s. */
function display(w: number, h: number, pxW = 256, pxH = 128) {
  const { cv, x } = canvas2d(pxW, pxH);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.85, metalness: 0, roughness: 0.7 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  let last = -1;
  return {
    mesh, mat,
    /** lines: [label, value]; the first line is drawn large. */
    draw(t: number, lines: [string, string][], on = true, col = "#5eead4") {
      if (last >= 0 && t - last < 0.5) return; last = t;
      x.fillStyle = "#03110e"; x.fillRect(0, 0, pxW, pxH);
      if (on) {
        x.fillStyle = col; x.textBaseline = "top";
        const big = Math.round(pxH * 0.38), small = Math.round(pxH * (lines.length > 3 ? 0.13 : 0.16));
        lines.forEach(([l, v], i) => {
          if (i === 0) {
            x.font = `${Math.round(big * 0.34)}px monospace`; x.fillText(l, 8, 4);
            x.font = `bold ${big}px monospace`; x.textAlign = "right"; x.fillText(v, pxW - 8, 4 + big * 0.36); x.textAlign = "left";
          } else {
            const y = 6 + big * 1.42 + (i - 1) * small * 1.15;
            x.font = `${small}px monospace`; x.fillText(l, 8, y); x.textAlign = "right"; x.fillText(v, pxW - 8, y); x.textAlign = "left";
          }
        });
      }
      tex.needsUpdate = true;
    },
  };
}

const f = (v: number | undefined, d = 1) => (v === undefined || !Number.isFinite(v) ? "--" : v.toFixed(d));

/** Horizontal pipe along X with flanges at both ends and two pipe stands. */
function pipeRun(g: THREE.Object3D, x0: number, x1: number, y: number, r: number, mat: THREE.Material) {
  const p = X(cyl(r, r, x1 - x0, mat, 20)); p.position.set((x0 + x1) / 2, y, 0); g.add(p);
  [x0, x1].forEach((x) => { const fl = X(cyl(r * 1.6, r * 1.6, 0.06, M(C.light), 20)); fl.position.set(x, y, 0); g.add(fl); });
  [x0 + 0.25, x1 - 0.25].forEach((x) => {
    const post = cyl(0.04, 0.04, y - r, M(C.steel), 8); post.position.set(x, (y - r) / 2, 0); g.add(post);
    const base = box(0.3, 0.04, 0.3, M(C.dark)); base.position.set(x, 0.02, 0); g.add(base);
  });
  return p;
}

/** Scaled sub-group so the Size setting scales the whole instrument. */
function scaled(g: THREE.Group, s: number) { const sg = new THREE.Group(); sg.scale.setScalar(s); g.add(sg); return sg; }

const SIZE = { l: "Size", min: 0.6, max: 3, step: 0.1, v: 1 };

/** Status LED colour helper. */
function statusLed(m: THREE.MeshStandardMaterial, status: string, t: number) {
  const c = SCOL[status] ?? 0x64748b; m.color.setHex(c); m.emissive.setHex(c);
  m.emissiveIntensity = status === "crit" ? (Math.sin(t * 9) > 0 ? 1.4 : 0.1) : 1;
}

/** Transmitter head: round housing with a display facing +Z and a status LED. */
function txHead(parent: THREE.Object3D, x: number, y: number, z: number, col = 0x2f5f9e) {
  const head = new THREE.Group(); head.position.set(x, y, z); parent.add(head);
  const body = cyl(0.2, 0.2, 0.26, M(col), 24); body.rotation.x = PI / 2; head.add(body);
  const cap = cyl(0.21, 0.21, 0.04, M(C.light), 24); cap.rotation.x = PI / 2; cap.position.z = 0.14; head.add(cap);
  const d = display(0.26, 0.17); d.mesh.position.z = 0.165; head.add(d.mesh);
  const ledM = lamp(0x22c55e); const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), ledM); led.position.set(0.15, 0.1, 0.16); head.add(led);
  const gland = cyl(0.035, 0.035, 0.1, M(C.dark), 10); gland.position.set(0.24, 0, 0); gland.rotation.z = PI / 2; head.add(gland);
  return { head, disp: d, ledM };
}

const GAS: Record<string, { u: string; v: number; warn: number; crit: number; fault: number; name: string }> = {
  "Methane (%LEL)": { u: "%LEL", v: 2, warn: 20, crit: 40, fault: 55, name: "Methane" },
  "H2S (ppm)": { u: "ppm", v: 1, warn: 10, crit: 15, fault: 25, name: "H2S" },
  "CO (ppm)": { u: "ppm", v: 5, warn: 25, crit: 50, fault: 80, name: "CO" },
  "Ammonia (ppm)": { u: "ppm", v: 4, warn: 25, crit: 35, fault: 50, name: "NH3" },
};
const GAUGE: Record<string, number> = { "0–10 bar": 10, "0–25 bar": 25, "0–100 bar": 100 };
const DN: Record<string, { r: number; q: number }> = { DN50: { r: 0.09, q: 30 }, DN100: { r: 0.14, q: 120 }, DN200: { r: 0.22, q: 450 } };
const VFD_KW: Record<string, number> = { "37 kW": 37, "90 kW": 90, "250 kW": 250 };
const HIGH_T = "High temperature (0–600 °C)";

export const INSTRUMENTS: Record<string, ModelDef> = {
  // ── Energy meter ───────────────────────────────────────────────────────────
  energy_meter: {
    fam: "instruments", name: "Energy meter", pre: "EM",
    params: { size: SIZE, mount: { l: "Mounting", opts: ["Panel door", "Wall"], v: "Panel door" } },
    tags: () => [
      T("kw", "Active power", "kW", 125, { noise: 1.5, d: 1, warn: 180, crit: 200 }),
      T("kwh", "Energy", "kWh", 48210, { off: 48210, noise: 0, d: 0 }),
      T("v", "Voltage", "V", 415, { off: 415, noise: 0.8, d: 0, low: true, warn: 380, crit: 360 }),
      T("a", "Current", "A", 175, { noise: 2, d: 0, warn: 250, crit: 280, fault: 290 }),
      T("pf", "Power factor", "", 0.95, { off: 0.95, noise: 0.004, d: 2, low: true, warn: 0.9, crit: 0.85, fault: 0.78 }),
      T("hz", "Frequency", "Hz", 50, { off: 50, noise: 0.02, d: 2 }),
    ],
    main: () => "kw",
    binds: () => [
      ["Display", "Show kW, kWh, V, A, PF", "kw"],
      ["Pulse LED", "Blink with power", "kw"],
      ["Current transformers", "Glow with current", "a"],
      ["Label", "Show value", "kw"],
    ],
    build(p, g) {
      const s = scaled(g, p.size), panel = p.mount === "Panel door";
      if (panel) {
        const cab = box(1.0, 1.7, 0.45, M(0xd1d5db, { metalness: 0.3 })); cab.position.set(0, 0.95, 0); s.add(cab);
        const plinth = box(1.04, 0.1, 0.5, M(C.dark)); plinth.position.set(0, 0.05, 0); s.add(plinth);
        const handle = box(0.03, 0.18, 0.04, M(C.dark)); handle.position.set(0.4, 0.95, 0.24); s.add(handle);
      } else {
        const wall = box(1.4, 2.2, 0.1, M(0x9ca3af, { metalness: 0.1, roughness: 0.9 })); wall.position.set(0, 1.1, -0.1); s.add(wall);
      }
      const z0 = panel ? 0.23 : -0.05;
      const meter = box(0.5, 0.5, 0.1, M(0x1f2937)); meter.position.set(0, 1.25, z0 + 0.05); s.add(meter);
      const bezel = box(0.44, 0.24, 0.01, M(0x111827)); bezel.position.set(0, 1.33, z0 + 0.105); s.add(bezel);
      const d = display(0.4, 0.21); d.mesh.position.set(0, 1.33, z0 + 0.112); s.add(d.mesh);
      for (let k = 0; k < 4; k++) { const b = box(0.06, 0.04, 0.02, M(C.light)); b.position.set(-0.15 + k * 0.1, 1.12, z0 + 0.11); s.add(b); }
      const pulseM = lamp(0xef4444); const pl = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), pulseM); pl.position.set(0.19, 1.07, z0 + 0.11); s.add(pl);
      // three phase cables with current transformers, entering from below
      const ctM: THREE.MeshStandardMaterial[] = [];
      [0xa16207, 0x111827, 0x6b7280].forEach((c, i) => {
        const x = -0.2 + i * 0.2;
        s.add(pipe(P(x, 0.1, z0 + 0.2), P(x, 0.85, z0 + 0.2), 0.025, M(c)));
        const m = M(0x334155, { emissive: 0x000000 }); ctM.push(m);
        const ct = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.02, 8, 18), m); ct.rotation.x = PI / 2; ct.position.set(x, 0.6, z0 + 0.2); s.add(ct);
      });
      let ph = 0;
      return (dt, t, it) => {
        const on = it.running;
        d.draw(t, [["kW", f(it.r.kw, 1)], ["kWh", f(it.r.kwh, 0)], ["V", f(it.r.v, 0)], ["A", f(it.r.a, 0)], ["PF", f(it.r.pf, 2)]], on, it.status === "crit" ? "#f87171" : it.status === "warn" ? "#fbbf24" : "#5eead4");
        // the pulse LED flashes once per "impulse", faster with more power
        ph += dt * clamp(Math.abs(it.r.kw) / 25, 0, 12) * (on ? 1 : 0);
        pulseM.emissiveIntensity = ph % 1 < 0.15 ? 1.6 : 0.05;
        ctM.forEach((m) => heatTo(m, it.r.a, 0, 300, 0.6));
      };
    },
  },

  // ── Pressure gauge ─────────────────────────────────────────────────────────
  pressure_gauge: {
    fam: "instruments", name: "Pressure gauge", pre: "PI",
    params: { size: SIZE, range: { l: "Range", opts: Object.keys(GAUGE), v: "0–10 bar" } },
    tags: (p) => {
      const max = GAUGE[p.range] ?? 10;
      return [T("p", "Pressure", "bar", +(max * 0.55).toFixed(2), { noise: max * 0.004, d: max >= 100 ? 1 : 2, warn: max * 0.8, crit: max * 0.9, fault: max * 0.96 })];
    },
    main: () => "p",
    binds: () => [["Needle", "Point to pressure", "p"], ["Dial bands", "Green, amber and red from the limits", "p"], ["Label", "Show value", "p"]],
    build(p, g) {
      const s = scaled(g, p.size), max = GAUGE[p.range] ?? 10;
      const st = M(C.steel);
      pipeRun(s, -0.9, 0.9, 0.6, 0.1, M(0x64748b));
      // tee, isolation valve with handwheel, stem up to the gauge
      s.add(pipe(P(0, 0.6, 0), P(0, 1.15, 0), 0.04, st));
      const vb = box(0.12, 0.12, 0.12, M(C.blue)); vb.position.set(0, 0.85, 0); s.add(vb);
      const hw = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 16), M(0xdc2626)); hw.position.set(0, 0.85, 0.12); s.add(hw);
      // gauge case faces +Z
      const gy = 1.4, R = 0.3;
      const cs = cyl(R + 0.03, R + 0.03, 0.12, M(0x1f2937, { metalness: 0.8, roughness: 0.3 }), 40); cs.rotation.x = PI / 2; cs.position.set(0, gy, 0); s.add(cs);
      const { cv, x } = canvas2d(256, 256);
      x.fillStyle = "#f8fafc"; x.fillRect(0, 0, 256, 256);
      const a0 = 135 * PI / 180, sweep = 270 * PI / 180, cx = 128, cy = 128;
      const arc = (u0: number, u1: number, col: string) => { x.strokeStyle = col; x.lineWidth = 14; x.beginPath(); x.arc(cx, cy, 100, a0 + sweep * u0, a0 + sweep * u1); x.stroke(); };
      arc(0, 0.8, "#22c55e"); arc(0.8, 0.9, "#f59e0b"); arc(0.9, 1, "#ef4444");
      x.strokeStyle = "#0f172a"; x.fillStyle = "#0f172a"; x.font = "bold 18px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      for (let i = 0; i <= 10; i++) {
        const a = a0 + sweep * i / 10; x.lineWidth = 3; x.beginPath(); x.moveTo(cx + Math.cos(a) * 86, cy + Math.sin(a) * 86); x.lineTo(cx + Math.cos(a) * 108, cy + Math.sin(a) * 108); x.stroke();
        x.fillText(String(+(max * i / 10).toFixed(max >= 100 ? 0 : 1)), cx + Math.cos(a) * 68, cy + Math.sin(a) * 68);
      }
      x.font = "bold 20px sans-serif"; x.fillText("bar", cx, cy + 50);
      const face = new THREE.Mesh(new THREE.CircleGeometry(R, 48), M(0xffffff, { map: new THREE.CanvasTexture(cv), metalness: 0, roughness: 0.8 }));
      face.position.set(0, gy, 0.061); s.add(face);
      const needle = new THREE.Group(); needle.position.set(0, gy, 0.07); s.add(needle);
      const nd = box(0.012, R * 0.85, 0.01, M(0xdc2626)); nd.position.y = R * 0.32; needle.add(nd);
      const hub = cyl(0.025, 0.025, 0.02, M(C.dark), 16); hub.rotation.x = PI / 2; needle.add(hub);
      const glassC = new THREE.Mesh(new THREE.CircleGeometry(R + 0.02, 48), glass(0xffffff, 0.12)); glassC.position.set(0, gy, 0.085); s.add(glassC);
      let ang = 0;
      return (dt, t, it) => {
        const u = clamp(it.r.p / max, 0, 1.05);
        // needle rests at the 7-o'clock end; a little jitter when running
        const target = (135 - u * 270) * PI / 180 + (it.running ? rnd(0.01) : 0);
        ang += (target - ang) * Math.min(1, dt * 6);
        needle.rotation.z = ang;
      };
    },
  },

  // ── Electromagnetic flow meter ─────────────────────────────────────────────
  mag_flow: {
    fam: "instruments", name: "Electromagnetic flow meter", pre: "FT",
    params: { size: SIZE, dn: { l: "Pipe size", opts: Object.keys(DN), v: "DN100" } },
    tags: (p) => {
      const q = (DN[p.dn] ?? DN.DN100).q;
      return [
        T("flow", "Flow", "m³/h", q, { noise: q * 0.008, warn: q * 1.15, crit: q * 1.3, fault: q * 0.05 }),
        T("total", "Totaliser", "m³", 125430, { off: 125430, noise: 0, d: 0 }),
        T("cond", "Conductivity", "µS/cm", 520, { off: 520, noise: 2, d: 0, low: true, warn: 50, crit: 20, fault: 5 }),
        T("empty", "Empty pipe", "", 0, { off: 0, d: 0, warn: 0.5, crit: 0.9, fault: 1 }),
      ];
    },
    main: () => "flow",
    binds: () => [["Flow particles", "Move with flow, stop when empty", "flow"], ["Display", "Show flow and totaliser", "flow"], ["Status LED", "Alarm colour", "empty"], ["Label", "Show value", "flow"]],
    build(p, g) {
      const s = scaled(g, p.size), d = DN[p.dn] ?? DN.DN100, r = d.r, y = 0.7;
      pipeRun(s, -1.2, 1.2, y, r, M(0x64748b));
      // flanged meter body with liner, electrodes and coils (seen in X-ray)
      const body = X(cyl(r * 1.55, r * 1.55, 0.6, M(C.blue), 28)); body.position.set(0, y, 0); s.add(body);
      [-0.32, 0.32].forEach((xx) => { const fl = X(cyl(r * 1.9, r * 1.9, 0.06, M(C.light), 24)); fl.position.set(xx, y, 0); s.add(fl); });
      [-1, 1].forEach((sd) => { const coil = box(0.3, 0.06, r * 1.2, M(0xb45309)); coil.position.set(0, y + sd * r * 1.15, 0); s.add(coil); });
      [-1, 1].forEach((sd) => { const el = cyl(0.015, 0.015, 0.08, M(0xe5e7eb), 8); el.rotation.x = PI / 2; el.position.set(0, y, sd * r * 1.1); s.add(el); });
      s.add(pipe(P(0, y + r * 1.5, 0), P(0, y + r * 1.5 + 0.25, 0), 0.05, M(C.blue)));
      const tx = txHead(s, 0, y + r * 1.5 + 0.45, 0);
      const flow = particles(s, polyline([P(-1.2, y, 0), P(1.2, y, 0)]), 16, 0x38bdf8, r * 0.35);
      return (dt, t, it) => {
        const empty = it.r.empty >= 0.5;
        flow.update(dt, it.running && !empty ? clamp(it.r.flow / d.q, 0, 1.6) * 1.5 : 0);
        tx.disp.draw(t, [["m³/h", f(it.r.flow, 1)], ["Total m³", f(it.r.total, 0)], ["µS/cm", f(it.r.cond, 0)], [empty ? "EMPTY PIPE" : "", ""]], it.running, empty ? "#f87171" : "#5eead4");
        statusLed(tx.ledM, it.status, t);
      };
    },
  },

  // ── Coriolis flow meter ────────────────────────────────────────────────────
  coriolis: {
    fam: "instruments", name: "Coriolis flow meter", pre: "FT",
    params: { size: SIZE },
    tags: () => [
      T("mass", "Mass flow", "kg/h", 8500, { noise: 40, d: 0, warn: 11000, crit: 12500 }),
      T("dens", "Density", "kg/m³", 998, { off: 998, noise: 0.3, low: true, warn: 950, crit: 900, fault: 870 }),
      T("temp", "Temperature", "°C", 42, { off: AMB, noise: 0.1, warn: 80, crit: 95 }),
      T("drive", "Drive gain", "%", 3, { off: 0, noise: 0.15, warn: 15, crit: 30, fault: 45 }),
    ],
    main: () => "mass",
    binds: () => [["Measuring tubes", "Vibrate with flow (seen in X-ray)", "mass"], ["Display", "Show mass flow, density", "mass"], ["Housing", "Heat colour", "temp"], ["Label", "Show value", "mass"]],
    build(p, g) {
      const s = scaled(g, p.size), y = 1.3, r = 0.08;
      pipeRun(s, -1.3, -0.45, y, r, M(0x64748b)); pipeRun(s, 0.45, 1.3, y, r, M(0x64748b));
      const man = X(cyl(r * 1.4, r * 1.4, 0.9, M(0x94a3b8), 20)); man.position.set(0, y, 0); s.add(man);
      // two bent measuring tubes hanging below the manifold, inside a housing
      const tubeM = M(0xd1d5db, { metalness: 0.9, roughness: 0.2 });
      const tubes: THREE.Mesh[] = [];
      [-0.06, 0.06].forEach((z) => {
        const curve = new THREE.CatmullRomCurve3([P(-0.4, y, z), P(-0.42, y - 0.4, z), P(-0.3, y - 0.75, z), P(0, y - 0.82, z), P(0.3, y - 0.75, z), P(0.42, y - 0.4, z), P(0.4, y, z)]);
        const tm = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.025, 8), tubeM); s.add(tm); tubes.push(tm);
      });
      const housM = M(0x9aa6b6, { metalness: 0.6, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
      const hous = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.25, 40, 1, false, PI, PI), housM); hous.rotation.x = PI / 2; hous.position.set(0, y - 0.05, 0); s.add(hous);
      const cap = box(1.0, 0.04, 0.25, housM); cap.position.set(0, y - 0.05, 0); s.add(cap);
      const coil = box(0.06, 0.06, 0.2, M(0xb45309)); coil.position.set(0, y - 0.85, 0); s.add(coil);
      s.add(pipe(P(0, y + r, 0), P(0, y + 0.3, 0), 0.05, M(C.light)));
      const tx = txHead(s, 0, y + 0.5, 0, 0x475569);
      const stand = cyl(0.04, 0.04, y - 0.9, M(C.steel), 8); stand.position.set(0, (y - 0.9) / 2, 0); s.add(stand);
      return (dt, t, it) => {
        const amp = it.running ? clamp(it.r.mass / 12000, 0.05, 1.2) * 0.012 : 0;
        // the tubes oscillate against each other; the drive gain adds an irregular wobble (gas)
        const wob = clamp(it.r.drive / 45, 0, 1) * rnd(0.01);
        tubes[0].position.z = Math.sin(t * 45) * amp + wob; tubes[1].position.z = -Math.sin(t * 45) * amp - wob;
        heatTo(housM, it.r.temp, 40, 110, 0.6);
        tx.disp.draw(t, [["kg/h", f(it.r.mass, 0)], ["kg/m³", f(it.r.dens, 1)], ["°C", f(it.r.temp, 1)], ["Drive %", f(it.r.drive, 1)]], it.running);
        statusLed(tx.ledM, it.status, t);
      };
    },
  },

  // ── Vortex flow meter ──────────────────────────────────────────────────────
  vortex: {
    fam: "instruments", name: "Vortex flow meter", pre: "FT",
    params: { size: SIZE, medium: { l: "Medium", opts: ["Steam", "Gas", "Liquid"], v: "Steam" } },
    tags: (p) => {
      const steam = p.medium === "Steam", liq = p.medium === "Liquid";
      return [
        T("flow", "Flow", liq ? "m³/h" : "t/h", liq ? 60 : 6.2, { noise: liq ? 0.6 : 0.06, warn: liq ? 80 : 8, crit: liq ? 95 : 9.5, fault: liq ? 12 : 1.2 }),
        T("temp", "Temperature", "°C", steam ? 180 : 35, { off: AMB, noise: 0.3, warn: steam ? 220 : 70, crit: steam ? 240 : 85 }),
        T("pres", "Pressure", "bar", steam ? 10 : 4, { off: 0, noise: 0.05, d: 2, warn: steam ? 13 : 6, crit: steam ? 15 : 7 }),
        T("freq", "Vortex frequency", "Hz", 210, { noise: 2, d: 0 }),
      ];
    },
    main: () => "flow",
    binds: () => [["Vortex particles", "Swirl with flow", "flow"], ["Display", "Show flow, temperature, pressure", "flow"], ["Pipe", "Heat colour", "temp"], ["Label", "Show value", "flow"]],
    build(p, g) {
      const s = scaled(g, p.size), y = 0.7, r = 0.12;
      const pipeM = M(p.medium === "Steam" ? 0x9ca3af : 0x64748b, { emissive: 0x000000 });
      pipeRun(s, -1.2, 1.2, y, r, pipeM);
      const wafer = X(cyl(r * 1.7, r * 1.7, 0.2, M(0x475569), 24)); wafer.position.set(0, y, 0); s.add(wafer);
      const bluff = box(0.04, r * 1.9, 0.05, M(0xe5e7eb)); bluff.position.set(-0.02, y, 0); s.add(bluff);
      s.add(pipe(P(0, y + r * 1.6, 0), P(0, y + 0.55, 0), 0.04, M(C.light)));
      const tx = txHead(s, 0, y + 0.75, 0, 0x1e3a8a);
      // a zig-zag path downstream of the bluff body shows the vortex street
      const pts = [P(-1.2, y, 0), P(-0.05, y, 0)];
      for (let i = 1; i <= 10; i++) pts.push(P(-0.05 + i * 0.12, y + (i % 2 ? 1 : -1) * r * 0.55, (i % 2 ? -1 : 1) * r * 0.3));
      const swirl = particles(s, polyline(pts), 22, p.medium === "Steam" ? 0xe2e8f0 : 0x38bdf8, r * 0.22);
      return (dt, t, it) => {
        swirl.update(dt, it.running ? clamp(it.r.flow / (p.medium === "Liquid" ? 60 : 6.2), 0, 1.6) * 1.4 : 0);
        heatTo(pipeM, it.r.temp, 100, 260, 0.5);
        tx.disp.draw(t, [[p.medium === "Liquid" ? "m³/h" : "t/h", f(it.r.flow, p.medium === "Liquid" ? 1 : 2)], ["°C", f(it.r.temp, 0)], ["bar", f(it.r.pres, 2)], ["Hz", f(it.r.freq, 0)]], it.running);
        statusLed(tx.ledM, it.status, t);
      };
    },
  },

  // ── Temperature transmitter ────────────────────────────────────────────────
  temp_tx: {
    fam: "instruments", name: "Temperature transmitter", pre: "TT",
    params: { size: SIZE, range: { l: "Range", opts: ["Process (0–150 °C)", HIGH_T], v: "Process (0–150 °C)" } },
    tags: (p) => {
      const hi = p.range === HIGH_T;
      return [T("temp", "Temperature", "°C", hi ? 420 : 85, { off: AMB, noise: hi ? 1 : 0.2, warn: hi ? 500 : 110, crit: hi ? 550 : 130, fault: hi ? 570 : 138 })];
    },
    main: () => "temp",
    binds: () => [["Thermowell", "Glow with temperature (seen in X-ray)", "temp"], ["Display", "Show temperature", "temp"], ["Label", "Show value", "temp"]],
    build(p, g) {
      const s = scaled(g, p.size), hi = p.range === HIGH_T, y = 0.7, r = 0.16;
      const pipeM = M(0x64748b, { emissive: 0x000000 });
      pipeRun(s, -1.0, 1.0, y, r, pipeM);
      // weld boss, thermowell reaching into the flow, extension neck, head
      const boss = cyl(0.05, 0.06, 0.08, M(C.light), 12); boss.position.set(0, y + r + 0.02, 0); s.add(boss);
      const wellM = M(0xcbd5e1, { metalness: 0.9, roughness: 0.25, emissive: 0x000000 });
      const well = cyl(0.025, 0.018, r * 1.6, wellM, 12); well.position.set(0, y + r * 0.25, 0); s.add(well);
      s.add(pipe(P(0, y + r + 0.05, 0), P(0, y + r + 0.4, 0), 0.025, M(C.light)));
      const tx = txHead(s, 0, y + r + 0.6, 0, hi ? 0x7c2d12 : 0x2f5f9e);
      return (dt, t, it) => {
        heatTo(wellM, it.r.temp, hi ? 200 : 40, hi ? 600 : 150, 1);
        heatTo(pipeM, it.r.temp, hi ? 300 : 90, hi ? 650 : 160, 0.5);
        tx.disp.draw(t, [["°C", f(it.r.temp, hi ? 0 : 1)]], it.running);
        statusLed(tx.ledM, it.status, t);
      };
    },
  },

  // ── Radar level transmitter ────────────────────────────────────────────────
  radar_level: {
    fam: "instruments", name: "Radar level transmitter", pre: "LT",
    params: { size: SIZE, tank: { l: "Tank height (m)", min: 2, max: 8, step: 0.5, v: 3 } },
    tags: () => [
      T("level", "Level", "%", 62, { off: 62, noise: 0.15, warn: 85, crit: 92, fault: 96 }),
      T("dist", "Distance to surface", "m", 1.2, { off: 1.2, noise: 0.005, d: 2 }),
      T("sig", "Signal strength", "dB", 32, { off: 32, noise: 0.3, low: true, warn: 15, crit: 10 }),
    ],
    main: () => "level",
    binds: () => [["Liquid", "Fill to level", "level"], ["Radar beam", "Reach the surface", "level"], ["Display", "Show level", "level"], ["Label", "Show value", "level"]],
    build(p, g) {
      const s = scaled(g, p.size), H = p.tank, R = 0.9;
      const shell = cyl(R, R, H, glass(0x9fb3c8, 0.22), 40, true); shell.position.y = 0.3 + H / 2; s.add(shell);
      const bot = cyl(R, R, 0.04, M(C.steel), 40); bot.position.y = 0.3; s.add(bot);
      const roof = lathe([[R, 0], [R * 0.6, 0.18], [0, 0.25]], M(C.steel)); roof.position.y = 0.3 + H; s.add(roof);
      [0, 1, 2, 3].forEach((i) => { const a = i * PI / 2 + PI / 4; const leg = cyl(0.05, 0.05, 0.3, M(C.dark), 8); leg.position.set(Math.cos(a) * R * 0.8, 0.15, Math.sin(a) * R * 0.8); s.add(leg); });
      const liqM = M(0x2563eb, { transparent: true, opacity: 0.75 });
      const liq = cyl(R * 0.97, R * 0.97, 1, liqM, 40); s.add(liq);
      const top = 0.3 + H + 0.15, nx = R * 0.45;
      const noz = cyl(0.12, 0.12, 0.3, M(C.light), 20); noz.position.set(nx, top + 0.05, 0); s.add(noz);
      const fl = cyl(0.17, 0.17, 0.04, M(C.light), 20); fl.position.set(nx, top + 0.2, 0); s.add(fl);
      const horn = cyl(0.04, 0.11, 0.3, M(0xd1d5db, { metalness: 0.8 }), 20, true); horn.position.set(nx, top - 0.05, 0); s.add(horn);
      const tx = txHead(s, nx, top + 0.45, 0, 0x1d4ed8);
      // the beam is an effect: not part of the bounding box or X-ray materials
      const beamM = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
      const beamG = new THREE.CylinderGeometry(0.06, 0.35, 1, 24, 1, true); beamG.translate(0, -0.5, 0);
      const beamMesh = new THREE.Mesh(beamG, beamM); beamMesh.userData.fx = true; beamMesh.position.set(nx, top - 0.2, 0); s.add(beamMesh);
      let lv = 0.62;
      return (dt, t, it) => {
        lv += (clamp(it.r.level / 100, 0, 1) - lv) * Math.min(1, dt * 2);
        const h = Math.max(0.01, lv * H);
        liq.scale.y = h; liq.position.y = 0.3 + h / 2;
        liqM.color.setHex(it.r.level >= 92 ? 0xdc2626 : it.r.level >= 85 ? 0xd97706 : 0x2563eb);
        const len = Math.max(0.05, top - 0.2 - (0.3 + h));
        beamMesh.scale.y = len;
        beamM.opacity = it.running ? 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(t * 6)) * clamp(it.r.sig / 30, 0.2, 1.2) : 0;
        tx.disp.draw(t, [["Level %", f(it.r.level, 1)], ["m", f(it.r.dist, 2)], ["dB", f(it.r.sig, 0)]], it.running);
        statusLed(tx.ledM, it.status, t);
      };
    },
  },

  // ── Gas detector ───────────────────────────────────────────────────────────
  gas_detector: {
    fam: "instruments", name: "Gas detector", pre: "GD",
    params: { size: SIZE, gas: { l: "Gas", opts: Object.keys(GAS), v: "Methane (%LEL)" } },
    tags: (p) => {
      const gd = GAS[p.gas] ?? GAS["Methane (%LEL)"];
      return [T("gas", "Gas concentration", gd.u, gd.v, { off: 0, noise: gd.v * 0.08, warn: gd.warn, crit: gd.crit, fault: gd.fault })];
    },
    main: () => "gas",
    binds: () => [["Beacon", "Blink above the warning limit", "gas"], ["Gas cloud", "Grow with concentration", "gas"], ["Display", "Show concentration", "gas"], ["Label", "Show value", "gas"]],
    build(p, g) {
      const s = scaled(g, p.size), gd = GAS[p.gas] ?? GAS["Methane (%LEL)"];
      const post = cyl(0.04, 0.04, 1.8, M(C.steel), 10); post.position.set(0, 0.9, -0.1); s.add(post);
      const base = box(0.35, 0.04, 0.35, M(C.dark)); base.position.set(0, 0.02, -0.1); s.add(base);
      const plate = box(0.4, 0.5, 0.03, M(C.light)); plate.position.set(0, 1.3, -0.05); s.add(plate);
      const body = box(0.3, 0.32, 0.16, M(0xeab308)); body.position.set(0, 1.32, 0.05); s.add(body);
      const d = display(0.22, 0.12, 192, 96); d.mesh.position.set(0, 1.38, 0.131); s.add(d.mesh);
      const head = cyl(0.07, 0.07, 0.14, M(0x1f2937), 20); head.position.set(0, 1.08, 0.05); s.add(head);
      const grille = cyl(0.072, 0.072, 0.04, M(0x6b7280), 20); grille.position.set(0, 1.0, 0.05); s.add(grille);
      const beaconM = M(0xdc2626, { emissive: 0xdc2626, emissiveIntensity: 0.1, transparent: true, opacity: 0.9 });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12, 0, 2 * PI, 0, PI / 2), beaconM); beacon.position.set(0, 1.55, 0.05); s.add(beacon);
      const bbase = cyl(0.075, 0.075, 0.04, M(C.dark), 16); bbase.position.set(0, 1.53, 0.05); s.add(bbase);
      const cloud: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xa3e635, transparent: true, opacity: 0, depthWrite: false }));
        m.userData.fx = true; m.userData.o = P(rnd(0.6), rnd(0.4), rnd(0.6)); m.position.set(0, 0.95, 0.15).add(m.userData.o); s.add(m); cloud.push(m);
      }
      return (dt, t, it) => {
        const v = it.r.gas, k = clamp(v / gd.crit, 0, 1.3);
        const on = it.running && v >= gd.warn;
        beaconM.emissiveIntensity = on ? (Math.sin(t * (v >= gd.crit ? 14 : 6)) > 0 ? 1.8 : 0.1) : 0.1;
        cloud.forEach((m, i) => { m.material.opacity = it.running ? 0.22 * k : 0; m.scale.setScalar(0.6 + k * 1.6 + 0.15 * Math.sin(t + i)); });
        d.draw(t, [[gd.name + " " + gd.u, f(v, gd.u === "ppm" ? 0 : 1)]], it.running, v >= gd.crit ? "#f87171" : v >= gd.warn ? "#fbbf24" : "#5eead4");
      };
    },
  },

  // ── Control valve with positioner ──────────────────────────────────────────
  valve_positioner: {
    fam: "instruments", name: "Control valve with positioner", pre: "FCV",
    params: { size: SIZE, action: { l: "Action", opts: ["Air to open", "Air to close"], v: "Air to open" } },
    tags: () => [
      T("pos", "Valve position", "%", 55, { off: 0, noise: 0.3, d: 0, fault: 38 }),
      T("sp", "Set point", "%", 55, { off: 0, noise: 0, d: 0 }),
      T("dev", "Deviation", "%", 0.4, { off: 0, noise: 0.1, warn: 3, crit: 6, fault: 9 }),
      T("air", "Supply air", "bar", 5.5, { off: 5.5, noise: 0.02, d: 2, low: true, warn: 4, crit: 3.5 }),
    ],
    main: () => "pos",
    binds: () => [["Valve stem", "Move with position", "pos"], ["Feedback arm", "Turn with position", "pos"], ["Flow particles", "Move with opening", "pos"], ["Display", "Show position and set point", "pos"], ["Label", "Show value", "pos"]],
    build(p, g) {
      const s = scaled(g, p.size), y = 0.6, r = 0.12;
      pipeRun(s, -1.1, 1.1, y, r, M(0x64748b));
      const bodyM = M(C.blue);
      const vb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 16), bodyM); vb.scale.set(1.2, 1, 1); vb.position.set(0, y, 0); s.add(vb);
      [-0.3, 0.3].forEach((xx) => { const fl = X(cyl(r * 1.8, r * 1.8, 0.06, M(C.light), 20)); fl.position.set(xx, y, 0); s.add(fl); });
      const bon = cyl(0.12, 0.16, 0.22, bodyM, 20); bon.position.set(0, y + 0.33, 0); s.add(bon);
      [-0.13, 0.13].forEach((zz) => { const post = box(0.04, 0.5, 0.04, M(C.steel)); post.position.set(0, y + 0.69, zz); s.add(post); });
      const act = lathe([[0.02, 0], [0.34, 0.02], [0.36, 0.1], [0.3, 0.22], [0, 0.26]], M(0x1d4ed8)); act.position.set(0, y + 0.94, 0); s.add(act);
      const stem = cyl(0.025, 0.025, 0.4, M(0xe5e7eb, { metalness: 0.9 }), 12); s.add(stem);
      const ind = box(0.08, 0.02, 0.05, M(C.orange)); s.add(ind);
      const scale = box(0.02, 0.3, 0.06, M(0xf8fafc)); scale.position.set(0.08, y + 0.69, 0.13); s.add(scale);
      // positioner on the yoke, with feedback arm linked to the stem
      const posB = box(0.2, 0.24, 0.14, M(0x334155)); posB.position.set(0.22, y + 0.72, 0); s.add(posB);
      const d = display(0.16, 0.1, 160, 100); d.mesh.position.set(0.22, y + 0.76, 0.071); s.add(d.mesh);
      const ledM = lamp(0x22c55e); const led = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), ledM); led.position.set(0.29, y + 0.64, 0.072); s.add(led);
      const arm = new THREE.Group(); arm.position.set(0.12, y + 0.72, 0.08); s.add(arm);
      const armB = box(0.14, 0.015, 0.015, M(C.light)); armB.position.x = -0.07; arm.add(armB);
      s.add(pipe(P(0.32, y + 0.8, 0), P(0.32, y + 1.08, 0), 0.01, M(0xd97706)));
      s.add(pipe(P(0.32, y + 1.08, 0), P(0.05, y + 1.08, 0), 0.01, M(0xd97706)));
      const flow = particles(s, polyline([P(-1.1, y, 0), P(1.1, y, 0)]), 14, 0x38bdf8, r * 0.3);
      let pos = 0.55;
      return (dt, t, it) => {
        pos += (clamp(it.r.pos / 100, 0, 1) - pos) * Math.min(1, dt * 3);
        // air-to-open: stem rises to open; air-to-close: stem drops to open
        const lift = (p.action === "Air to open" ? pos : 1 - pos) * 0.18;
        stem.position.set(0, y + 0.55 + lift, 0); ind.position.set(0.04, y + 0.58 + lift, 0.13);
        arm.rotation.z = -0.5 + (lift / 0.18) * 1.0;
        flow.update(dt, it.running ? pos * 1.6 : 0);
        d.draw(t, [["POS %", f(it.r.pos, 0)], ["SP %", f(it.r.sp, 0)], ["Air bar", f(it.r.air, 1)]], it.running);
        statusLed(ledM, it.status, t);
      };
    },
  },

  // ── VFD panel ──────────────────────────────────────────────────────────────
  vfd: {
    fam: "instruments", name: "VFD panel", pre: "VFD",
    params: { size: SIZE, rating: { l: "Drive rating", opts: Object.keys(VFD_KW), v: "90 kW" } },
    tags: (p) => {
      const kw = VFD_KW[p.rating] ?? 90, amps = Math.round(kw * 1.75);
      return [
        T("hz", "Output frequency", "Hz", 45, { noise: 0.1, warn: 52, crit: 55 }),
        T("a", "Output current", "A", Math.round(amps * 0.78), { noise: amps * 0.01, d: 0, warn: Math.round(amps * 1.0), crit: Math.round(amps * 1.1), fault: Math.round(amps * 1.15) }),
        T("kw", "Output power", "kW", Math.round(kw * 0.72), { noise: kw * 0.01, d: 1 }),
        T("dc", "DC bus voltage", "V", 560, { off: 565, noise: 1.5, d: 0, warn: 720, crit: 780, fault: 800 }),
        T("temp", "Heatsink temperature", "°C", 48, { off: AMB, noise: 0.2, warn: 75, crit: 85, fault: 90 }),
      ];
    },
    main: () => "hz",
    binds: () => [["Keypad display", "Show Hz, A, kW", "hz"], ["Cooling fan", "Rotate with heatsink temperature", "temp"], ["Heatsink", "Heat colour (seen in X-ray)", "temp"], ["Label", "Show value", "hz"]],
    build(p, g) {
      const s = scaled(g, p.size), kw = VFD_KW[p.rating] ?? 90, W = kw >= 250 ? 1.2 : 0.8, H = 2.0, D = 0.6;
      const plinth = box(W + 0.04, 0.1, D + 0.04, M(C.dark)); plinth.position.y = 0.05; s.add(plinth);
      const shell = M(0xd1d5db, { metalness: 0.3 });
      const back = box(W, H, 0.03, shell); back.position.set(0, 0.1 + H / 2, -D / 2); s.add(back);
      [-1, 1].forEach((sd) => { const side = box(0.03, H, D, shell); side.position.set(sd * W / 2, 0.1 + H / 2, 0); s.add(side); });
      const top = box(W, 0.03, D, shell); top.position.set(0, 0.1 + H, 0); s.add(top);
      // inside: drive module, heatsink fins, contactor, fuses (seen in X-ray)
      const drv = box(W * 0.55, H * 0.42, 0.25, M(0x1f2937)); drv.position.set(0, 0.1 + H * 0.62, -D / 2 + 0.16); s.add(drv);
      const hsM = M(0x9ca3af, { metalness: 0.8, emissive: 0x000000 });
      for (let k = 0; k < 7; k++) { const fin = box(0.015, H * 0.3, 0.12, hsM); fin.position.set(-W * 0.22 + k * W * 0.073, 0.1 + H * 0.36, -D / 2 + 0.08); s.add(fin); }
      const cont = box(0.16, 0.2, 0.14, M(0x475569)); cont.position.set(-W * 0.25, 0.1 + H * 0.15, -D / 2 + 0.1); s.add(cont);
      for (let k = 0; k < 3; k++) { const fu = cyl(0.025, 0.025, 0.12, M(0xf8fafc), 10); fu.position.set(W * 0.1 + k * 0.08, 0.1 + H * 0.15, -D / 2 + 0.08); s.add(fu); }
      // door with keypad display, status lamps and filter louvre
      const doorM = M(0xe5e7eb, { metalness: 0.3, transparent: true, opacity: 0.97 });
      const door = box(W - 0.02, H - 0.02, 0.03, doorM); door.position.set(0, 0.1 + H / 2, D / 2); s.add(door);
      const kp = box(0.26, 0.3, 0.02, M(0x111827)); kp.position.set(0, 0.1 + H * 0.68, D / 2 + 0.02); s.add(kp);
      const d = display(0.22, 0.14, 220, 140); d.mesh.position.set(0, 0.1 + H * 0.7, D / 2 + 0.031); s.add(d.mesh);
      const lampsM = [lamp(0x22c55e), lamp(0xf59e0b), lamp(0xef4444)];
      lampsM.forEach((m, i) => { const l = cyl(0.03, 0.03, 0.03, m, 16); l.rotation.x = PI / 2; l.position.set(-0.12 + i * 0.12, 0.1 + H * 0.52, D / 2 + 0.03); s.add(l); });
      for (let k = 0; k < 5; k++) { const lv = box(W * 0.5, 0.025, 0.02, M(C.grey)); lv.position.set(0, 0.25 + k * 0.06, D / 2 + 0.025); s.add(lv); }
      const handle = box(0.03, 0.2, 0.04, M(C.dark)); handle.position.set(W / 2 - 0.08, 0.1 + H / 2, D / 2 + 0.03); s.add(handle);
      // roof fan and cable conduit to the floor
      const fan = fanRotor(5, 0.14, 0.06); fan.position.set(0, 0.1 + H + 0.06, 0); s.add(fan);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.02, 8, 24), M(C.dark)); ring.rotation.x = PI / 2; ring.position.set(0, 0.1 + H + 0.06, 0); s.add(ring);
      s.add(pipe(P(W * 0.3, 0.1, -D / 2 + 0.1), P(W * 0.3, 0.1, -D / 2 - 0.5), 0.05, M(0x1f2937)));
      return (dt, t, it) => {
        const on = it.running;
        fan.rotation.y += dt * (on ? 6 + clamp(it.r.temp - 30, 0, 60) * 0.4 : 0);
        heatTo(hsM, it.r.temp, 40, 95, 0.9);
        lampsM[0].emissiveIntensity = on ? 1.2 : 0.05;
        lampsM[1].emissiveIntensity = it.status === "warn" ? 1.2 : 0.05;
        lampsM[2].emissiveIntensity = it.status === "crit" ? (Math.sin(t * 9) > 0 ? 1.4 : 0.1) : 0.05;
        d.draw(t, [["Hz", f(it.r.hz, 1)], ["A", f(it.r.a, 0)], ["kW", f(it.r.kw, 1)], ["DC V", f(it.r.dc, 0)]], on);
      };
    },
  },
};
