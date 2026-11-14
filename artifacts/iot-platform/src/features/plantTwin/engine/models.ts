/* eslint-disable */
// Machine model library for 3D plant twins. Each model is built from simple
// shapes, takes settings (size, zones, type...), declares the readings it
// understands and returns a per-frame updater that moves its parts from those
// readings. Ported from the Live Twin concepts demo.
import * as THREE from "three";
import {
  PI, DS, AMB, clamp, rnd, P, C, TEXB, PRODUCT, SCOL, M, glass, lamp, cyl, box, X, pipe, beam, polyline, particles,
  BROWN, heatTo, spinVis, T, VIB, zoneTags, zoneProfile, fanRotor, holder, smoke, legs4, lathe, wheel, setMat, stripeTex, sparks,
} from "./kit";
import type { ModelDef } from "./types";

export const FAM: Record<string, string> = { rotating: "Rotating", vessel: "Vessels & tanks", thermal: "Thermal & heat transfer", linear: "Material handling", textile: "Textile", metals: "Iron & steel", oilgas: "Oil & gas", pharma: "Pharma", water: "Water & effluent", electrical: "Electrical & energy", hvac: "HVAC & refrigeration", other: "Other" };
export const MODELS: Record<string, ModelDef> = {
  pump: { fam: "rotating", name: "Pump", pre: "P", params: { size: { l: "Size", min: 0.6, max: 1.8, step: 0.1, v: 1 } },
    tags: () => [T("speed", "Speed", "rpm", 1480, { noise: 6, d: 0 }), VIB(), T("flow", "Flow", "m³/h", 120, { noise: 1.5, fault: 95 })],
    main: () => "flow", binds: () => [["Coupling", "Rotate", "speed"], ["Skid", "Shake", "vib"], ["Label", "Show value", "flow"]],
    build(p, g) {
      const s = p.size, st = M(C.steel);
      const base = box(2.2 * s, 0.15 * s, 0.9 * s, st); base.position.y = 0.075 * s; g.add(base);
      const mot = X(cyl(0.3 * s, 0.3 * s, 0.9 * s, M(C.blue))); mot.position.set(-0.5 * s, 0.5 * s, 0); g.add(mot);
      const cas = X(cyl(0.42 * s, 0.42 * s, 0.32 * s, M(C.grey))); cas.position.set(0.62 * s, 0.56 * s, 0); g.add(cas);
      const noz = cyl(0.12 * s, 0.12 * s, 0.5 * s, M(C.grey)); noz.position.set(0.62 * s, 1.1 * s, 0); g.add(noz);
      const suc = X(cyl(0.14 * s, 0.14 * s, 0.4 * s, M(C.grey))); suc.position.set(0.98 * s, 0.56 * s, 0); g.add(suc);
      const cp = new THREE.Group(); cp.position.set(0.12 * s, 0.5 * s, 0); g.add(cp);
      cp.add(X(cyl(0.16 * s, 0.16 * s, 0.14 * s, M(C.light))));
      for (let i = 0; i < 4; i++) { const b = box(0.16 * s, 0.045 * s, 0.045 * s, M(C.orange)), a = i * PI / 2; b.position.set(0, Math.cos(a) * 0.12 * s, Math.sin(a) * 0.12 * s); cp.add(b); }
      return (dt, t, it) => { cp.rotation.x += dt * spinVis(it.r.speed); };
    } },
  fan: { fam: "rotating", name: "Fan (ID / FD / PA)", pre: "FN", params: { type: { l: "Type", opts: ["ID fan", "FD fan", "PA fan"], v: "ID fan" }, size: { l: "Size", min: 0.6, max: 2, step: 0.1, v: 1 } },
    tags: () => [T("speed", "Speed", "rpm", 990, { noise: 4, d: 0 }), VIB(), T("damper", "Damper", "%", 65, { noise: 0.2, d: 0 }), T("amps", "Motor current", "A", 85, { noise: 0.6 })],
    binds: () => [["Impeller", "Rotate", "speed"], ["Fan", "Shake", "vib"], ["Label", "Show value", "speed"]],
    build(p, g) {
      const s = p.size, col = ({ ID: 0x6b7b90, FD: 0x2f5f9e, PA: 0x2e7d5b } as Record<string, any>)[p.type.split(" ")[0]] || C.grey, st = M(C.steel), cy = 1.4 * s;
      const ped = box(1.3 * s, cy - 0.5 * s, 0.9 * s, st); ped.position.y = (cy - 0.5 * s) / 2; g.add(ped);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8 * s, 0.14 * s, 12, 40), M(col)); ring.position.y = cy; g.add(ring);
      const back = cyl(0.85 * s, 0.85 * s, 0.2 * s, M(col)); back.rotation.x = PI / 2; back.position.set(0, cy, -0.2 * s); g.add(back);
      const rot = fanRotor(8, 0.62 * s, 0.16 * s); const h = holder("z", rot); h.position.set(0, cy, 0); g.add(h);
      const mot = cyl(0.3 * s, 0.3 * s, 0.9 * s, M(C.blue)); mot.rotation.x = PI / 2; mot.position.set(0, cy, -0.85 * s); g.add(mot);
      const mb = box(0.7 * s, cy - 0.3 * s, 0.8 * s, st); mb.position.set(0, (cy - 0.3 * s) / 2, -0.85 * s); g.add(mb);
      const duct = box(0.6 * s, 1.3 * s, 0.5 * s, M(col)); duct.position.set(0.75 * s, cy + 0.8 * s, -0.2 * s); g.add(duct);
      return (dt, t, it) => { rot.rotation.y += dt * spinVis(it.r.speed); };
    } },
  compressor: { fam: "rotating", name: "Compressor", pre: "K", params: { size: { l: "Size", min: 0.6, max: 1.8, step: 0.1, v: 1 } },
    tags: () => [T("pres", "Discharge pressure", "bar", 7.2, { noise: 0.04, d: 2, fault: 5.1, low: true, warn: 6, crit: 5.5 }), T("temp", "Discharge temp", "°C", 86, { off: AMB, noise: 0.4, warn: 100, crit: 110 }), T("kw", "Power", "kW", 75, { noise: 0.8 })],
    binds: () => [["Cooling fan", "Rotate when running", "kw"], ["Label", "Show value", "pres"]],
    build(p, g) {
      const s = p.size;
      const body = box(2.2 * s, 1.4 * s, 1.2 * s, M(C.green, { metalness: 0.3 })); body.position.y = 0.7 * s; g.add(body);
      const gr = new THREE.Mesh(new THREE.TorusGeometry(0.45 * s, 0.04 * s, 8, 32), M(C.dark)); gr.rotation.y = PI / 2; gr.position.set(1.12 * s, 0.8 * s, 0); g.add(gr);
      const rot = fanRotor(5, 0.36 * s, 0.14 * s); const h = holder("x", rot); h.position.set(1.16 * s, 0.8 * s, 0); g.add(h);
      const rec = cyl(0.42 * s, 0.42 * s, 1.8 * s, M(C.grey)); rec.position.set(-1.7 * s, 0.9 * s + 0.1, 0.1); g.add(rec);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42 * s, 20, 10, 0, 2 * PI, 0, PI / 2), M(C.grey)); cap.position.set(-1.7 * s, 1.8 * s + 0.1, 0.1); g.add(cap);
      const panel = box(0.5 * s, 0.6 * s, 0.05, M(0x0f172a, { emissive: 0x0b3b66, emissiveIntensity: 0.7 })); panel.position.set(-0.6 * s, 0.9 * s, 0.61 * s); g.add(panel);
      return (dt, t, it) => { rot.rotation.y += dt * (it.running ? 9 : 0); };
    } },
  crusher: { fam: "rotating", name: "Crusher", pre: "CR", params: { size: { l: "Size", min: 0.6, max: 1.8, step: 0.1, v: 1 } },
    tags: () => [T("speed", "Speed", "rpm", 250, { noise: 2, d: 0 }), VIB(), T("tph", "Throughput", "t/h", 320, { noise: 4, d: 0 })],
    main: () => "tph", binds: () => [["Flywheels", "Rotate", "speed"], ["Crusher", "Shake", "vib"]],
    build(p, g) {
      const s = p.size, st = M(C.steel);
      const base = box(2.4 * s, 0.8 * s, 1.8 * s, st); base.position.y = 0.4 * s; g.add(base);
      const body = box(1.6 * s, 1.2 * s, 1.4 * s, M(0x8a6a35)); body.position.y = 1.4 * s; g.add(body);
      const hop = new THREE.Mesh(new THREE.CylinderGeometry(1.2 * s, 0.6 * s, 1.1 * s, 4, 1, true), M(0x8a6a35, { side: DS })); hop.rotation.y = PI / 4; hop.position.y = 2.55 * s; g.add(hop);
      const fw = new THREE.Group(); fw.position.set(0, 1.4 * s, 0); g.add(fw);
      [-1, 1].forEach(sd => { const w = X(cyl(0.75 * s, 0.75 * s, 0.14 * s, M(C.grey))); w.position.x = sd * 0.9 * s; fw.add(w); for (let i = 0; i < 3; i++) { const sp = box(0.16 * s, 1.4 * s, 0.12 * s, M(C.orange)); sp.position.x = sd * 0.98 * s; sp.rotation.x = i * PI / 3; fw.add(sp); } });
      return (dt, t, it) => { fw.rotation.x += dt * spinVis(it.r.speed) * 0.5; };
    } },
  mill: { fam: "rotating", name: "Ball / cement mill", pre: "BM", params: { length: { l: "Length (m)", min: 3, max: 12, step: 0.5, v: 6 }, dia: { l: "Diameter (m)", min: 2, max: 5, step: 0.2, v: 3.6 } },
    tags: () => [T("speed", "Mill speed", "rpm", 15.5, { noise: 0.05 }), T("bear", "Bearing temp", "°C", 58, { off: AMB, noise: 0.2, warn: 70, crit: 80, fault: 84 }), T("kw", "Power", "kW", 2800, { noise: 15, d: 0 })],
    main: () => "kw", binds: () => [["Drum", "Rotate", "speed"], ["Label", "Show value", "kw"]],
    build(p, g) {
      const L = p.length, R = p.dia / 2, cy = R + 1;
      const drum = new THREE.Group(); drum.position.y = cy; g.add(drum);
      drum.add(X(cyl(R, R, L, M(0x64748b), 36)));
      for (let k = 0; k < 6; k++) { const a = k * PI / 3, bar = box(L * 0.96, 0.06, 0.14, M(C.orange)); bar.position.set(0, Math.cos(a) * (R + 0.02), Math.sin(a) * (R + 0.02)); bar.rotation.x = a; drum.add(bar); }
      const gear = X(cyl(R + 0.25, R + 0.25, 0.25, M(C.yellow), 40)); gear.position.x = L * 0.3; drum.add(gear);
      [-1, 1].forEach(sd => { const tr = X(cyl(R * 0.35, R * 0.35, 0.8, M(C.grey), 20)); tr.position.x = sd * (L / 2 + 0.4); drum.add(tr); const b = box(0.8, cy - 0.2, 1.4, M(0x52525b)); b.position.set(sd * (L / 2 + 0.5), (cy - 0.2) / 2, 0); g.add(b); });
      const gb = box(1, 1, 1, M(C.grey)); gb.position.set(L * 0.3, 0.5, R + 1.2); g.add(gb);
      const mot = X(cyl(0.4, 0.4, 1.2, M(C.blue), 20)); mot.position.set(L * 0.3 + 1.1, 0.6, R + 1.2); g.add(mot);
      return (dt, t, it) => { drum.rotation.x += dt * spinVis(it.r.speed); };
    } },

  vtank: { fam: "vessel", name: "Vertical tank", pre: "T", params: { height: { l: "Height (m)", min: 2, max: 12, step: 0.5, v: 6 }, dia: { l: "Diameter (m)", min: 1.5, max: 8, step: 0.5, v: 3 }, roof: { l: "Roof", opts: ["Cone", "Dome", "Floating"], v: "Cone" }, product: { l: "Contents", opts: Object.keys(PRODUCT), v: "Water" } },
    tags: () => [T("level", "Level", "%", 65, { off: 65, noise: 0.1, fault: 94, warn: 85, crit: 92 }), T("temp", "Temperature", "°C", 32, { off: 30, noise: 0.1 })],
    binds: p => [["Contents", "Fill to level", "level"], ...(p.roof === "Floating" ? [["Floating roof", "Ride on level", "level"]] : [])],
    build(p, g) {
      const H = p.height, R = p.dia / 2;
      const pad = cyl(R + 0.15, R + 0.15, 0.15, M(C.dark), 40); pad.position.y = 0.075; g.add(pad);
      const shell = cyl(R, R, H, glass(C.white, 0.22), 48, true); shell.position.y = H / 2 + 0.15; g.add(shell);
      const liq = cyl(R * 0.97, R * 0.97, 1, M(PRODUCT[p.product], { transparent: true, opacity: 0.78, metalness: 0.1 }), 48); g.add(liq);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.05, 6, 48), M(C.light)); rim.rotation.x = PI / 2; rim.position.y = H + 0.15; g.add(rim);
      let disc = null;
      if (p.roof === "Cone") { const c = new THREE.Mesh(new THREE.ConeGeometry(R * 1.03, R * 0.35, 48), M(C.light)); c.position.y = H + 0.15 + R * 0.175; g.add(c); }
      else if (p.roof === "Dome") { const d = new THREE.Mesh(new THREE.SphereGeometry(R * 1.01, 40, 12, 0, 2 * PI, 0, PI / 2), M(C.light)); d.scale.y = 0.35; d.position.y = H + 0.15; g.add(d); }
      else { disc = cyl(R * 0.96, R * 0.96, 0.18, M(0x94a3b8), 48); g.add(disc); }
      const lad = box(0.08, H, 0.4, M(C.orange)); lad.position.set(R + 0.08, H / 2 + 0.15, 0); g.add(lad);
      return (dt, t, it) => { const lv = clamp(it.r.level / 100, 0.02, 1) * H * 0.98; liq.scale.y = lv; liq.position.y = 0.15 + lv / 2; if (disc) disc.position.y = 0.15 + lv + 0.1; };
    } },
  htank: { fam: "vessel", name: "Horizontal vessel / separator", pre: "V", params: { length: { l: "Length (m)", min: 2, max: 12, step: 0.5, v: 6 }, dia: { l: "Diameter (m)", min: 1, max: 4, step: 0.1, v: 2 }, boot: { l: "Water boot", opts: ["None", "Boot"], v: "None" }, product: { l: "Contents", opts: Object.keys(PRODUCT), v: "Product" } },
    tags: () => [T("level", "Level", "%", 50, { off: 50, noise: 0.1, fault: 88, warn: 75, crit: 85 }), T("pres", "Pressure", "bar", 12, { off: 1, noise: 0.05, d: 2 })],
    binds: () => [["Contents", "Fill to level", "level"], ["Label", "Show value", "level"]],
    build(p, g) {
      const L = p.length, R = p.dia / 2, cy = R + 0.6;
      const shell = X(cyl(R, R, L, glass(C.white, 0.25), 40, true)); shell.position.y = cy; g.add(shell);
      [-1, 1].forEach(sd => { const h = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 16), glass(C.white, 0.25)); h.scale.x = 0.45; h.position.set(sd * L / 2, cy, 0); g.add(h); const sad = box(0.35, cy - R * 0.6, R * 1.6, M(C.steel)); sad.position.set(sd * L * 0.32, (cy - R * 0.6) / 2, 0); g.add(sad); });
      const liq = X(cyl(R * 0.95, R * 0.95, L, M(PRODUCT[p.product], { transparent: true, opacity: 0.78 }), 40)); g.add(liq);
      if (p.boot === "Boot") { const b = cyl(R * 0.35, R * 0.35, 0.7, glass(C.white, 0.4), 20); b.position.set(L * 0.12, cy - R - 0.2, 0); g.add(b); }
      const noz = cyl(0.12, 0.12, 0.5, M(C.grey)); noz.position.set(-L * 0.3, cy + R + 0.2, 0); g.add(noz);
      return (dt, t, it) => { const lv = clamp(it.r.level / 100, 0.04, 1); liq.scale.x = lv; liq.position.y = cy - R * 0.95 * (1 - lv); };
    } },
  sphere: { fam: "vessel", name: "Sphere (LPG)", pre: "SP", params: { dia: { l: "Diameter (m)", min: 4, max: 14, step: 0.5, v: 8 }, product: { l: "Contents", opts: Object.keys(PRODUCT), v: "Product" } },
    tags: () => [T("level", "Level", "%", 55, { off: 55, noise: 0.1, fault: 90, warn: 82, crit: 88 }), T("pres", "Pressure", "bar", 8, { off: 8, noise: 0.03, d: 2 })],
    binds: () => [["Contents", "Fill to level", "level"]],
    build(p, g) {
      const R = p.dia / 2, cy = R + 1.4;
      const sh = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 24), glass(C.white, 0.22)); sh.position.y = cy; g.add(sh);
      const liq = new THREE.Mesh(new THREE.SphereGeometry(R * 0.96, 40, 24), M(PRODUCT[p.product], { transparent: true, opacity: 0.75 })); g.add(liq);
      const eq = new THREE.Mesh(new THREE.TorusGeometry(R, 0.08, 6, 48), M(C.light)); eq.rotation.x = PI / 2; eq.position.y = cy; g.add(eq);
      for (let i = 0; i < 8; i++) { const a = i / 8 * 2 * PI, l = cyl(0.14, 0.14, cy, M(C.steel), 10); l.position.set(Math.cos(a) * R * 0.98, cy / 2, Math.sin(a) * R * 0.98); g.add(l); }
      return (dt, t, it) => { const lv = clamp(it.r.level / 100, 0.03, 1); liq.scale.y = lv; liq.position.y = cy - R * 0.96 + R * 0.96 * lv; };
    } },
  silo: { fam: "vessel", name: "Silo", pre: "SL", params: { height: { l: "Height (m)", min: 6, max: 20, step: 0.5, v: 10 }, dia: { l: "Diameter (m)", min: 2, max: 8, step: 0.5, v: 4 }, material: { l: "Material", opts: ["Cement", "Grain", "Plastic pellets"], v: "Cement" } },
    tags: () => [T("level", "Level", "%", 60, { off: 60, noise: 0.1, fault: 95, warn: 88, crit: 93 }), T("wt", "Contents", "t", 1200, { off: 1200, noise: 2, d: 0 })],
    binds: () => [["Contents", "Fill to level", "level"]],
    build(p, g) {
      const H = p.height, R = p.dia / 2, legH = 3, ch = R * 1.1, y0 = legH + ch, col = ({ Cement: 0x9ca3af, Grain: 0xd6a85b, "Plastic pellets": 0xe5e7eb } as Record<string, any>)[p.material];
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(R, 0.25, ch, 32, 1, true), glass(C.white, 0.35)); cone.position.y = legH + ch / 2; g.add(cone);
      const sh = cyl(R, R, H, glass(C.white, 0.22), 40, true); sh.position.y = y0 + H / 2; g.add(sh);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(R * 1.03, R * 0.3, 40), M(C.light)); roof.position.y = y0 + H + R * 0.15; g.add(roof);
      const fm = M(col, { roughness: 0.95, metalness: 0 });
      const fc = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.96, 0.24, ch * 0.98, 32), fm); fc.position.y = legH + ch / 2; g.add(fc);
      const fill = cyl(R * 0.96, R * 0.96, 1, fm, 40); g.add(fill);
      legs4(g, R * 1.4, R * 1.4, y0, M(C.steel), 0.12);
      const out = cyl(0.2, 0.2, 0.8, M(C.grey)); out.position.y = legH - 0.3; g.add(out);
      return (dt, t, it) => { const lv = clamp(it.r.level / 100, 0, 1) * H * 0.98; fill.visible = lv > 0.05; fill.scale.y = Math.max(lv, 0.01); fill.position.y = y0 + lv / 2; };
    } },
  column: { fam: "vessel", name: "Distillation column", pre: "C", params: { height: { l: "Height (m)", min: 8, max: 30, step: 1, v: 16 }, dia: { l: "Diameter (m)", min: 1, max: 3, step: 0.1, v: 1.6 }, trays: { l: "Trays", min: 5, max: 40, step: 1, v: 20 } },
    tags: () => [T("ttop", "Top temp", "°C", 78, { off: AMB, noise: 0.2 }), T("tbot", "Bottom temp", "°C", 142, { off: AMB, noise: 0.3 }), T("dp", "Column ΔP", "mbar", 45, { noise: 0.4, d: 0, warn: 70, crit: 85, fault: 92 })],
    main: () => "dp", binds: () => [["Trays", "Heat colour, bottom", "tbot"], ["Trays", "Heat colour, top", "ttop"], ["Label", "Show value", "dp"]],
    build(p, g) {
      const H = p.height, R = p.dia / 2, sk = 1.5, N = p.trays | 0;
      const skirt = cyl(R, R, sk, M(C.dark), 32); skirt.position.y = sk / 2; g.add(skirt);
      const sh = cyl(R, R, H, glass(C.white, 0.2), 40, true); sh.position.y = sk + H / 2; g.add(sh);
      const top = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 12, 0, 2 * PI, 0, PI / 2), glass(C.white, 0.3)); top.scale.y = 0.5; top.position.y = sk + H; g.add(top);
      const trays: any[] = [];
      for (let i = 0; i < N; i++) { const m = M(0x475569, { emissive: 0x000000 }); const tr = cyl(R * 0.93, R * 0.93, 0.05, m, 32); tr.position.y = sk + 0.6 + (H - 1.2) * i / Math.max(1, N - 1); g.add(tr); trays.push(m); }
      for (let y = sk + 5; y < sk + H; y += 5) { const pl = new THREE.Mesh(new THREE.TorusGeometry(R + 0.35, 0.05, 6, 40), M(C.orange)); pl.rotation.x = PI / 2; pl.position.y = y; g.add(pl); }
      const dr = X(cyl(0.5, 0.5, 2.2, M(C.grey), 24)); dr.position.set(R + 1.6, 3.2, 0); g.add(dr);
      const ds = box(0.3, 2.7, 0.8, M(C.steel)); ds.position.set(R + 1.6, 1.35, 0); g.add(ds);
      g.add(pipe(P(0, sk + H + R * 0.5, 0), P(R + 0.9, sk + H + R * 0.5, 0), 0.1, M(C.grey)));
      g.add(pipe(P(R + 0.9, sk + H + R * 0.5, 0), P(R + 0.9, 3.2, 0), 0.1, M(C.grey)));
      return (dt, t, it) => { trays.forEach((m, i) => { const u = N > 1 ? i / (N - 1) : 0; heatTo(m, it.r.tbot + (it.r.ttop - it.r.tbot) * u, 20, 260, 1); }); };
    } },
  reactor: { fam: "vessel", name: "Reactor", pre: "R", params: { size: { l: "Size", min: 0.8, max: 2.5, step: 0.1, v: 1.4 }, product: { l: "Contents", opts: Object.keys(PRODUCT), v: "Chemical" } },
    tags: () => [T("temp", "Temperature", "°C", 85, { off: AMB, noise: 0.2, warn: 95, crit: 105, fault: 110 }), T("level", "Level", "%", 60, { off: 60, noise: 0.1, warn: 85, crit: 92 }), T("agit", "Agitator", "rpm", 120, { noise: 1, d: 0 }), T("pres", "Pressure", "bar", 2.1, { off: 1, noise: 0.02, d: 2, warn: 3.5, crit: 4 })],
    binds: () => [["Agitator", "Rotate", "agit"], ["Contents", "Fill to level", "level"], ["Contents", "Heat colour", "temp"]],
    build(p, g) {
      const s = p.size, R = 0.9 * s, Hs = 1.6 * s, y0 = 1.2 * s;
      legs4(g, R * 1.5, R * 1.5, y0 + 0.2, M(C.steel), 0.07 * s);
      const sh = cyl(R, R, Hs, glass(C.white, 0.22), 40, true); sh.position.y = y0 + Hs / 2; g.add(sh);
      const bot = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 12, 0, 2 * PI, PI / 2, PI / 2), glass(C.white, 0.25)); bot.scale.y = 0.45; bot.position.y = y0; g.add(bot);
      const topd = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 12, 0, 2 * PI, 0, PI / 2), M(C.light)); topd.scale.y = 0.4; topd.position.y = y0 + Hs; g.add(topd);
      const jk = cyl(R + 0.06, R + 0.06, Hs * 0.55, M(0x475569, { transparent: true, opacity: 0.45, depthWrite: false, side: DS }), 40, true); jk.position.y = y0 + Hs * 0.3; g.add(jk);
      const liqM = M(PRODUCT[p.product], { transparent: true, opacity: 0.75 }); const liq = cyl(R * 0.95, R * 0.95, 1, liqM, 40); g.add(liq);
      const gb = box(0.5 * s, 0.4 * s, 0.5 * s, M(C.grey)); gb.position.y = y0 + Hs + R * 0.4 + 0.2 * s; g.add(gb);
      const mot = cyl(0.22 * s, 0.22 * s, 0.6 * s, M(C.blue)); mot.position.y = y0 + Hs + R * 0.4 + 0.7 * s; g.add(mot);
      const ag = new THREE.Group(); g.add(ag);
      const shaft = cyl(0.04 * s, 0.04 * s, Hs + R * 0.4, M(C.light), 8); shaft.position.y = y0 + (Hs + R * 0.4) / 2; ag.add(shaft);
      [y0 + 0.15 * s, y0 + Hs * 0.45].forEach(y => { for (let i = 0; i < 4; i++) { const b = box(0.55 * s, 0.05 * s, 0.14 * s, M(C.yellow)); b.position.set(Math.cos(i * PI / 2) * 0.3 * s, y, Math.sin(i * PI / 2) * 0.3 * s); b.rotation.y = -i * PI / 2; ag.add(b); } });
      return (dt, t, it) => { ag.rotation.y += dt * spinVis(it.r.agit); const lv = clamp(it.r.level / 100, 0.03, 1) * Hs; liq.scale.y = lv; liq.position.y = y0 + lv / 2; heatTo(liqM, it.r.temp, 60, 150, 0.8); };
    } },

  zoned: { fam: "thermal", name: "Furnace / lehr / oven / dryer", pre: "F", params: { kind: { l: "Type", opts: ["Furnace", "Reheat furnace", "Annealing lehr", "Oven", "Dryer", "Cooler"], v: "Annealing lehr" }, length: { l: "Length (m)", min: 4, max: 20, step: 0.5, v: 10 }, zones: { l: "Zones", min: 2, max: 10, step: 1, v: 5 }, width: { l: "Width (m)", min: 1, max: 4, step: 0.1, v: 1.6 } },
    tags: p => [...zoneTags(zoneProfile(p.kind, p.zones | 0), "z", "Zone", Math.floor((p.zones | 0) / 2)), T("belt", "Belt speed", "m/min", 4.5, { noise: 0.05 })],
    main: p => { const t = zoneProfile(p.kind, p.zones | 0); return "z" + (t.indexOf(Math.max(...t)) + 1); },
    binds: () => [["Zone housings", "Heat colour per zone", "z*"], ["Products", "Move along belt", "belt"], ["Products", "Glow by zone", "z*"]],
    build(p, g) {
      const L = p.length, N = p.zones | 0, W = p.width, zl = L / N, span = L + 2.4;
      const fr = box(span, 0.6, W + 0.3, M(C.steel)); fr.position.y = 0.3; g.add(fr);
      const belt = box(span, 0.06, W * 0.85, M(C.belt)); belt.position.y = 0.63; g.add(belt);
      const zm: any[] = [];
      for (let i = 0; i < N; i++) { const m = M(0x475569, { transparent: true, opacity: 0.55, depthWrite: false }); const z = box(zl - 0.06, 1.1, W, m); z.position.set(-L / 2 + (i + 0.5) * zl, 1.21, 0); g.add(z); zm.push(m); const st = cyl(0.1, 0.1, 0.6, M(C.grey), 10); st.position.set(z.position.x, 2.05, 0); g.add(st); }
      const shape = ({ Furnace: "slab", "Reheat furnace": "slab", "Annealing lehr": "bottle", Oven: "tray", Dryer: "tray", Cooler: "rock" } as Record<string, any>)[p.kind];
      const yo = ({ bottle: 0.16, slab: 0.09, tray: 0.04, rock: 0.12 } as Record<string, any>)[shape];
      const n = Math.max(4, Math.round(span / 0.7)), items: any[] = [];
      for (let i = 0; i < n; i++) {
        const m = M(shape === "bottle" ? 0x86efac : 0x9ca3af, { transparent: shape === "bottle", opacity: 0.85 });
        const o = shape === "bottle" ? cyl(0.09, 0.09, 0.32, m, 12) : shape === "slab" ? box(0.5, 0.18, W * 0.6, m) : shape === "tray" ? box(0.5, 0.08, W * 0.6, m) : new THREE.Mesh(new THREE.DodecahedronGeometry(0.16), m);
        o.userData.u = i / n; o.userData.z = shape === "bottle" || shape === "rock" ? (i % 2 ? 0.2 : -0.2) * W : 0; g.add(o); items.push(o);
      }
      return (dt, t, it) => {
        zm.forEach((m, i) => heatTo(m, it.r["z" + (i + 1)], 20, 1200, 1));
        items.forEach(o => { o.userData.u = (o.userData.u + dt * it.r.belt / 60 * 2 / span) % 1; const x = -span / 2 + o.userData.u * span; o.position.set(x, 0.66 + yo, o.userData.z); const zi = Math.floor((x + L / 2) / zl); heatTo(o.material, zi >= 0 && zi < N ? it.r["z" + (zi + 1)] : AMB, 20, 1200, 0.9); });
      };
    } },
  kiln: { fam: "thermal", name: "Rotary kiln", pre: "KL", params: { length: { l: "Length (m)", min: 8, max: 24, step: 1, v: 16 }, dia: { l: "Diameter (m)", min: 1.5, max: 4.5, step: 0.1, v: 3 } },
    tags: () => [T("speed", "Kiln speed", "rpm", 3.8, { noise: 0.02 }), T("bz", "Burning zone", "°C", 1450, { off: AMB, noise: 4, d: 0 }), T("shell", "Shell temp max", "°C", 310, { off: AMB, noise: 1.2, d: 0, warn: 350, crit: 400, fault: 420 })],
    main: () => "shell", binds: () => [["Shell", "Rotate", "speed"], ["Shell segments", "Heat colour", "shell"], ["Burner glow", "Flicker", "bz"]],
    build(p, g) {
      const L = p.length, R = p.dia / 2, cy = R + 1.3;
      const tilt = new THREE.Group(); tilt.position.y = cy; tilt.rotation.z = -0.03; g.add(tilt);
      const shell = new THREE.Group(); tilt.add(shell);
      const segs: any[] = [];
      for (let j = 0; j < 6; j++) { const m = M(0x4b5563); const sg = X(cyl(R, R, L / 6 - 0.02, m, 32)); sg.position.x = -L / 2 + (j + 0.5) * L / 6; shell.add(sg); segs.push(m); }
      for (let k = 0; k < 4; k++) { const a = k * PI / 2, bar = box(L * 0.98, 0.06, 0.14, M(C.yellow)); bar.position.set(0, Math.cos(a) * (R + 0.02), Math.sin(a) * (R + 0.02)); bar.rotation.x = a; shell.add(bar); }
      [-0.35, 0, 0.35].forEach(f => { const ty = X(cyl(R + 0.16, R + 0.16, 0.45, M(0x6b7280), 32)); ty.position.x = f * L; shell.add(ty); const pier = box(1.2, cy - R, R * 2.2, M(0x52525b)); pier.position.set(f * L, (cy - R) / 2 - 0.15, 0); g.add(pier); });
      const gear = X(cyl(R + 0.28, R + 0.28, 0.22, M(C.yellow), 40)); gear.position.x = L * 0.17; shell.add(gear);
      const hood = box(1.6, p.dia + 1.2, p.dia + 1.2, M(0x7c2d12)); hood.position.set(L / 2 + 0.8, cy, 0); g.add(hood);
      const glowM = new THREE.MeshBasicMaterial({ color: 0xffa53a }); const glow = new THREE.Mesh(new THREE.CircleGeometry(0.35, 24), glowM); glow.position.set(L / 2 + 0.8, cy, (p.dia + 1.2) / 2 + 0.01); g.add(glow);
      const burner = X(cyl(0.15, 0.15, 1.6, M(C.light), 10)); burner.position.set(L / 2 + 2.2, cy, 0); g.add(burner);
      const feed = box(1.2, p.dia + 0.8, p.dia + 0.8, M(0x52525b)); feed.position.set(-L / 2 - 0.6, cy + 0.3, 0); g.add(feed);
      const light = new THREE.PointLight(0xff7a1a, 1.2, 10); light.position.set(L / 2 + 0.8, cy, (p.dia + 1.2) / 2 + 1); g.add(light);
      return (dt, t, it) => {
        shell.rotation.x += dt * it.r.speed / 60 * 2 * PI;
        segs.forEach((m, j) => heatTo(m, 170 + (it.r.shell - 170) * Math.exp(-(((j - 4.3) / 1.3) ** 2)), 150, 480, 1));
        light.intensity = it.running ? 1 + Math.random() * 0.6 : 0; glowM.color.setHSL(0.07, 1, it.running ? 0.45 + Math.random() * 0.1 : 0.08);
      };
    } },
  preheater: { fam: "thermal", name: "Preheater tower", pre: "PH", params: { stages: { l: "Cyclone stages", min: 2, max: 6, step: 1, v: 4 } },
    tags: p => { const N = p.stages | 0; return zoneTags(Array.from({ length: N }, (_, i) => 340 + 540 * i / Math.max(1, N - 1)), "s", "Stage", N - 1); },
    main: p => "s" + (p.stages | 0), binds: () => [["Cyclones", "Heat colour per stage", "s*"]],
    build(p, g) {
      const N = p.stages | 0, hgt = N * 2.6 + 1.5;
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => { const c = box(0.15, hgt, 0.15, M(C.steel)); c.position.set(a * 1.7, hgt / 2, b * 1.7); g.add(c); });
      const mats: any[] = []; let prev: { x: number; y: number } | null = null;
      for (let i = 0; i < N; i++) {
        const y = hgt - 1.6 - i * 2.6, x = i % 2 ? -0.7 : 0.7, m = M(0x64748b);
        const c = cyl(0.85, 0.85, 1.1, m, 24); c.position.set(x, y, 0); g.add(c);
        const cn = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.2, 1.3, 24), m); cn.position.set(x, y - 1.2, 0); g.add(cn);
        [-1, 1].forEach(sd => { const bm = box(3.5, 0.1, 0.1, M(C.steel)); bm.position.set(0, y - 0.6, sd * 1.7); g.add(bm); });
        if (prev) g.add(pipe(P(x, y + 0.55, 0), P(prev.x, prev.y - 0.2, 0.6), 0.22, M(C.grey)));
        mats.push(m); prev = { x, y };
      }
      if (prev) g.add(pipe(P(prev.x, prev.y - 1.85, 0), P(prev.x, 0.4, 0), 0.25, M(C.grey)));
      return (dt, t, it) => mats.forEach((m, i) => heatTo(m, it.r["s" + (i + 1)], 200, 1100, 1));
    } },
  boiler: { fam: "thermal", name: "Boiler", pre: "B", params: { size: { l: "Size", min: 0.7, max: 1.6, step: 0.1, v: 1 } },
    tags: () => [T("steam", "Steam pressure", "bar", 10.5, { noise: 0.05, warn: 12, crit: 13, fault: 13.4 }), T("level", "Drum level", "%", 50, { off: 50, noise: 0.3, d: 0, warn: 70, crit: 80, fault: 82 }), T("flue", "Flue gas temp", "°C", 190, { off: AMB, noise: 0.6, d: 0, warn: 240, crit: 270 })],
    binds: () => [["Burner window", "Flame flicker", "steam"], ["Stack", "Smoke", "flue"], ["Label", "Show value", "steam"]],
    build(p, g) {
      const s = p.size;
      const body = box(3.4 * s, 2.4 * s, 2 * s, M(0xa8b3c1, { metalness: 0.7, roughness: 0.35 })); body.position.y = 1.2 * s; g.add(body);
      const drum = X(cyl(0.45 * s, 0.45 * s, 3 * s, M(C.grey), 24)); drum.position.y = 2.85 * s; g.add(drum);
      const front = box(0.3 * s, 1.6 * s, 1.6 * s, M(0x334155)); front.position.set(-1.85 * s, 1.1 * s, 0); g.add(front);
      const flameM = new THREE.MeshBasicMaterial({ color: 0xff8a1a }); const win = new THREE.Mesh(new THREE.CircleGeometry(0.35 * s, 24), flameM); win.rotation.y = -PI / 2; win.position.set(-2.01 * s, 1.1 * s, 0); g.add(win);
      const stack = cyl(0.28 * s, 0.34 * s, 4.5 * s, M(0x64748b), 20); stack.position.set(1.3 * s, 4.65 * s, 0); g.add(stack);
      const sm = smoke(g, 1.3 * s, 6.9 * s + 0.2, 0, 12, 0x9ca3af, 0.25 * s);
      return (dt, t, it) => { flameM.color.setHSL(0.07, 1, it.running ? 0.45 + Math.random() * 0.12 : 0.08); sm(dt, it.running, 1 + it.r.flue / 400, 3 * s); };
    } },
  hx: { fam: "thermal", name: "Heat exchanger", pre: "E", params: { length: { l: "Length (m)", min: 2, max: 8, step: 0.5, v: 4 }, dia: { l: "Diameter (m)", min: 0.6, max: 1.6, step: 0.1, v: 1 } },
    tags: () => [T("tin", "Hot side in", "°C", 85, { off: AMB, noise: 0.3, warn: 95, crit: 105, fault: 108 }), T("tout", "Hot side out", "°C", 42, { off: AMB, noise: 0.2, warn: 50, crit: 55, fault: 57 })],
    binds: () => [["Inlet half", "Heat colour", "tin"], ["Outlet half", "Heat colour", "tout"]],
    build(p, g) {
      const L = p.length, R = p.dia / 2, cy = R + 0.5, a = M(0x6b7b90), b = M(0x6b7b90);
      const h1 = X(cyl(R, R, L / 2, a, 28)); h1.position.set(-L / 4, cy, 0); g.add(h1);
      const h2 = X(cyl(R, R, L / 2, b, 28)); h2.position.set(L / 4, cy, 0); g.add(h2);
      [-1, 1].forEach(sd => { const ch = X(cyl(R * 1.08, R * 1.08, 0.4, M(C.blue), 28)); ch.position.set(sd * (L / 2 + 0.2), cy, 0); g.add(ch); const sa = box(0.3, cy - R * 0.5, R * 1.6, M(C.steel)); sa.position.set(sd * L * 0.3, (cy - R * 0.5) / 2, 0); g.add(sa); const nz = cyl(0.1, 0.1, 0.5, M(C.grey), 10); nz.position.set(sd * L * 0.35, cy + R + 0.2, 0); g.add(nz); });
      return (dt, t, it) => { heatTo(a, it.r.tin, 20, 250, 1); heatTo(b, it.r.tout, 20, 250, 1); };
    } },

  conveyor: { fam: "linear", name: "Conveyor", pre: "BC", params: { length: { l: "Length (m)", min: 2, max: 16, step: 0.5, v: 8 }, width: { l: "Belt width (m)", min: 0.6, max: 1.6, step: 0.1, v: 0.9 }, item: { l: "Carries", opts: ["Box", "Bag", "Roll", "Bottle", "Bulk"], v: "Box" } },
    tags: () => [T("belt", "Belt speed", "m/min", 30, { noise: 0.3, fault: 14, low: true, warn: 22, crit: 16 }), T("rate", "Throughput", "units/min", 42, { noise: 0.6, d: 0 }), T("amps", "Motor current", "A", 12, { noise: 0.15, warn: 16, crit: 18, fault: 19 })],
    main: () => "rate", binds: () => [["Items", "Move along belt", "belt"], ["End drums", "Rotate", "belt"], ["Label", "Show value", "rate"]],
    build(p, g) {
      const L = p.length, W = p.width, y = 0.85;
      const belt = box(L, 0.08, W, M(C.belt)); belt.position.y = y; g.add(belt);
      [-1, 1].forEach(sd => { const r = box(L, 0.18, 0.05, M(C.steel)); r.position.set(0, y + 0.02, sd * (W / 2 + 0.03)); g.add(r); });
      for (let x = -L / 2 + 0.4; x <= L / 2 - 0.3; x += 1.6) { const l = box(0.08, y, W, M(C.steel)); l.position.set(x, y / 2, 0); g.add(l); }
      const drums: any[] = [];
      [-1, 1].forEach(sd => { const d = new THREE.Group(); d.position.set(sd * L / 2, y - 0.05, 0); const c = cyl(0.16, 0.16, W + 0.1, M(C.light), 16); c.rotation.x = PI / 2; d.add(c); d.add(box(0.34, 0.04, W + 0.12, M(C.orange))); g.add(d); drums.push(d); });
      const mot = cyl(0.18, 0.18, 0.4, M(C.blue), 16); mot.rotation.x = PI / 2; mot.position.set(L / 2, y - 0.05, W / 2 + 0.3); g.add(mot);
      const bulkG = new THREE.DodecahedronGeometry(0.09), bulkM = M(0x78716c, { metalness: 0, roughness: 1 });
      const mk = () => { switch (p.item) {
        case "Box": return box(0.45, 0.35, 0.45, M(0xb08a5a, { metalness: 0, roughness: 0.9 }));
        case "Bag": return box(0.55, 0.18, Math.min(0.35, W * 0.6), M(0xe7e5e4, { metalness: 0, roughness: 0.9 }));
        case "Roll": { const r = cyl(0.2, 0.2, W * 0.8, M(0x7c3aed, { metalness: 0, roughness: 0.8 }), 16); r.rotation.x = PI / 2; return r; }
        case "Bottle": return cyl(0.08, 0.08, 0.3, M(0x86efac, { transparent: true, opacity: 0.8 }), 12);
        default: return new THREE.Mesh(bulkG, bulkM); } };
      const yo = ({ Box: 0.215, Bag: 0.13, Roll: 0.24, Bottle: 0.19, Bulk: 0.12 } as Record<string, any>)[p.item];
      const n = p.item === "Bulk" ? Math.round(L * 6) : Math.max(3, Math.round(L / 1.1)), items: any[] = [];
      for (let i = 0; i < n; i++) { const o = mk(); o.userData.u = i / n; o.userData.z = p.item === "Bulk" ? rnd(W * 0.6) : p.item === "Bottle" ? (i % 2 ? 0.15 : -0.15) * W : 0; g.add(o); items.push(o); }
      return (dt, t, it) => { const v = it.r.belt / 60; items.forEach(o => { o.userData.u = (o.userData.u + dt * v * 1.4 / L) % 1; o.position.set(-L / 2 + o.userData.u * L, y + 0.04 + yo, o.userData.z); }); drums.forEach(d => d.rotation.z -= dt * v * 1.4 / 0.16); };
    } },
  extruder: { fam: "linear", name: "Extruder", pre: "EX", params: { zones: { l: "Barrel zones", min: 3, max: 8, step: 1, v: 5 }, length: { l: "Barrel length (m)", min: 3, max: 8, step: 0.5, v: 5 } },
    tags: p => { const N = p.zones | 0; return [...zoneTags(Array.from({ length: N }, (_, i) => 180 + 55 * i / Math.max(1, N - 1)), "z", "Barrel zone", -1), T("speed", "Screw speed", "rpm", 65, { noise: 0.4, d: 0 }), T("melt", "Melt pressure", "bar", 180, { noise: 1.5, d: 0, warn: 250, crit: 300, fault: 315 }), T("load", "Drive load", "%", 68, { noise: 0.5, d: 0, warn: 90, crit: 100 })]; },
    main: () => "melt", binds: () => [["Screw", "Rotate", "speed"], ["Barrel zones", "Heat colour per zone", "z*"], ["Extrudate", "Move out of die", "speed"]],
    build(p, g) {
      const N = p.zones | 0, L = p.length, zl = L / N, cy = 1.25;
      const base = box(L + 3.2, 0.8, 1.2, M(C.steel)); base.position.set(-0.4, 0.4, 0); g.add(base);
      const gb = box(0.9, 0.9, 1, M(C.grey)); gb.position.set(-L / 2 - 0.6, cy, 0); g.add(gb);
      const mot = X(cyl(0.38, 0.38, 1, M(C.blue), 24)); mot.position.set(-L / 2 - 1.6, cy, 0); g.add(mot);
      const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.12, 0.8, 4, 1, true), M(C.light, { side: DS })); hop.rotation.y = PI / 4; hop.position.set(-L / 2 + 0.35, cy + 0.85, 0); g.add(hop);
      const zm: any[] = [];
      for (let i = 0; i < N; i++) { const m = M(0x64748b, { transparent: true, opacity: 0.45, depthWrite: false }); const z = X(cyl(0.24, 0.24, zl - 0.05, m, 24)); z.position.set(-L / 2 + (i + 0.5) * zl, cy, 0); g.add(z); const bm = M(0x334155); const band = X(cyl(0.27, 0.27, zl * 0.35, bm, 24)); band.position.copy(z.position); g.add(band); zm.push({ m, bm }); }
      const turns = L * 2.2, pts: any[] = [];
      for (let k = 0; k <= turns * 14; k++) { const u = k / (turns * 14), a = u * turns * 2 * PI; pts.push(P(-L / 2 + u * L, Math.cos(a) * 0.13, Math.sin(a) * 0.13)); }
      const screw = new THREE.Group(); screw.position.y = cy; g.add(screw);
      screw.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.round(turns * 28), 0.035, 6, false), M(0xd1d5db, { metalness: 0.9, roughness: 0.2 })));
      screw.add(X(cyl(0.07, 0.07, L, M(0xd1d5db), 12)));
      const die = X(cyl(0.12, 0.26, 0.35, M(C.grey), 20)); die.position.set(L / 2 + 0.17, cy, 0); g.add(die);
      const bath = box(2.6, 0.4, 0.6, glass(0x38bdf8, 0.35)); bath.position.set(L / 2 + 1.8, cy - 0.1, 0); g.add(bath);
      const pcs: any[] = [];
      for (let i = 0; i < 8; i++) { const o = X(cyl(0.06, 0.06, 0.34, M(0x0ea5e9), 10)); o.userData.u = i / 8; g.add(o); pcs.push(o); }
      return (dt, t, it) => {
        zm.forEach((z, i) => { heatTo(z.m, it.r["z" + (i + 1)], 20, 320, 0.9); heatTo(z.bm, it.r["z" + (i + 1)], 20, 320, 1.1); });
        screw.rotation.x += dt * spinVis(it.r.speed);
        pcs.forEach(o => { o.userData.u = (o.userData.u + dt * it.r.speed / 65 * 0.35) % 1; o.position.set(L / 2 + 0.4 + o.userData.u * 2.9, cy, 0); heatTo(o.material, 230 - 200 * o.userData.u, 20, 320, 0.9); });
      };
    } },
  bucket: { fam: "linear", name: "Bucket elevator", pre: "BE", params: { height: { l: "Height (m)", min: 6, max: 30, step: 1, v: 12 } },
    tags: () => [T("speed", "Head pulley", "rpm", 38, { noise: 0.3, d: 0 }), T("amps", "Motor current", "A", 22, { noise: 0.3, warn: 28, crit: 32, fault: 33 }), T("slip", "Belt slip", "%", 0.5, { noise: 0.05, warn: 3, crit: 5, fault: 6 })],
    main: () => "amps", binds: () => [["Buckets", "Move in loop", "speed"], ["Label", "Show value", "amps"]],
    build(p, g) {
      const H = p.height, r = 0.42, y0 = 1.2, y1 = H - 0.6, st = y1 - y0, loop = 2 * st + 2 * PI * r;
      [-1, 1].forEach(sd => { const leg = box(0.5, st, 0.5, glass(C.white, 0.25)); leg.position.set(sd * r, (y0 + y1) / 2, 0); g.add(leg); });
      const head = box(1.4, 1.1, 0.8, M(C.yellow)); head.position.set(0, y1 + 0.3, 0); g.add(head);
      const boot = box(1.4, 1.2, 0.8, M(C.yellow)); boot.position.set(0, 0.6, 0); g.add(boot);
      const nb = Math.round(loop / 0.7), bk: any[] = [];
      for (let i = 0; i < nb; i++) { const b = box(0.3, 0.14, 0.32, M(C.orange)); b.userData.u = i / nb; g.add(b); bk.push(b); }
      const at = (u: number, o: THREE.Object3D) => { let d = u * loop; if (d < st) { o.position.set(r, y0 + d, 0); return; } d -= st; if (d < PI * r) { const a = d / r; o.position.set(r * Math.cos(a), y1 + r * Math.sin(a), 0); return; } d -= PI * r; if (d < st) { o.position.set(-r, y1 - d, 0); return; } d -= st; const a = d / r; o.position.set(-r * Math.cos(a), y0 - r * Math.sin(a), 0); };
      return (dt, t, it) => { const v = it.r.speed / 60 * 2 * PI * 0.25; bk.forEach(b => { b.userData.u = (b.userData.u + dt * v / loop) % 1; at(b.userData.u, b); }); };
    } },
  stenter: { fam: "textile", name: "Stenter", pre: "ST", params: { length: { l: "Length (m)", min: 8, max: 30, step: 1, v: 16 }, chambers: { l: "Heat chambers", min: 3, max: 10, step: 1, v: 6 } },
    tags: p => { const N = p.chambers | 0; return [...zoneTags(Array.from({ length: N }, (_, i) => 150 + 40 * Math.sin(PI * (N > 1 ? i / (N - 1) : 0))), "c", "Chamber", Math.floor(N / 2)), T("speed", "Fabric speed", "m/min", 45, { noise: 0.3, d: 0 }), T("width", "Fabric width", "cm", 182, { off: 182, noise: 0.3, d: 0 })]; },
    main: () => "speed", binds: () => [["Fabric", "Move", "speed"], ["Chambers", "Heat colour per chamber", "c*"], ["Entry roller", "Rotate", "speed"]],
    build(p, g) {
      const L = p.length, N = p.chambers | 0, cl = L / N, FW = 1.9;
      const fr = box(L + 4, 0.5, 2.6, M(C.steel)); fr.position.y = 0.25; g.add(fr);
      const cv = document.createElement("canvas"); cv.width = 64; cv.height = 8; const cx = cv.getContext("2d")!; cx.fillStyle = "#3b4f8f"; cx.fillRect(0, 0, 64, 8); cx.fillStyle = "#c7d2fe"; cx.fillRect(0, 0, 10, 8); cx.fillRect(30, 0, 4, 8);
      const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set((L + 4) / 1.2, 1);
      const fab = new THREE.Mesh(new THREE.PlaneGeometry(L + 4, FW), new THREE.MeshStandardMaterial({ map: tex, side: DS, roughness: 0.9 })); fab.rotation.x = -PI / 2; fab.position.y = 0.95; g.add(fab);
      [-1, 1].forEach(sd => { const rail = box(L + 4, 0.08, 0.08, M(C.light)); rail.position.set(0, 0.97, sd * (FW / 2 + 0.04)); g.add(rail); });
      const cm: any[] = [];
      for (let i = 0; i < N; i++) { const m = M(0x334155, { transparent: true, opacity: 0.7, depthWrite: false }); const c = box(cl - 0.08, 1.3, 2.5, m); c.position.set(-L / 2 + (i + 0.5) * cl, 1.7, 0); g.add(c); cm.push(m); const ex = cyl(0.15, 0.15, 0.7, M(C.grey), 10); ex.position.set(c.position.x, 2.7, 0); g.add(ex); }
      const rl = new THREE.Group(); rl.position.set(-L / 2 - 1.6, 1.15, 0); g.add(rl); const rc = cyl(0.16, 0.16, 2.3, M(C.light), 16); rc.rotation.x = PI / 2; rl.add(rc); rl.add(box(0.34, 0.04, 2.32, M(C.orange)));
      return (dt, t, it) => { tex.offset.x -= dt * it.r.speed / 60 * 1.5 / 1.2; cm.forEach((m, i) => heatTo(m, it.r["c" + (i + 1)], 20, 400, 1)); rl.rotation.z -= dt * it.r.speed / 60 * 1.5 / 0.16; };
    } },
  loom: { fam: "textile", name: "Loom", pre: "LM", params: { width: { l: "Reed width (m)", min: 1.5, max: 4, step: 0.1, v: 2.4 } },
    tags: () => [T("ppm", "Speed", "picks/min", 600, { noise: 3, d: 0 }), T("eff", "Efficiency", "%", 92, { off: 92, noise: 0.2, d: 0, low: true, warn: 85, crit: 78, fault: 74 }), T("stops", "Warp stops", "/h", 1.2, { off: 0, noise: 0.05, warn: 4, crit: 6, fault: 7 })],
    binds: () => [["Sley / reed", "Beat at pick rate", "ppm"], ["Weft insertion", "Cross the width", "ppm"], ["Beams", "Rotate", "ppm"]],
    build(p, g) {
      const W = p.width, gr = M(0x4b5563);
      [-1, 1].forEach(sd => { const f = box(2.4, 1.3, 0.12, gr); f.position.set(0, 0.65, sd * (W / 2 + 0.1)); g.add(f); });
      const topb = box(0.15, 0.15, W + 0.3, gr); topb.position.set(-0.2, 1.35, 0); g.add(topb);
      const beamRoll = (x: number, r: number, col: number) => { const b = new THREE.Group(); b.position.set(x, 0.55, 0); const c = cyl(r, r, W, M(col, { roughness: 0.9, metalness: 0 }), 24); c.rotation.x = PI / 2; b.add(c); b.add(box(r * 2 + 0.02, 0.03, W + 0.02, M(C.orange))); g.add(b); return b; };
      const wb = beamRoll(-1, 0.28, 0xe5e7eb), cb = beamRoll(1.05, 0.18, 0x93c5fd);
      const warp = new THREE.Mesh(new THREE.PlaneGeometry(1.25, W), new THREE.MeshStandardMaterial({ color: 0xf1f5f9, transparent: true, opacity: 0.45, side: DS })); warp.rotation.x = -PI / 2; warp.rotation.y = -0.12; warp.position.set(-0.4, 0.93, 0); g.add(warp);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, W), new THREE.MeshStandardMaterial({ color: 0x93c5fd, side: DS })); cloth.rotation.x = -PI / 2; cloth.position.set(0.65, 0.99, 0); g.add(cloth);
      const sley = new THREE.Group(); g.add(sley); sley.add(box(0.06, 0.4, W, M(C.light)));
      const rap = box(0.12, 0.05, 0.12, M(C.orange)); g.add(rap);
      let ph = 0;
      return (dt, t, it) => { ph += dt * it.r.ppm / 60 * 2 * PI * 0.15; sley.position.set(0.2 + 0.08 * Math.sin(ph), 1.1, 0); rap.position.set(0.12, 1.0, W / 2 * Math.sin(ph * 0.5)); rap.visible = it.running; wb.rotation.z -= dt * it.r.ppm / 600 * 0.15; cb.rotation.z -= dt * it.r.ppm / 600 * 0.25; };
    } },
  packer: { fam: "linear", name: "Rotary packer", pre: "PK", params: { spouts: { l: "Spouts", min: 4, max: 16, step: 1, v: 8 } },
    tags: () => [T("bags", "Output", "bags/h", 2400, { noise: 15, d: 0 }), T("dev", "Weight deviation", "%", 0.3, { noise: 0.03, d: 2, warn: 1, crit: 1.5, fault: 1.8 })],
    binds: () => [["Rotor", "Rotate", "bags"], ["Bags", "Move on belt", "bags"]],
    build(p, g) {
      const N = p.spouts | 0;
      const ped = cyl(0.9, 1.1, 1.2, M(C.steel), 24); ped.position.y = 0.6; g.add(ped);
      const rot = new THREE.Group(); rot.position.y = 1.7; g.add(rot); rot.add(cyl(1.2, 1.2, 1, M(C.grey), 32));
      for (let i = 0; i < N; i++) { const piv = new THREE.Group(); piv.rotation.y = i / N * 2 * PI; const sp = cyl(0.07, 0.07, 0.6, M(C.light), 8); sp.rotation.z = PI / 2; sp.position.set(1.45, -0.2, 0); piv.add(sp); rot.add(piv); }
      const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.3, 0.9, 24, 1, true), M(C.light, { side: DS })); hop.position.y = 2.7; g.add(hop);
      const belt = box(4, 0.08, 0.7, M(C.belt)); belt.position.set(3.3, 0.6, 0); g.add(belt);
      [1.6, 5].forEach(x => { const l = box(0.08, 0.56, 0.6, M(C.steel)); l.position.set(x, 0.28, 0); g.add(l); });
      const bags: any[] = [];
      for (let i = 0; i < 5; i++) { const b = box(0.55, 0.2, 0.35, M(0xe7e5e4, { metalness: 0, roughness: 0.9 })); b.userData.u = i / 5; g.add(b); bags.push(b); }
      return (dt, t, it) => { rot.rotation.y += dt * it.r.bags / 2400 * 0.8; bags.forEach(b => { b.userData.u = (b.userData.u + dt * it.r.bags / 2400 * 0.25) % 1; b.position.set(1.4 + b.userData.u * 3.8, 0.74, 0); }); };
    } },

  genset: { fam: "electrical", name: "Generator set", pre: "DG", params: { rating: { l: "Rating", opts: ["500 kVA", "1000 kVA", "2000 kVA"], v: "1000 kVA" } },
    tags: p => { const kw = ({ "500 kVA": 300, "1000 kVA": 620, "2000 kVA": 1250 } as Record<string, any>)[p.rating]; return [T("kw", "Output", "kW", kw, { noise: kw * 0.01, d: 0 }), T("load", "Load", "%", 62, { noise: 0.5, d: 0, warn: 90, crit: 100, fault: 104 }), T("cool", "Coolant temp", "°C", 82, { off: AMB, noise: 0.2, warn: 95, crit: 102, fault: 106 }), T("fuel", "Fuel", "%", 74, { off: 74, noise: 0.02, d: 0, low: true, warn: 25, crit: 15 })]; },
    binds: () => [["Radiator fan", "Rotate when running", "load"], ["Exhaust", "Smoke with load", "load"], ["Status lamp", "Colour", "load"]],
    build(p, g) {
      const s = ({ "500 kVA": 0.8, "1000 kVA": 1, "2000 kVA": 1.25 } as Record<string, any>)[p.rating];
      const base = box(4.8 * s, 0.15, 2 * s, M(C.dark)); base.position.y = 0.075; g.add(base);
      const enc = box(4.6 * s, 2.2 * s, 1.8 * s, M(0xca8a04, { metalness: 0.35, roughness: 0.5 })); enc.position.y = 1.1 * s + 0.15; g.add(enc);
      const rot = fanRotor(6, 0.6 * s, 0.18 * s, 0x334155); const h = holder("x", rot); h.position.set(2.42 * s, 1.15 * s + 0.15, 0); g.add(h);
      const grille = box(0.04, 1.7 * s, 1.5 * s, glass(0x111827, 0.45)); grille.position.set(2.52 * s, 1.15 * s + 0.15, 0); g.add(grille);
      const sil = X(cyl(0.28 * s, 0.28 * s, 1.4 * s, M(0x9ca3af), 16)); sil.position.set(-0.8 * s, 2.6 * s + 0.15, 0); g.add(sil);
      const stk = cyl(0.12 * s, 0.12 * s, 0.9 * s, M(0x9ca3af), 10); stk.position.set(-0.15 * s, 2.9 * s + 0.15, 0); g.add(stk);
      const sm = smoke(g, -0.15 * s, 3.4 * s + 0.15, 0, 12, 0x6b7280, 0.2 * s);
      const lm = lamp(0x22c55e); const lp = new THREE.Mesh(new THREE.SphereGeometry(0.07 * s, 12, 12), lm); lp.position.set(-1.6 * s, 1.5 * s, 0.92 * s); g.add(lp);
      return (dt, t, it) => { rot.rotation.y += dt * (it.running ? 10 : 0); sm(dt, it.running, 0.6 + it.r.load / 80, 2.5 * s); const c = SCOL[it.status]; lm.color.setHex(c); lm.emissive.setHex(c); };
    } },
  transformer: { fam: "electrical", name: "Transformer", pre: "TR", params: { rating: { l: "Rating", opts: ["1 MVA", "2.5 MVA", "5 MVA"], v: "2.5 MVA" } },
    tags: () => [T("load", "Load", "%", 64, { noise: 0.4, d: 0, warn: 90, crit: 100, fault: 108 }), T("oil", "Oil temp", "°C", 62, { off: AMB, noise: 0.1, warn: 85, crit: 95, fault: 98 }), T("wdg", "Winding temp", "°C", 75, { off: AMB, noise: 0.15, warn: 100, crit: 110, fault: 115 })],
    main: () => "load", binds: () => [["Radiator fins", "Heat colour", "oil"], ["Tank", "Heat colour", "wdg"], ["Label", "Show value", "load"]],
    build(p, g) {
      const s = ({ "1 MVA": 0.8, "2.5 MVA": 1, "5 MVA": 1.25 } as Record<string, any>)[p.rating];
      const pl = box(2.6 * s, 0.3, 2.4 * s, M(0x52525b)); pl.position.y = 0.15; g.add(pl);
      const tankM = M(0x6b7280); const tank = box(2 * s, 2.2 * s, 1.3 * s, tankM); tank.position.y = 0.3 + 1.1 * s; g.add(tank);
      const finM = M(0x7b8794);
      [-1, 1].forEach(sd => { for (let k = 0; k < 8; k++) { const f = box(0.05, 1.8 * s, 0.5 * s, finM); f.position.set(-0.85 * s + k * 0.24 * s, 0.3 + 1.05 * s, sd * 0.92 * s); g.add(f); } });
      const con = X(cyl(0.3 * s, 0.3 * s, 1.6 * s, M(C.grey), 20)); con.position.set(-0.2 * s, 0.3 + 2.75 * s, -0.3 * s); g.add(con);
      const br = box(0.1, 0.5 * s, 0.1, M(C.steel)); br.position.set(-0.2 * s, 0.3 + 2.35 * s, -0.3 * s); g.add(br);
      for (let k = -1; k <= 1; k++) { const b = cyl(0.07 * s, 0.12 * s, 0.9 * s, M(0x92400e), 12); b.position.set(k * 0.6 * s, 0.3 + 2.65 * s, 0.3 * s); g.add(b); for (let j = 0; j < 3; j++) { const d = new THREE.Mesh(new THREE.TorusGeometry(0.13 * s, 0.03 * s, 6, 16), M(0x92400e)); d.rotation.x = PI / 2; d.position.set(k * 0.6 * s, 0.3 + 2.35 * s + j * 0.22 * s, 0.3 * s); g.add(d); } }
      return (dt, t, it) => { heatTo(finM, it.r.oil, 30, 130, 0.8); heatTo(tankM, it.r.wdg, 40, 160, 0.5); };
    } },
  panel: { fam: "electrical", name: "Panels / racks", pre: "PNL", params: { kind: { l: "Type", opts: ["Switchgear", "MCC", "Server racks"], v: "Switchgear" }, cabinets: { l: "Cabinets", min: 2, max: 12, step: 1, v: 6 } },
    tags: () => [T("kw", "Load", "kW", 820, { noise: 5, d: 0 }), T("pf", "Power factor", "", 0.95, { off: 0.95, noise: 0.003, d: 2, low: true, warn: 0.9, crit: 0.86, fault: 0.83 }), T("imb", "Current imbalance", "%", 2.1, { noise: 0.08, warn: 8, crit: 12 })],
    binds: () => [["Status lamps", "Colour / blink", "pf"], ["Displays", "Glow", "kw"]],
    build(p, g) {
      const N = p.cabinets | 0, cw = 0.8, srv = p.kind === "Server racks", col = ({ Switchgear: 0xcbd5e1, MCC: 0x94a3b8, "Server racks": 0x111827 } as Record<string, any>)[p.kind];
      const lamps: any[] = [], leds: any[] = [];
      for (let i = 0; i < N; i++) {
        const x = -(N * cw) / 2 + (i + 0.5) * cw;
        const c = box(cw - 0.03, 2.1, 0.65, M(col, { metalness: 0.3, roughness: 0.6 })); c.position.set(x, 1.05, 0); g.add(c);
        if (srv) { for (let k = 0; k < 7; k++) { const m = lamp(k % 3 ? 0x22d3ee : 0x22c55e); const l = box(0.5, 0.02, 0.01, m); l.position.set(x, 0.35 + k * 0.24, 0.331); g.add(l); leds.push(m); } }
        else {
          const sc = box(0.3, 0.18, 0.02, M(0x0f172a, { emissive: 0x0e7490, emissiveIntensity: 0.8 })); sc.position.set(x, 1.55, 0.335); g.add(sc);
          const gm = lamp(0x22c55e), rm = lamp(0xef4444); rm.emissiveIntensity = 0;
          ([[gm, -0.12], [rm, 0.12]] as [THREE.Material, number][]).forEach(([m, dx]) => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 10), m); s.position.set(x + dx, 1.3, 0.34); g.add(s); });
          lamps.push({ gm, rm });
        }
      }
      return (dt, t, it) => {
        lamps.forEach(({ gm, rm }, i) => { gm.emissiveIntensity = it.running ? 1 : 0.05; rm.emissiveIntensity = it.status === "crit" && i % 2 === 0 ? (Math.sin(t * 9) > 0 ? 1.4 : 0) : 0; });
        leds.forEach(m => { if (Math.random() < 0.06) m.emissiveIntensity = it.running ? 0.3 + Math.random() : 0; });
      };
    } },
  solar: { fam: "electrical", name: "Solar array", pre: "PV", params: { rows: { l: "Rows", min: 1, max: 6, step: 1, v: 3 }, panels: { l: "Panels per row", min: 4, max: 16, step: 1, v: 8 } },
    tags: p => [T("kw", "Output", "kW", Math.round((p.rows | 0) * (p.panels | 0) * 0.42), { noise: 0.6, d: 0 }), T("irr", "Irradiance", "W/m²", 780, { off: 780, noise: 5, d: 0 }), T("pr", "Performance ratio", "%", 82, { off: 82, noise: 0.2, d: 0, low: true, warn: 75, crit: 70, fault: 64 })],
    binds: () => [["Panels", "Brightness by irradiance", "irr"], ["Faulty string", "Blink red", "pr"]],
    build(p, g) {
      const R = p.rows | 0, N = p.panels | 0;
      const pm = M(0x1e3a8a, { metalness: 0.6, roughness: 0.25, emissive: 0x1d4ed8, emissiveIntensity: 0.1 }), bad = M(0x1e3a8a, { metalness: 0.6, roughness: 0.25 });
      for (let r = 0; r < R; r++) {
        const z = -(R * 2.6) / 2 + (r + 0.5) * 2.6;
        for (let i = 0; i < N; i++) { const pan = box(1, 0.04, 1.6, r === 0 && i === N - 1 ? bad : pm); pan.position.set(-(N * 1.05) / 2 + (i + 0.5) * 1.05, 1, z); pan.rotation.x = -0.5; g.add(pan); }
        [-1, 1].forEach(sd => { const post = cyl(0.05, 0.05, 1, M(C.steel), 8); post.position.set(sd * (N * 1.05) / 2, 0.5, z); g.add(post); });
        const rail = box(N * 1.05, 0.06, 0.06, M(C.steel)); rail.position.set(0, 0.9, z); g.add(rail);
      }
      return (dt, t, it) => { pm.emissiveIntensity = 0.05 + 0.25 * clamp(it.r.irr / 1000, 0, 1); if (it.r.pr < 75) { bad.emissive.setHex(0xef4444); bad.emissiveIntensity = Math.sin(t * 8) > 0 ? 0.9 : 0.1; } else { bad.emissive.copy(pm.emissive); bad.emissiveIntensity = pm.emissiveIntensity; } };
    } },
  battery: { fam: "electrical", name: "Battery / UPS", pre: "UPS", params: { racks: { l: "Racks", min: 1, max: 6, step: 1, v: 3 } },
    tags: () => [T("soc", "State of charge", "%", 86, { off: 86, noise: 0.02, d: 0, low: true, warn: 30, crit: 20, fault: 18 }), T("temp", "Cell temp", "°C", 28, { off: 25, noise: 0.05, warn: 40, crit: 45, fault: 47 }), T("kw", "Power", "kW", 120, { noise: 1, d: 0 })],
    binds: () => [["Charge bars", "Fill to charge", "soc"], ["Cells", "Heat colour", "temp"]],
    build(p, g) {
      const N = p.racks | 0, cellM = M(0x4b5563), barM = new THREE.MeshBasicMaterial({ color: 0x22c55e }), bars: any[] = [];
      for (let i = 0; i < N; i++) {
        const x = -(N * 0.8) / 2 + (i + 0.5) * 0.8;
        const f = box(0.72, 2.1, 0.62, M(0x111827)); f.position.set(x, 1.05, 0); g.add(f);
        for (let k = 0; k < 8; k++) { const c = box(0.6, 0.18, 0.5, cellM); c.position.set(x, 0.25 + k * 0.23, 0.07); g.add(c); const bg = new THREE.BoxGeometry(0.5, 0.03, 0.01); bg.translate(0.25, 0, 0); const b = new THREE.Mesh(bg, barM); b.position.set(x - 0.25, 0.25 + k * 0.23, 0.325); g.add(b); bars.push(b); }
      }
      return (dt, t, it) => { const f = clamp(it.r.soc / 100, 0.02, 1); bars.forEach(b => b.scale.x = f); barM.color.setHex(f < 0.2 ? 0xef4444 : f < 0.3 ? 0xf59e0b : 0x22c55e); heatTo(cellM, it.r.temp, 20, 60, 0.7); };
    } },

  chiller: { fam: "hvac", name: "Chiller", pre: "CH", params: { fans: { l: "Condenser fans", min: 2, max: 8, step: 1, v: 4 } },
    tags: () => [T("chw", "Chilled water out", "°C", 7, { off: 14, noise: 0.03, warn: 9, crit: 11, fault: 12 }), T("kw", "Power", "kW", 210, { noise: 1.5, d: 0 }), T("cop", "COP", "", 5.6, { noise: 0.03, d: 2, low: true, warn: 4.5, crit: 3.6, fault: 3.2 })],
    binds: () => [["Condenser fans", "Rotate when running", "kw"], ["Label", "Show value", "chw"]],
    build(p, g) {
      const N = p.fans | 0, Lb = N * 1.15 + 1;
      const base = box(Lb + 0.2, 0.1, 1.9, M(C.dark)); base.position.y = 0.05; g.add(base);
      const body = box(Lb, 1.3, 1.7, M(0x8a99ad)); body.position.y = 0.75; g.add(body);
      const coil = box(N * 1.15, 0.5, 1.6, M(0x334155)); coil.position.set(0.5, 1.65, 0); g.add(coil);
      const rots: any[] = [];
      for (let i = 0; i < N; i++) { const x = 0.5 - (N * 1.15) / 2 + (i + 0.5) * 1.15; const sh = cyl(0.48, 0.48, 0.25, M(C.dark), 24, true); sh.position.set(x, 2.02, 0); g.add(sh); const r = fanRotor(5, 0.4, 0.14); r.position.set(x, 2.02, 0); g.add(r); rots.push(r); }
      [0, 1].forEach(k => { const c = X(cyl(0.28, 0.28, 0.9, M(C.blue), 16)); c.position.set(-Lb / 2 + 0.7 + k * 1.1, 0.45, 1.05); g.add(c); });
      return (dt, t, it) => rots.forEach(r => r.rotation.y += dt * (it.running ? 8 : 0));
    } },
  coolingtower: { fam: "hvac", name: "Cooling tower / evap. condenser", pre: "CT", params: { cells: { l: "Cells", min: 1, max: 6, step: 1, v: 2 } },
    tags: () => [T("cwt", "Basin temp", "°C", 29.5, { off: AMB, noise: 0.05, warn: 32, crit: 34, fault: 35 }), T("fan", "Fan speed", "%", 90, { noise: 0.4, d: 0 }), T("flow", "Water flow", "m³/h", 450, { noise: 3, d: 0 })],
    main: () => "cwt", binds: () => [["Fans", "Rotate", "fan"], ["Plume", "Steam", "fan"]],
    build(p, g) {
      const N = p.cells | 0, cw = 2.5, x0 = -(N * cw) / 2 + cw / 2;
      const basin = box(N * cw + 0.3, 0.4, 2.8, M(0x1e3a5f)); basin.position.y = 0.2; g.add(basin);
      const rots: any[] = [], sms: any[] = [];
      for (let i = 0; i < N; i++) {
        const x = x0 + i * cw;
        const cell = box(2.4, 2.6, 2.4, M(0x5a6e86, { roughness: 0.8, metalness: 0.2 })); cell.position.set(x, 1.7, 0); g.add(cell);
        for (let k = 0; k < 5; k++) { const lv = box(2.42, 0.05, 0.02, M(C.dark)); lv.position.set(x, 0.8 + k * 0.22, 1.21); g.add(lv); }
        const st = cyl(0.95, 1.05, 0.9, M(C.dark), 24, true); st.position.set(x, 3.45, 0); g.add(st);
        const r = fanRotor(5, 0.8, 0.24); r.position.set(x, 3.3, 0); g.add(r); rots.push(r);
        sms.push(smoke(g, x, 3.9, 0, 10, 0xdbe7f5, 0.35));
      }
      return (dt, t, it) => { rots.forEach(r => r.rotation.y += dt * it.r.fan / 100 * 6); sms.forEach(s => s(dt, it.running && it.r.fan > 5, it.r.fan / 90, 3)); };
    } },
  ahu: { fam: "hvac", name: "Air handling unit", pre: "AHU", params: { length: { l: "Length (m)", min: 3, max: 10, step: 0.5, v: 5 } },
    tags: () => [T("sat", "Supply air", "°C", 14, { off: 24, noise: 0.05, warn: 17, crit: 19, fault: 20 }), T("dp", "Filter ΔP", "Pa", 180, { off: 180, noise: 1, d: 0, warn: 300, crit: 380, fault: 420 }), T("fan", "Fan speed", "%", 78, { noise: 0.3, d: 0 }), T("rh", "Room RH", "%", 48, { off: 48, noise: 0.2, d: 0, warn: 60, crit: 65 })],
    binds: () => [["Supply fan", "Rotate", "fan"], ["Filter", "Darken with ΔP", "dp"], ["Label", "Show value", "sat"]],
    build(p, g) {
      const L = p.length;
      const base = box(L, 0.15, 1.6, M(C.dark)); base.position.y = 0.075; g.add(base);
      const cas = box(L, 1.8, 1.6, glass(0xcbd5e1, 0.28)); cas.position.y = 1.05; g.add(cas);
      const filM = M(0xe7e5e4, { roughness: 0.95, metalness: 0 }); const fil = box(0.12, 1.6, 1.4, filM); fil.position.set(-L * 0.3, 1.05, 0); g.add(fil);
      const coil = box(0.35, 1.6, 1.4, M(0xb87333, { metalness: 0.8, roughness: 0.35 })); coil.position.set(-L * 0.05, 1.05, 0); g.add(coil);
      const rot = fanRotor(6, 0.55, 0.2); const h = holder("x", rot); h.position.set(L * 0.25, 1.05, 0); g.add(h);
      const duct = box(0.8, 0.9, 0.8, M(C.grey)); duct.position.set(L * 0.38, 2.4, 0); g.add(duct);
      return (dt, t, it) => { rot.rotation.y += dt * it.r.fan / 100 * 9; filM.color.setHex(0xe7e5e4).lerp(BROWN, clamp(it.r.dp / 450, 0, 1)); };
    } },
  coldroom: { fam: "hvac", name: "Cold room", pre: "CS", params: { mode: { l: "Duty", opts: ["Frozen −20 °C", "Chilled 4 °C"], v: "Frozen −20 °C" }, width: { l: "Width (m)", min: 3, max: 10, step: 0.5, v: 5 }, depth: { l: "Depth (m)", min: 3, max: 10, step: 0.5, v: 6 } },
    tags: p => [p.mode.startsWith("Frozen") ? T("temp", "Room temp", "°C", -20, { off: 5, noise: 0.08, warn: -16, crit: -12, fault: -9 }) : T("temp", "Room temp", "°C", 4, { off: 15, noise: 0.05, warn: 6, crit: 8, fault: 10 }), T("door", "Door open for", "min", 0, { d: 0, fault: 12, warn: 5, crit: 10 })],
    binds: () => [["Door", "Slide open", "door"], ["Frost edge", "Glow when cold", "temp"], ["Status display", "Colour", "temp"]],
    build(p, g) {
      const W = p.width, D = p.depth, H = 3;
      const room = box(W, H, D, M(0xe2e8f0, { metalness: 0.1, roughness: 0.7 })); room.position.y = H / 2; g.add(room);
      const dx = -W / 2 + 1.3;
      const hole = box(1.6, 2.4, 0.02, M(0x020617)); hole.position.set(dx, 1.2, D / 2 + 0.011); g.add(hole);
      const door = box(1.65, 2.45, 0.1, M(0xf8fafc)); door.position.set(dx, 1.22, D / 2 + 0.07); g.add(door);
      const frostM = M(0xbae6fd, { emissive: 0x38bdf8, emissiveIntensity: 0.5 }); const fr = box(W + 0.02, 0.06, D + 0.02, frostM); fr.position.y = H - 0.03; g.add(fr);
      const unit = box(1.4, 0.6, 0.9, M(C.grey)); unit.position.set(W / 4, H + 0.3, 0); g.add(unit);
      const rot = fanRotor(4, 0.3, 0.1); rot.position.set(W / 4, H + 0.63, 0); g.add(rot);
      const dispM = M(0x0f172a, { emissive: 0x22c55e, emissiveIntensity: 0.9 }); const disp = box(0.4, 0.25, 0.03, dispM); disp.position.set(dx + 1.4, 1.6, D / 2 + 0.02); g.add(disp);
      return (dt, t, it) => { const tx = it.r.door > 0.5 ? dx + 1.7 : dx; door.position.x += (tx - door.position.x) * Math.min(1, dt * 3); frostM.emissiveIntensity = 0.2 + 0.9 * clamp((10 - it.r.temp) / 30, 0, 1); rot.rotation.y += dt * (it.running ? 8 : 0); dispM.emissive.setHex(SCOL[it.status]); };
    } },

  flare: { fam: "oilgas", name: "Flare stack", pre: "FL", params: { height: { l: "Height (m)", min: 10, max: 40, step: 1, v: 20 } },
    tags: () => [T("flow", "Flare flow", "kg/h", 1200, { noise: 30, d: 0, warn: 4000, crit: 6000, fault: 6600 }), T("pilot", "Pilot temp", "°C", 620, { off: AMB, noise: 3, d: 0, low: true, warn: 400, crit: 250 })],
    binds: () => [["Flame", "Size with flow", "flow"], ["Label", "Show value", "flow"]],
    build(p, g) {
      const H = p.height;
      const ko = X(cyl(0.7, 0.7, 3, M(C.grey), 20)); ko.position.set(0, 0.9, 2); g.add(ko);
      const stack = cyl(0.3, 0.45, H, M(0x9ca3af), 16); stack.position.y = H / 2; g.add(stack);
      for (let y = H - 3; y < H; y += 1.5) { const b = cyl(0.33, 0.33, 0.6, M(0xdc2626), 16); b.position.y = y; g.add(b); }
      const lm = new THREE.LineBasicMaterial({ color: 0x64748b });
      for (let i = 0; i < 3; i++) { const a = i / 3 * 2 * PI + 0.5; g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([P(0, H * 0.75, 0), P(Math.cos(a) * H * 0.45, 0, Math.sin(a) * H * 0.45)]), lm)); }
      const tip = cyl(0.4, 0.35, 0.6, M(0x52525b), 16); tip.position.y = H + 0.3; g.add(tip);
      const fl = new THREE.Group(); g.add(fl);
      const o = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, side: DS, depthWrite: false })); o.userData.fx = true; fl.add(o);
      const iN = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.8, side: DS, depthWrite: false })); iN.position.y = -0.3; iN.userData.fx = true; fl.add(iN);
      const light = new THREE.PointLight(0xff8a1a, 1, 18); light.position.y = H + 2; g.add(light);
      return (dt, t, it) => { const f = it.running ? 0.4 + it.r.flow / 2500 : 0.12; fl.scale.set(f * (1 + rnd(0.15)), f * (1 + rnd(0.2)), f * (1 + rnd(0.15))); fl.position.y = H + 0.6 + 1.5 * f; light.intensity = it.running ? 0.8 + f : 0.15; };
    } },
  wellhead: { fam: "oilgas", name: "Wellhead", pre: "WH", params: { size: { l: "Size", min: 0.8, max: 1.5, step: 0.1, v: 1 } },
    tags: () => [T("thp", "Tubing pressure", "bar", 85, { noise: 0.4, d: 0, warn: 110, crit: 125, fault: 130 }), T("tht", "Tubing temp", "°C", 62, { off: AMB, noise: 0.1, d: 0 }), T("choke", "Choke", "%", 45, { d: 0 })],
    binds: () => [["Pressure gauge", "Needle", "thp"], ["Label", "Show value", "thp"]],
    build(p, g) {
      const s = p.size, red = M(0xb91c1c), wheelM = M(C.yellow);
      const cel = box(2 * s, 0.2, 2 * s, M(C.dark)); cel.position.y = 0.1; g.add(cel);
      let y = 0.2;
      const parts = [["spool", 0.35], ["valve", 0.5], ["spool", 0.25], ["valve", 0.5], ["cross", 0.45], ["valve", 0.45], ["cap", 0.3]];
      let crossY = 0;
      (parts as [string, number][]).forEach(([k, hh]) => {
        const h = hh * s, cy = y + h / 2;
        if (k === "spool" || k === "cap") { const c = cyl(0.18 * s, 0.18 * s, h, M(C.grey), 16); c.position.y = cy; g.add(c); }
        else if (k === "valve") { const v = box(0.45 * s, h, 0.45 * s, red); v.position.y = cy; g.add(v); const w = new THREE.Mesh(new THREE.TorusGeometry(0.28 * s, 0.03 * s, 6, 24), wheelM); w.rotation.y = PI / 2; w.position.set(0.4 * s, cy, 0); g.add(w); }
        else { const c = box(0.5 * s, h, 0.5 * s, M(C.grey)); c.position.y = cy; g.add(c); crossY = cy; }
        y += h;
      });
      const wing = X(cyl(0.15 * s, 0.15 * s, 1.4 * s, M(C.grey), 12)); wing.position.set(0.7 * s, crossY, 0); g.add(wing);
      const wv = box(0.4 * s, 0.4 * s, 0.4 * s, red); wv.position.set(0.9 * s, crossY, 0); g.add(wv);
      const ww = new THREE.Mesh(new THREE.TorusGeometry(0.22 * s, 0.03 * s, 6, 24), wheelM); ww.rotation.x = PI / 2; ww.position.set(0.9 * s, crossY + 0.35 * s, 0); g.add(ww);
      g.add(pipe(P(1.4 * s, crossY, 0), P(1.4 * s, 0.25, 0), 0.13 * s, M(C.grey)));
      g.add(pipe(P(1.4 * s, 0.25, 0), P(2.6 * s, 0.25, 0), 0.13 * s, M(C.grey)));
      const gauge = new THREE.Group(); gauge.position.set(0, y + 0.2 * s, 0.05); g.add(gauge);
      const face = cyl(0.16 * s, 0.16 * s, 0.05, M(0xe8edf3, { metalness: 0.1 }), 20); face.rotation.x = PI / 2; gauge.add(face);
      const needle = box(0.015, 0.12 * s, 0.01, new THREE.MeshBasicMaterial({ color: 0xef4444 })); needle.geometry.translate(0, 0.05 * s, 0); needle.position.z = 0.03; gauge.add(needle);
      return (dt, t, it) => { needle.rotation.z = -(clamp(it.r.thp / 150, 0, 1) * 4.2 - 2.1); };
    } },

  motor: { fam: "rotating", name: "Electric motor", pre: "MT", params: { size: { l: "Size", min: 0.6, max: 2, step: 0.1, v: 1 } },
    tags: () => [T("speed", "Speed", "rpm", 1485, { noise: 4, d: 0 }), T("amps", "Current", "A", 38, { noise: 0.4, warn: 48, crit: 55, fault: 56 }), T("temp", "Winding temperature", "°C", 78, { noise: 0.3, warn: 110, crit: 130, fault: 132 }), VIB()],
    main: () => "amps", binds: () => [["Shaft", "Rotate", "speed"], ["Frame", "Heat colour", "temp"], ["Frame", "Shake", "vib"], ["Label", "Show value", "amps"]],
    build(p, g) {
      const s = p.size, frame = M(C.blue);
      const foot = box(1.3 * s, 0.12 * s, 0.7 * s, M(C.steel)); foot.position.y = 0.06 * s; g.add(foot);
      const body = X(cyl(0.38 * s, 0.38 * s, 1.1 * s, frame)); body.position.set(0, 0.55 * s, 0); g.add(body);
      for (let i = 0; i < 9; i++) { const f = X(cyl(0.41 * s, 0.41 * s, 0.03 * s, frame)); f.position.set(-0.45 * s + i * 0.11 * s, 0.55 * s, 0); g.add(f); }
      const cap = X(cyl(0.3 * s, 0.38 * s, 0.14 * s, M(C.grey))); cap.position.set(-0.62 * s, 0.55 * s, 0); g.add(cap);
      const tb = box(0.3 * s, 0.22 * s, 0.3 * s, frame); tb.position.set(0.1 * s, 1.02 * s, 0); g.add(tb);
      const sh = new THREE.Group(); sh.position.set(0.7 * s, 0.55 * s, 0); g.add(sh);
      sh.add(X(cyl(0.06 * s, 0.06 * s, 0.3 * s, M(C.light))));
      const key = box(0.3 * s, 0.03 * s, 0.03 * s, M(C.orange)); key.position.y = 0.06 * s; sh.add(key);
      return (dt, t, it) => { sh.rotation.x += dt * spinVis(it.r.speed); heatTo(frame, it.r.temp, 80, 130); };
    } },
  gearbox: { fam: "rotating", name: "Gearbox", pre: "GB", params: { size: { l: "Size", min: 0.6, max: 2, step: 0.1, v: 1 }, ratio: { l: "Ratio", min: 2, max: 40, step: 1, v: 10 } },
    tags: (p) => [T("speed", "Input speed", "rpm", 1480, { noise: 4, d: 0 }), T("out", "Output speed", "rpm", +(1480 / (p?.ratio || 10)).toFixed(0), { noise: 0.5, d: 0 }), T("oil", "Oil temperature", "°C", 62, { noise: 0.2, warn: 85, crit: 95, fault: 96 }), VIB()],
    main: () => "oil", binds: () => [["Input shaft", "Rotate", "speed"], ["Output shaft", "Rotate", "out"], ["Housing", "Heat colour", "oil"], ["Housing", "Shake", "vib"], ["Label", "Show value", "oil"]],
    build(p, g) {
      const s = p.size, hm = M(C.green);
      const base = box(1.4 * s, 0.1 * s, 0.9 * s, M(C.steel)); base.position.y = 0.05 * s; g.add(base);
      const hs = box(1 * s, 0.8 * s, 0.7 * s, hm); hs.position.y = 0.5 * s; g.add(hs);
      const lid = box(1.05 * s, 0.08 * s, 0.75 * s, hm); lid.position.y = 0.94 * s; g.add(lid);
      for (let i = 0; i < 4; i++) { const r = box(0.04 * s, 0.6 * s, 0.72 * s, hm); r.position.set(-0.35 * s + i * 0.23 * s, 0.5 * s, 0); g.add(r); }
      const breather = cyl(0.05 * s, 0.05 * s, 0.14 * s, M(C.yellow)); breather.position.set(0.3 * s, 1.05 * s, 0); g.add(breather);
      const inp = new THREE.Group(); inp.position.set(-0.65 * s, 0.65 * s, 0); g.add(inp);
      inp.add(X(cyl(0.05 * s, 0.05 * s, 0.3 * s, M(C.light)))); const k1 = box(0.3 * s, 0.025 * s, 0.025 * s, M(C.orange)); k1.position.y = 0.05 * s; inp.add(k1);
      const out = new THREE.Group(); out.position.set(0.68 * s, 0.35 * s, 0); g.add(out);
      out.add(X(cyl(0.1 * s, 0.1 * s, 0.36 * s, M(C.light)))); const k2 = box(0.36 * s, 0.04 * s, 0.04 * s, M(C.orange)); k2.position.y = 0.1 * s; out.add(k2);
      return (dt, t, it) => { inp.rotation.x += dt * spinVis(it.r.speed); out.rotation.x += dt * spinVis(it.r.out); heatTo(hm, it.r.oil, 65, 95); };
    } },
  valve: { fam: "vessel", name: "Control valve", pre: "FCV", params: { size: { l: "Size", min: 0.5, max: 2, step: 0.1, v: 1 } },
    tags: () => [T("open", "Opening", "%", 65, { noise: 0.3, d: 0 }), T("dp", "Differential pressure", "bar", 1.4, { noise: 0.02, warn: 3, crit: 4, fault: 4.2 }), T("flow", "Flow", "m³/h", 95, { noise: 1, d: 1 })],
    main: () => "open", binds: () => [["Stem", "Move with opening", "open"], ["Handwheel", "Rotate with opening", "open"], ["Label", "Show value", "open"]],
    build(p, g) {
      const s = p.size, steel = M(C.grey);
      const pl = X(cyl(0.12 * s, 0.12 * s, 1.6 * s, M(C.steel))); pl.position.y = 0.35 * s; g.add(pl);
      [-0.32, 0.32].forEach((x) => { const f = X(cyl(0.2 * s, 0.2 * s, 0.05 * s, steel)); f.position.set(x * s, 0.35 * s, 0); g.add(f); });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.24 * s, 20, 14), steel); body.position.y = 0.35 * s; g.add(body);
      const yoke = cyl(0.04 * s, 0.04 * s, 0.5 * s, M(C.light)); yoke.position.y = 0.8 * s; g.add(yoke);
      const act = lathe([[0, 0], [0.32, 0.02], [0.34, 0.1], [0.32, 0.18], [0, 0.2]], M(C.blue)); act.position.y = 1.05 * s; act.scale.setScalar(s); g.add(act);
      const stem = cyl(0.025 * s, 0.025 * s, 0.3 * s, M(C.orange)); g.add(stem);
      const hw = new THREE.Group(); hw.position.set(0, 1.35 * s, 0); g.add(hw);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16 * s, 0.02 * s, 8, 24), M(C.dark)); ring.rotation.x = PI / 2; hw.add(ring);
      for (let i = 0; i < 3; i++) { const sp = box(0.32 * s, 0.02 * s, 0.02 * s, M(C.dark)); sp.rotation.y = i * PI / 3; hw.add(sp); }
      let ang = 0;
      return (dt, t, it) => { const o = clamp((it.r.open ?? 0) / 100, 0, 1); stem.position.y = 0.62 * s + o * 0.2 * s; const target = o * PI * 4; ang += (target - ang) * Math.min(1, dt * 3); hw.rotation.y = ang; };
    } },
  generic: { fam: "other", name: "Generic machine", pre: "M", params: { width: { l: "Width (m)", min: 1, max: 6, step: 0.5, v: 2 }, height: { l: "Height (m)", min: 0.5, max: 5, step: 0.5, v: 1.5 }, depth: { l: "Depth (m)", min: 1, max: 6, step: 0.5, v: 1.5 }, colour: { l: "Colour", opts: ["Steel", "Blue", "Green", "Yellow", "Red"], v: "Steel" } },
    tags: () => [T("value", "Main reading", "", 50, { noise: 0.5, warn: 80, crit: 90, fault: 92 }), T("run", "Run hours", "h", 1240, { off: 1240, d: 0 })],
    binds: () => [["Front display", "Status colour", "value"], ["Label", "Show value", "value"]],
    build(p, g) {
      const col = ({ Steel: 0x6b7b90, Blue: 0x2f5f9e, Green: 0x2e7d5b, Yellow: 0xca8a04, Red: 0xb91c1c } as Record<string, any>)[p.colour];
      const b = box(p.width, p.height, p.depth, M(col)); b.position.y = p.height / 2; g.add(b);
      const sm = M(0x0f172a, { emissive: 0x22c55e, emissiveIntensity: 0.8 }); const sc = box(Math.min(0.6, p.width * 0.4), Math.min(0.35, p.height * 0.3), 0.03, sm); sc.position.set(0, p.height * 0.65, p.depth / 2 + 0.02); g.add(sc);
      return (dt, t, it) => sm.emissive.setHex(SCOL[it.status]);
    } },
  /* ---- textile ---- */
  blowroom: { fam: "textile", name: "Blow room line", pre: "BR", params: { bales: { l: "Bale lay-down", min: 4, max: 12, step: 1, v: 6 } },
    tags: () => [T("rate", "Output", "kg/h", 450, { noise: 4, d: 0 }), T("waste", "Waste", "%", 3.2, { noise: 0.03, warn: 5, crit: 6, fault: 6.5 }), T("fan", "Transport fan", "Pa", 1200, { noise: 8, d: 0 })],
    main: () => "rate", binds: () => [["Bale plucker", "Travel over the bales", "rate"], ["Label", "Show value", "rate"]],
    build(p, g) {
      const N = p.bales | 0, span = N;
      for (let i = 0; i < N; i++) { const b = box(0.85, 1.1, 0.9, M(0xe7e5e4, { metalness: 0, roughness: 1 })); b.position.set(-span / 2 + 0.5 + i, 0.55, 0); g.add(b); }
      [-1, 1].forEach(sd => { const r = box(span + 1, 0.08, 0.12, M(C.steel)); r.position.set(0, 0.04, sd * 0.85); g.add(r); });
      const pl = new THREE.Group(); g.add(pl);
      const tw = box(0.5, 2.2, 0.4, M(TEXB)); tw.position.set(0, 1.1, -1); pl.add(tw);
      const arm = box(0.6, 0.3, 2.1, M(TEXB)); arm.position.set(0, 1.85, 0); pl.add(arm);
      const roll = cyl(0.12, 0.12, 1.6, M(C.light), 12); roll.rotation.x = PI / 2; roll.position.set(0, 1.62, 0); pl.add(roll);
      [span / 2 + 1.4, span / 2 + 3.1].forEach(x => { const c = box(1.4, 1.8, 1.2, M(TEXB)); c.position.set(x, 0.9, 0); g.add(c); const w = box(0.5, 0.4, 0.02, M(0x0f172a, { emissive: 0x0e7490, emissiveIntensity: 0.8 })); w.position.set(x, 1.2, 0.61); g.add(w); });
      g.add(pipe(P(span / 2 - 0.2, 2.2, 0), P(span / 2 + 3.1, 2.2, 0), 0.2, M(C.grey)));
      [span / 2 + 1.4, span / 2 + 3.1].forEach(x => g.add(pipe(P(x, 2.2, 0), P(x, 1.8, 0), 0.2, M(C.grey))));
      const ph = Math.random() * 6;
      return (dt, t, it) => { if (it.running) { pl.position.x = -span / 2 + 0.5 + (Math.sin(t * 0.35 + ph) + 1) / 2 * (span - 1); roll.rotation.y += dt * 8; } };
    } },
  carding: { fam: "textile", name: "Carding machine", pre: "CD", params: {},
    tags: () => [T("speed", "Delivery", "m/min", 180, { noise: 1, d: 0 }), T("cyl", "Cylinder", "rpm", 500, { noise: 2, d: 0 }), T("cv", "Sliver CV", "%", 2.8, { noise: 0.03, warn: 3.5, crit: 4.2, fault: 4.6 })],
    binds: () => [["Cylinder & licker-in", "Rotate", "cyl"], ["Doffer & coiler can", "Rotate", "speed"], ["Label", "Show value", "speed"]],
    build(p, g) {
      const fr = box(2.4, 1.3, 1.3, M(TEXB)); fr.position.set(0, 0.65, 0); g.add(fr);
      const chute = box(0.6, 2.4, 1.2, M(TEXB)); chute.position.set(-1.6, 1.2, 0); g.add(chute);
      const cw = wheel(0.72, 1.36, 0x9aa6b6, 4); cw.position.set(-0.1, 1.25, 0); g.add(cw);
      const lk = wheel(0.22, 1.36, 0x9aa6b6, 2); lk.position.set(-1.0, 0.95, 0); g.add(lk);
      const df = wheel(0.38, 1.36, 0x9aa6b6, 3); df.position.set(0.95, 0.95, 0); g.add(df);
      const fl = box(1.5, 0.12, 1.36, M(0x1f2937)); fl.position.set(-0.1, 2.02, 0); g.add(fl);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 16), M(0xe7e5e4, { transparent: true, opacity: 0.8 })); cone.rotation.z = PI / 2; cone.position.set(1.55, 0.95, 0); g.add(cone);
      const can = new THREE.Group(); can.position.set(2.25, 0, 0); g.add(can);
      const cb = cyl(0.32, 0.32, 1, M(0xdc2626), 20); cb.position.y = 0.5; can.add(cb); const mk = box(0.66, 0.04, 0.06, M(0xfef3c7)); mk.position.y = 1.0; can.add(mk);
      const coil = cyl(0.18, 0.18, 0.25, M(C.grey), 16); coil.position.set(2.25, 1.2, 0); g.add(coil);
      return (dt, t, it) => { cw.rotation.z -= dt * spinVis(it.r.cyl); lk.rotation.z -= dt * spinVis(it.r.cyl) * 0.8; df.rotation.z += dt * it.r.speed / 60 * 1.2; can.rotation.y += dt * it.r.speed / 180 * 1.2; };
    } },
  drawframe: { fam: "textile", name: "Draw frame", pre: "DF", params: {},
    tags: () => [T("speed", "Delivery", "m/min", 600, { noise: 3, d: 0 }), T("cv", "Sliver CV", "%", 2.2, { noise: 0.03, warn: 3, crit: 3.6, fault: 3.9 })],
    binds: () => [["Drafting rollers", "Rotate", "speed"], ["Cans", "Rotate", "speed"]],
    build(p, g) {
      const b = box(2.2, 1.1, 1, M(TEXB)); b.position.y = 0.55; g.add(b);
      const head = box(1.2, 0.4, 0.9, M(0x334155)); head.position.set(0.3, 1.3, 0); g.add(head);
      const rolls: any[] = []; for (let i = 0; i < 4; i++) { const w = wheel(0.08, 0.95, 0xcbd5e1, 1); w.position.set(-0.1 + i * 0.25, 1.55, 0); g.add(w); rolls.push(w); }
      const mkCan = (x: number, z: number, col: number) => { const c = new THREE.Group(); c.position.set(x, 0, z); const cb = cyl(0.3, 0.3, 1, M(col), 18); cb.position.y = 0.5; c.add(cb); const mk = box(0.6, 0.04, 0.06, M(0xfef3c7)); mk.position.y = 1; c.add(mk); g.add(c); return c; };
      const cans = [mkCan(-1.6, -0.36, 0xdc2626), mkCan(-1.6, 0.36, 0xdc2626)], out = mkCan(1.6, 0, 0x2563eb);
      return (dt, t, it) => { const v = it.r.speed / 600; rolls.forEach((r, i) => r.rotation.z -= dt * (6 + i * 2) * v); out.rotation.y += dt * 2 * v; cans.forEach(c => c.rotation.y += dt * 0.4 * v); };
    } },
  comber: { fam: "textile", name: "Comber", pre: "CM", params: { heads: { l: "Heads", min: 4, max: 10, step: 1, v: 8 } },
    tags: () => [T("nips", "Speed", "nips/min", 400, { noise: 2, d: 0 }), T("noil", "Noil", "%", 16, { noise: 0.1, warn: 19, crit: 21, fault: 22 })],
    binds: () => [["Combing heads", "Rotate", "nips"], ["Lap rolls", "Unwind", "nips"]],
    build(p, g) {
      const N = p.heads | 0, L = N * 0.45 + 1;
      const b = box(L, 1.1, 1.2, M(TEXB)); b.position.y = 0.55; g.add(b);
      const hs: any[] = [], laps: any[] = [];
      for (let i = 0; i < N; i++) { const x = -L / 2 + 0.7 + i * 0.45; const w = wheel(0.12, 0.3, 0xcbd5e1, 2); w.position.set(x, 1.25, 0.35); g.add(w); hs.push(w); const lp = wheel(0.22, 0.35, 0xf5f5f4, 1, 0xd6d3d1); lp.position.set(x, 1.35, -0.3); g.add(lp); laps.push(lp); }
      const can = cyl(0.3, 0.3, 1, M(0xdc2626), 18); can.position.set(L / 2 + 0.5, 0.5, 0); g.add(can);
      return (dt, t, it) => { hs.forEach(h => h.rotation.z -= dt * it.r.nips / 400 * 7); laps.forEach(l => l.rotation.z -= dt * it.r.nips / 400 * 0.6); };
    } },
  speedframe: { fam: "textile", name: "Speed frame (roving)", pre: "SF", params: { spindles: { l: "Spindles", min: 48, max: 160, step: 8, v: 96 } },
    tags: () => [T("flyer", "Flyer speed", "rpm", 1100, { noise: 5, d: 0 }), T("breaks", "Breaks", "/100 spdl·h", 1.5, { noise: 0.03, warn: 4, crit: 6, fault: 7 })],
    binds: () => [["Flyers", "Rotate", "flyer"], ["Label", "Show value", "flyer"]],
    build(p, g) {
      const L = p.spindles * 0.06, n = Math.max(6, Math.round(L / 0.4));
      const b = box(L + 0.8, 0.9, 1.1, M(TEXB)); b.position.y = 0.45; g.add(b);
      const top = box(L + 0.8, 0.15, 1.1, M(0x334155)); top.position.y = 1.9; g.add(top);
      [-1, 1].forEach(sd => { const post = box(0.15, 1.0, 0.15, M(0x334155)); post.position.set(sd * (L / 2 + 0.3), 1.4, 0.45); g.add(post); });
      const fl: any[] = [], bm = M(0xf5f5f4, { metalness: 0, roughness: 0.9 });
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + (i + 0.5) * L / n;
        const f = new THREE.Group(); f.position.set(x, 1.3, 0.2); f.add(cyl(0.015, 0.015, 0.5, M(C.light), 6)); const a1 = box(0.16, 0.42, 0.02, M(C.light)); a1.position.set(0.08, -0.05, 0); f.add(a1); g.add(f); fl.push(f);
        const bob = cyl(0.07, 0.07, 0.32, bm, 12); bob.position.set(x, 1.1, 0.2); g.add(bob);
        const cr = cyl(0.12, 0.12, 0.35, bm, 12); cr.rotation.z = PI / 2; cr.position.set(x, 2.15, -0.2); g.add(cr);
      }
      return (dt, t, it) => fl.forEach(f => f.rotation.y += dt * spinVis(it.r.flyer));
    } },
  ringframe: { fam: "textile", name: "Ring frame", pre: "RF", params: { spindles: { l: "Spindles", min: 480, max: 1800, step: 48, v: 1200 } },
    tags: () => [T("speed", "Spindle speed", "rpm", 17500, { noise: 40, d: 0 }), T("breaks", "End breaks", "/1000 spdl·h", 25, { noise: 0.3, d: 0, warn: 40, crit: 60, fault: 66 }), T("kw", "Power", "kW", 95, { noise: 0.5, d: 0 })],
    main: () => "breaks", binds: () => [["Bobbins", "Build yarn over the doff", "speed"], ["Travelling cleaner", "Patrol", "speed"], ["Label", "Show value", "breaks"]],
    build(p, g) {
      const L = p.spindles * 0.012, n = Math.max(8, Math.round(L / 0.32));
      const base = box(L, 0.8, 1.2, M(0x94a3b8)); base.position.y = 0.4; g.add(base);
      [-1, 1].forEach(sd => { const h = box(1.2, 1.7, 1.4, M(TEXB)); h.position.set(sd * (L / 2 + 0.6), 0.85, 0); g.add(h); });
      const rail = box(L, 0.12, 1.3, M(0x334155)); rail.position.y = 1.55; g.add(rail);
      const cb = box(L, 0.06, 0.1, M(C.steel)); cb.position.set(0, 2.35, 0); g.add(cb);
      const bg = new THREE.CylinderGeometry(0.045, 0.045, 1, 10), bmat = M(0xf5f5f4, { metalness: 0, roughness: 0.9 }), rg = new THREE.CylinderGeometry(0.09, 0.09, 0.3, 10), rmat = M(0xfdba74, { metalness: 0, roughness: 0.9 });
      const bobs: any[] = [];
      for (let i = 0; i < n; i++) { const x = -L / 2 + (i + 0.5) * L / n; [-0.48, 0.48].forEach(z => { const b = new THREE.Mesh(bg, bmat); b.position.set(x, 1, z); g.add(b); bobs.push(b); const r = new THREE.Mesh(rg, rmat); r.position.set(x, 2.1, z * 0.6); g.add(r); }); }
      const cl = box(0.5, 0.3, 1.5, M(C.orange)); cl.position.set(0, 2.6, 0); g.add(cl);
      const ph = Math.random();
      return (dt, t, it) => { const u = it.running ? (t * 0.04 + ph) % 1 : 0.5; bobs.forEach(b => { b.scale.y = 0.15 + 0.35 * u; b.position.y = 0.85 + b.scale.y / 2; }); if (it.running) cl.position.x = Math.sin(t * 0.2 + ph * 6) * (L / 2 - 0.3); };
    } },
  winder: { fam: "textile", name: "Autoconer (winding)", pre: "AC", params: { heads: { l: "Winding heads", min: 12, max: 60, step: 4, v: 40 } },
    tags: () => [T("speed", "Winding speed", "m/min", 1400, { noise: 6, d: 0 }), T("splices", "Splices", "/h", 95, { noise: 1, d: 0 }), T("cuts", "Clearer cuts", "/100 km", 42, { noise: 0.4, d: 0, warn: 70, crit: 90, fault: 96 })],
    binds: () => [["Cone packages", "Rotate", "speed"], ["Service robot", "Patrol", "speed"]],
    build(p, g) {
      const L = p.heads * 0.25, n = Math.max(6, Math.round(L / 0.5));
      const base = box(L, 1.1, 1.1, M(0x94a3b8)); base.position.y = 0.55; g.add(base);
      const rail = box(L, 0.1, 0.2, M(C.steel)); rail.position.set(0, 2.25, -0.2); g.add(rail);
      const sps: any[] = [];
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + (i + 0.5) * L / n;
        const c = new THREE.Group(); c.position.set(x, 1.65, 0.25); c.rotation.z = 0.0; g.add(c);
        const sp = new THREE.Group(); c.add(sp); const cone = cyl(0.1, 0.17, 0.3, M(0xfafaf9, { metalness: 0, roughness: 0.9 }), 14); cone.rotation.z = PI / 2; sp.add(cone); const mk = box(0.32, 0.02, 0.02, M(0xa8a29e)); mk.position.y = 0.15; sp.add(mk); sps.push(sp);
        const sb = cyl(0.04, 0.04, 0.3, M(0xfdba74), 8); sb.position.set(x, 1.25, 0.45); g.add(sb);
      }
      const rob = box(0.6, 0.5, 0.6, M(C.orange)); rob.position.set(0, 2.0, -0.2); g.add(rob);
      const ph = Math.random() * 6;
      return (dt, t, it) => { sps.forEach(s => s.rotation.x += dt * it.r.speed / 1400 * 10); if (it.running) rob.position.x = Math.sin(t * 0.15 + ph) * (L / 2 - 0.4); };
    } },
  warping: { fam: "textile", name: "Warping machine", pre: "WP", params: { rows: { l: "Creel rows", min: 4, max: 10, step: 1, v: 6 } },
    tags: () => [T("speed", "Warping speed", "m/min", 800, { noise: 4, d: 0 }), T("breaks", "Breaks", "/million m", 1.2, { noise: 0.03, warn: 3, crit: 5, fault: 5.5 })],
    binds: () => [["Warp beam", "Rotate", "speed"], ["Yarn sheet", "Run", "speed"]],
    build(p, g) {
      const R = p.rows | 0, cols = 8, cm = M(0xfafaf9, { metalness: 0, roughness: 0.9 });
      [-1.15, 1.15].forEach(z => { const post = box(0.12, R * 0.3 + 0.6, 0.12, M(C.steel)); post.position.set(-3.3, (R * 0.3 + 0.6) / 2, z); g.add(post); });
      for (let r = 0; r < R; r++) for (let c = 0; c < cols; c++) { const cn = cyl(0.06, 0.1, 0.18, cm, 8); cn.rotation.z = -PI / 2; cn.position.set(-3.2, 0.35 + r * 0.3, -1 + c * (2 / (cols - 1))); g.add(cn); }
      const tex = stripeTex("#e5e7eb", "#94a3b8"); tex.repeat.set(5, 1);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.3, side: DS, depthWrite: false })); sh.rotation.x = -PI / 2; sh.position.set(-0.3, 1.0, 0); g.add(sh);
      const head = box(1, 1.4, 2.6, M(TEXB)); head.position.set(1.6, 0.7, 0); g.add(head);
      const bm = wheel(0.5, 2.2, 0x93c5fd, 3); bm.position.set(2.7, 1.0, 0); g.add(bm);
      [-1.1, 1.1].forEach(z => { const f = cyl(0.75, 0.75, 0.06, M(C.light), 24); f.rotation.x = PI / 2; f.position.set(2.7, 1.0, z); g.add(f); });
      return (dt, t, it) => { bm.rotation.z -= dt * it.r.speed / 60 / 0.5 * 0.2; tex.offset.x -= dt * it.r.speed / 800; };
    } },
  sizing: { fam: "textile", name: "Sizing / wet range", pre: "SZ", params: { cylinders: { l: "Drying cylinders", min: 3, max: 12, step: 1, v: 6 } },
    tags: () => [T("speed", "Speed", "m/min", 60, { noise: 0.4, d: 0 }), T("cyl", "Cylinder temp", "°C", 125, { off: AMB, noise: 0.3, d: 0, warn: 140, crit: 150 }), T("moist", "Moisture", "%", 7, { noise: 0.05, warn: 9, crit: 10, fault: 11 })],
    binds: () => [["Drying cylinders", "Rotate + heat colour", "cyl"], ["Yarn / fabric sheet", "Run", "speed"]],
    build(p, g) {
      const N = p.cylinders | 0, L = N * 0.8 + 4;
      const sb = box(1.6, 0.9, 2.2, M(C.steel)); sb.position.set(-L / 2 + 0.8, 0.45, 0); g.add(sb);
      const lq = box(1.4, 0.05, 2, M(0x60a5fa, { transparent: true, opacity: 0.8 })); lq.position.set(-L / 2 + 0.8, 0.88, 0); g.add(lq);
      const fr = box(N * 0.8 + 0.6, 0.3, 2.4, M(C.steel)); fr.position.set(-L / 2 + 2 + N * 0.4, 0.15, 0); g.add(fr);
      const cm = M(0x9aa6b6), cs: any[] = [];
      for (let i = 0; i < N; i++) { const w = wheel(0.33, 2.1, 0x9aa6b6, 2); setMat(w, cm); w.position.set(-L / 2 + 2.4 + i * 0.8, i % 2 ? 1.9 : 1.1, 0); g.add(w); cs.push(w); }
      const bm = wheel(0.45, 2.2, 0x93c5fd, 3); bm.position.set(L / 2 - 0.6, 0.9, 0); g.add(bm);
      const tex = stripeTex("#e5e7eb", "#94a3b8"); tex.repeat.set(L / 0.8, 1);
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(L - 1, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.35, side: DS, depthWrite: false })); sh.rotation.x = -PI / 2; sh.position.set(0, 1.5, 0); g.add(sh);
      return (dt, t, it) => { cs.forEach(c => c.rotation.z -= dt * it.r.speed / 60 * 3); heatTo(cm, it.r.cyl, 20, 220, 1); bm.rotation.z -= dt * it.r.speed / 60 * 1.5; tex.offset.x -= dt * it.r.speed / 60 * 0.8; };
    } },
  jetdyer: { fam: "textile", name: "Jet dyeing machine", pre: "JD", params: { tubes: { l: "Tubes", min: 1, max: 4, step: 1, v: 2 } },
    tags: () => [T("temp", "Bath temp", "°C", 98, { off: AMB, noise: 0.4, warn: 132, crit: 136, fault: 138 }), T("reel", "Reel speed", "m/min", 300, { noise: 2, d: 0 }), T("pres", "Vessel pressure", "bar", 1.2, { noise: 0.02, d: 2, warn: 3, crit: 3.5 })],
    binds: () => [["Vessel", "Heat colour", "temp"], ["Winch reel", "Rotate", "reel"]],
    build(p, g) {
      const N = p.tubes | 0, vm = M(0x9aa6b6, { metalness: 0.8, roughness: 0.3 }), reels: any[] = [];
      for (let i = 0; i < N; i++) {
        const z = (i - (N - 1) / 2) * 1.5;
        const body = X(cyl(0.6, 0.6, 4, vm, 28)); body.position.set(0, 0.9, z); g.add(body);
        [-1, 1].forEach(sd => { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 12), vm); cap.scale.x = 0.4; cap.position.set(sd * 2, 0.9, z); g.add(cap); });
        const up = cyl(0.42, 0.42, 1.6, vm, 24); up.position.set(1.4, 1.8, z); up.rotation.z = 0.5; g.add(up);
        const rh = box(0.9, 0.8, 1.0, glass(0x9aa6b6, 0.35)); rh.position.set(0.9, 2.5, z); g.add(rh);
        const rl = wheel(0.28, 0.7, 0x334155, 3); rl.position.set(0.9, 2.5, z); g.add(rl); reels.push(rl);
        [-1.2, 1.2].forEach(x => { const s = box(0.25, 0.6, 1, M(C.steel)); s.position.set(x, 0.3, z); g.add(s); });
      }
      return (dt, t, it) => { heatTo(vm, it.r.temp, 40, 160, 0.7); reels.forEach(r => r.rotation.z -= dt * it.r.reel / 60 * 1.2); };
    } },
  printer: { fam: "textile", name: "Rotary screen printer", pre: "RP", params: { colours: { l: "Colours", min: 4, max: 12, step: 1, v: 8 } },
    tags: () => [T("speed", "Print speed", "m/min", 60, { noise: 0.4, d: 0 }), T("reg", "Registration error", "mm", 0.1, { noise: 0.01, d: 2, warn: 0.3, crit: 0.5, fault: 0.55 }), T("dryer", "Dryer temp", "°C", 160, { off: AMB, noise: 0.5, d: 0 })],
    binds: () => [["Screens", "Rotate", "speed"], ["Fabric", "Run with print", "speed"], ["Dryer", "Heat colour", "dryer"]],
    build(p, g) {
      const N = p.colours | 0, L = N * 0.8 + 2;
      const fr = box(L, 0.8, 2.2, M(C.steel)); fr.position.y = 0.4; g.add(fr);
      const cv = document.createElement("canvas"); cv.width = 128; cv.height = 32; const x = cv.getContext("2d")!; x.fillStyle = "#f1f5f9"; x.fillRect(0, 0, 128, 32);
      for (let k = 0; k < 8; k++) { x.fillStyle = `hsl(${k * 45},70%,55%)`; x.beginPath(); x.arc(8 + k * 16, 8 + (k % 2) * 16, 6, 0, 7); x.fill(); }
      const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(L / 1.5, 1.5);
      const fab = new THREE.Mesh(new THREE.PlaneGeometry(L, 1.8), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })); fab.rotation.x = -PI / 2; fab.position.y = 0.82; g.add(fab);
      const sc: any[] = [];
      for (let i = 0; i < N; i++) { const w = wheel(0.16, 1.9, 0x000000, 1, 0x334155); setMat(w, M(new THREE.Color().setHSL(i / N, 0.6, 0.5).getHex(), { metalness: 0.3 })); w.position.set(-L / 2 + 1 + i * 0.8, 1.0, 0); g.add(w); sc.push(w); }
      const dm = M(0x475569); const dr = box(2.2, 1.6, 2.4, dm); dr.position.set(L / 2 + 1.2, 0.8, 0); g.add(dr);
      return (dt, t, it) => { sc.forEach(s => s.rotation.z -= dt * it.r.speed / 60 / 0.16 * 0.3); tex.offset.x -= dt * it.r.speed / 60 / 1.5 * 0.6; heatTo(dm, it.r.dryer, 20, 300, 0.8); };
    } },
  cutting: { fam: "textile", name: "Cutting table (CNC)", pre: "CT", params: { length: { l: "Table length (m)", min: 6, max: 14, step: 1, v: 10 } },
    tags: () => [T("cuts", "Plies cut", "/h", 120, { noise: 1, d: 0 }), T("util", "Utilisation", "%", 78, { off: 78, noise: 0.3, d: 0, low: true, warn: 60, crit: 50, fault: 45 })],
    binds: () => [["Cutter head", "Trace the pattern", "cuts"], ["Label", "Show value", "cuts"]],
    build(p, g) {
      const L = p.length;
      const tb = box(L, 0.85, 2.1, M(0xe5e7eb, { metalness: 0.1, roughness: 0.8 })); tb.position.y = 0.425; g.add(tb);
      const lay = box(L - 1, 0.12, 1.8, M(0x1d4ed8, { metalness: 0, roughness: 1 })); lay.position.y = 0.91; g.add(lay);
      const gan = new THREE.Group(); g.add(gan);
      const br = box(0.3, 0.25, 2.4, M(C.orange)); br.position.y = 1.5; gan.add(br);
      [-1, 1].forEach(sd => { const lg = box(0.2, 0.7, 0.15, M(C.orange)); lg.position.set(0, 1.15, sd * 1.15); gan.add(lg); });
      const hd = box(0.3, 0.4, 0.3, M(0x111827)); hd.position.y = 1.25; gan.add(hd);
      const ph = Math.random() * 6;
      return (dt, t, it) => { if (!it.running) return; const k = t * 0.4 + ph; gan.position.x = Math.sin(k * 0.5) * (L / 2 - 1); hd.position.z = Math.sin(k * 1.7) * 0.8; };
    } },
  sewing: { fam: "textile", name: "Sewing line", pre: "SL", params: { stations: { l: "Operators", min: 6, max: 30, step: 2, v: 16 } },
    tags: () => [T("pcs", "Output", "pieces/h", 320, { noise: 3, d: 0 }), T("eff", "Line efficiency", "%", 68, { off: 68, noise: 0.3, d: 0, low: true, warn: 55, crit: 45, fault: 40 })],
    binds: () => [["Needles", "Stitch", "pcs"], ["Hanger line", "Move garments", "pcs"]],
    build(p, g) {
      const per = Math.ceil((p.stations | 0) / 2), L = per * 1.3, needles: any[] = [];
      const tm = M(0xd6d3d1, { metalness: 0, roughness: 0.8 }), mm = M(0xe5e7eb), om = M(0x475569), hm = M(0xd4a373, { metalness: 0 });
      for (let i = 0; i < per; i++) [-1, 1].forEach(sd => {
        const x = -L / 2 + 0.65 + i * 1.3, z = sd * 0.75;
        const tb = box(1.1, 0.75, 0.6, tm); tb.position.set(x, 0.375, z); g.add(tb);
        const mc = box(0.45, 0.25, 0.2, mm); mc.position.set(x, 0.88, z); g.add(mc);
        const nd = box(0.02, 0.12, 0.02, M(0x111827)); nd.position.set(x - 0.15, 0.82, z); g.add(nd); needles.push(nd);
        const op = cyl(0.15, 0.18, 0.9, om, 10); op.position.set(x, 0.45, z + sd * 0.55); g.add(op);
        const hd = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), hm); hd.position.set(x, 1.02, z + sd * 0.55); g.add(hd);
      });
      const rail = box(L + 1, 0.05, 0.05, M(C.steel)); rail.position.set(0, 2.2, 0); g.add(rail);
      const n = Math.round(L / 0.8), gm: any[] = [], gmat = M(0x2563eb, { metalness: 0, roughness: 1 });
      for (let i = 0; i < n; i++) { const o = box(0.35, 0.5, 0.06, gmat); o.userData.u = i / n; g.add(o); gm.push(o); }
      return (dt, t, it) => { needles.forEach((nd, i) => nd.position.y = 0.82 + (it.running ? 0.04 * Math.sin(t * 25 + i) : 0)); gm.forEach(o => { o.userData.u = (o.userData.u + dt * it.r.pcs / 320 * 0.03) % 1; o.position.set(-(L + 1) / 2 + o.userData.u * (L + 1), 1.9, 0); }); };
    } },

  /* ---- iron & steel ---- */
  cokeoven: { fam: "metals", name: "Coke oven battery", pre: "CO", params: { ovens: { l: "Ovens", min: 20, max: 80, step: 4, v: 40 } },
    tags: () => [T("flue", "Flue temp", "°C", 1250, { off: 900, noise: 3, d: 0, warn: 1320, crit: 1360, fault: 1380 }), T("push", "Pushes", "/h", 4.2, { noise: 0.03 })],
    binds: () => [["Oven doors", "Glow", "flue"], ["Pusher & charging car", "Travel", "push"]],
    build(p, g) {
      const N = p.ovens | 0, L = N * 0.4;
      const bat = box(L, 5, 4, M(0x7c2d12, { roughness: 0.9, metalness: 0.1 })); bat.position.y = 2.5; g.add(bat);
      const gm = M(0x1f2937);
      for (let i = 0; i < N; i++) { const d = box(0.28, 4, 0.12, gm); d.position.set(-L / 2 + 0.2 + i * 0.4, 2.2, 2.06); g.add(d); }
      const top = box(L, 0.3, 4.2, M(0x44403c)); top.position.y = 5.15; g.add(top);
      const cc = box(1.6, 1.2, 3, M(C.orange)); cc.position.set(0, 5.9, 0); g.add(cc);
      const pu = box(2, 3, 1.6, M(0x2563eb)); pu.position.set(0, 1.5, -3); g.add(pu);
      const qt = box(2.4, 9, 2.4, M(0x57534e)); qt.position.set(L / 2 + 2.5, 4.5, 2); g.add(qt);
      const sm = smoke(g, L / 2 + 2.5, 9.2, 2, 12, 0xe5e7eb, 0.5);
      const ph = Math.random() * 6;
      return (dt, t, it) => { heatTo(gm, it.r.flue, 600, 1500, 1); if (it.running) { const k = t * 0.05 + ph; pu.position.x = Math.sin(k) * (L / 2 - 1); cc.position.x = Math.sin(k * 1.3 + 1) * (L / 2 - 1); } sm(dt, it.running, 1, 4); };
    } },
  sinter: { fam: "metals", name: "Sinter strand", pre: "SP", params: { length: { l: "Strand length (m)", min: 10, max: 30, step: 1, v: 18 } },
    tags: () => [T("speed", "Strand speed", "m/min", 3.2, { noise: 0.02 }), T("btp", "Burn-through temp", "°C", 420, { off: AMB, noise: 2, d: 0, warn: 470, crit: 520, fault: 540 }), T("suction", "Suction", "mbar", 150, { noise: 1, d: 0 })],
    binds: () => [["Sinter bed", "Glow from ignition to discharge", "btp"], ["Pallets", "Move", "speed"]],
    build(p, g) {
      const L = p.length, N = 10, sl = L / N, mats: any[] = [];
      for (let i = 0; i < N; i++) { const m = M(0x3f3f46); const s = box(sl - 0.03, 0.5, 2.6, m); s.position.set(-L / 2 + (i + 0.5) * sl, 1.75, 0); g.add(s); mats.push(m); const wb = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.3, 1.2, 4), M(0x52525b)); wb.rotation.y = PI / 4; wb.position.set(s.position.x, 0.9, 0); g.add(wb); }
      const fr = box(L + 2, 0.2, 3, M(C.steel)); fr.position.y = 1.4; g.add(fr);
      const ih = box(2, 1.2, 3.2, M(0x7c2d12)); ih.position.set(-L / 2 + 1.5, 2.6, 0); g.add(ih);
      const il = new THREE.PointLight(0xff6a00, 1, 6); il.position.set(-L / 2 + 1.5, 2.2, 1.8); g.add(il);
      const duct = X(cyl(0.6, 0.6, L, M(C.grey), 16)); duct.position.set(0, 0.6, -2.2); g.add(duct);
      const nm = Math.round(L / 1.2), marks: any[] = [];
      for (let i = 0; i < nm; i++) { const mk = box(0.1, 0.5, 0.06, M(C.orange)); mk.userData.u = i / nm; g.add(mk); marks.push(mk); }
      return (dt, t, it) => {
        mats.forEach((m, i) => { const u = i / (N - 1); heatTo(m, AMB + (it.r.btp * 2.2 - AMB) * Math.max(0, Math.sin(Math.min(1, u * 1.1) * PI * 0.95)) * (it.running ? 1 : 0.2), 50, 1100, 1); });
        marks.forEach(mk => { mk.userData.u = (mk.userData.u + dt * it.r.speed / 60 * 3 / L) % 1; mk.position.set(-L / 2 + mk.userData.u * L, 1.75, 1.33); });
        il.intensity = it.running ? 1 + Math.random() * 0.4 : 0;
      };
    } },
  blastfurnace: { fam: "metals", name: "Blast furnace", pre: "BF", params: { scale: { l: "Size", min: 0.5, max: 1.2, step: 0.05, v: 0.7 } },
    tags: () => [T("hm", "Hot metal", "t/day", 8000, { noise: 20, d: 0 }), T("blast", "Hot blast temp", "°C", 1150, { off: AMB, noise: 2, d: 0 }), T("top", "Top pressure", "bar", 2.2, { noise: 0.02, d: 2 }), T("hearth", "Hearth wall temp", "°C", 420, { off: AMB, noise: 1, d: 0, warn: 500, crit: 560, fault: 580 })],
    main: () => "hm", binds: () => [["Tuyeres", "Glow", "blast"], ["Shell", "Heat colour", "hearth"], ["Label", "Show value", "hm"]],
    build(p, g) {
      const s = p.scale, sm = M(0x52525b, { metalness: 0.6 });
      const prof = [[0, 0], [3.2, 0], [3.2, 2.6], [3.7, 3.3], [3.7, 4.4], [2.7, 11], [1.7, 14], [1.7, 15], [0.9, 16], [0, 16.3]];
      g.add(lathe(prof.map(([r, y]) => [r * s, y * s]), sm, 40));
      const rAt = (y: number) => y <= 4.4 ? 3.7 : y <= 11 ? 3.7 - (y - 4.4) / 6.6 : 2.7 - (y - 11) / 3;
      [5.5, 7.5, 9.5, 12].forEach(y => { const b = new THREE.Mesh(new THREE.TorusGeometry(rAt(y) * s + 0.04, 0.06, 6, 40), M(0x3f3f46)); b.rotation.x = PI / 2; b.position.y = y * s; g.add(b); });
      const bus = new THREE.Mesh(new THREE.TorusGeometry(4.6 * s, 0.35 * s, 10, 48), M(0x6b7280)); bus.rotation.x = PI / 2; bus.position.y = 4.9 * s; g.add(bus);
      const tm = new THREE.MeshBasicMaterial({ color: 0xff8a1a });
      for (let i = 0; i < 14; i++) { const a = i / 14 * 2 * PI; const tu = new THREE.Mesh(new THREE.SphereGeometry(0.18 * s, 8, 8), tm); tu.position.set(Math.cos(a) * 3.75 * s, 3.4 * s, Math.sin(a) * 3.75 * s); g.add(tu); g.add(pipe(P(Math.cos(a) * 4.6 * s, 4.9 * s, Math.sin(a) * 4.6 * s), P(Math.cos(a) * 3.8 * s, 3.5 * s, Math.sin(a) * 3.8 * s), 0.08 * s, M(0x6b7280))); }
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => { const c = box(0.4 * s, 17 * s, 0.4 * s, M(C.steel)); c.position.set(a * 4.4 * s, 8.5 * s, b * 4.4 * s); g.add(c); });
      const up = cyl(0.5 * s, 0.5 * s, 3 * s, M(0x6b7280), 16); up.position.y = 17.5 * s; g.add(up);
      g.add(pipe(P(0, 19 * s, 0), P(6 * s, 19 * s, 0), 0.5 * s, M(0x6b7280))); g.add(pipe(P(6 * s, 19 * s, 0), P(7.5 * s, 8 * s, 0), 0.5 * s, M(0x6b7280)));
      const dc = cyl(1.4 * s, 1.4 * s, 5 * s, M(0x78716c), 20); dc.position.set(7.5 * s, 5.5 * s, 0); g.add(dc);
      const dcc = new THREE.Mesh(new THREE.ConeGeometry(1.4 * s, 1.6 * s, 20), M(0x78716c)); dcc.rotation.x = PI; dcc.position.set(7.5 * s, 2.2 * s, 0); g.add(dcc);
      g.add(beam(P(-12 * s, 0.4, 0), P(-1.4 * s, 16 * s, 0), 1.2 * s, 0.5 * s, M(0x334155)));
      const hl = new THREE.PointLight(0xff6a00, 1.2, 12 * s); hl.position.set(0, 2.5 * s, 4.5 * s); g.add(hl);
      const castM = new THREE.MeshBasicMaterial({ color: 0xff7a1a }); const run = box(4 * s, 0.1, 0.4 * s, castM); run.position.set(0, 0.3, 5.5 * s); g.add(run);
      return (dt, t, it) => { const f = it.running ? 1 : 0; tm.color.setHSL(0.07, 1, f ? 0.5 + Math.random() * 0.08 : 0.1); heatTo(sm, it.r.hearth, 200, 900, 0.8); hl.intensity = f * (1 + Math.random() * 0.5); castM.color.setHSL(0.07, 1, f ? 0.5 : 0.12); };
    } },
  stove: { fam: "metals", name: "Hot blast stoves", pre: "HS", params: { count: { l: "Stoves", min: 2, max: 4, step: 1, v: 3 } },
    tags: () => [T("dome", "Dome temp", "°C", 1300, { off: AMB, noise: 3, d: 0, warn: 1380, crit: 1420, fault: 1430 }), T("blast", "Hot blast", "°C", 1150, { off: AMB, noise: 2, d: 0 })],
    binds: () => [["Stove shells", "Heat colour, cycling on gas / on blast", "dome"]],
    build(p, g) {
      const N = p.count | 0, mats: any[] = [];
      for (let i = 0; i < N; i++) { const m = M(0x6b7280, { metalness: 0.5 }); const x = (i - (N - 1) / 2) * 3; const c = cyl(1.2, 1.2, 8, m, 28); c.position.set(x, 4, 0); g.add(c); const d = new THREE.Mesh(new THREE.SphereGeometry(1.2, 28, 12, 0, 2 * PI, 0, PI / 2), m); d.position.set(x, 8, 0); g.add(d); mats.push(m); g.add(pipe(P(x, 2, 1.2), P(x, 2, 2.2), 0.25, M(C.grey))); }
      const hdr = X(cyl(0.35, 0.35, N * 3, M(C.grey), 12)); hdr.position.set(0, 2, 2.2); g.add(hdr);
      const ph = Math.random() * 6;
      return (dt, t, it) => mats.forEach((m, i) => { const cyc = (Math.sin(t * 0.15 + ph + i * 2 * PI / N) + 1) / 2; heatTo(m, it.r.dome * (0.55 + 0.45 * cyc) * (it.running ? 1 : 0.3), 400, 1500, 0.9); });
    } },
  converter: { fam: "metals", name: "BOF converter", pre: "BOF", params: { size: { l: "Size", min: 0.7, max: 1.4, step: 0.05, v: 1 } },
    tags: () => [T("o2", "Oxygen flow", "Nm³/min", 900, { noise: 6, d: 0 }), T("bath", "Bath temp", "°C", 1650, { off: AMB, noise: 2, d: 0, warn: 1700, crit: 1720, fault: 1730 }), T("heats", "Heats today", "", 28, { off: 28, d: 0 })],
    main: () => "bath", binds: () => [["Vessel", "Blow, tilt and tap cycle", "o2"], ["Mouth", "Sparks while blowing", "o2"], ["Shell", "Heat colour", "bath"]],
    build(p, g) {
      const s = p.size, vm = M(0x4b5563, { metalness: 0.6 });
      const piv = new THREE.Group(); piv.position.y = 3 * s; g.add(piv);
      piv.add(lathe([[0, -2.2], [1.5, -2.0], [2, -1.2], [2, 0.8], [1.4, 2], [1.0, 2.4], [0.95, 2.4]].map(([r, y]) => [r * s, y * s]), vm, 36));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.25 * s, 0.18 * s, 8, 40), M(0x6b7280)); ring.rotation.x = PI / 2; piv.add(ring);
      [-1, 1].forEach(sd => { const tr = cyl(0.25 * s, 0.25 * s, 1.2 * s, M(0x6b7280), 12); tr.rotation.x = PI / 2; tr.position.set(0, 3 * s, sd * 2.8 * s); g.add(tr); const st = box(0.8 * s, 3.4 * s, 0.6 * s, M(C.steel)); st.position.set(0, 1.7 * s, sd * 3.2 * s); g.add(st); });
      const hood = new THREE.Mesh(new THREE.CylinderGeometry(1.2 * s, 1.8 * s, 1.6 * s, 20, 1, true), M(0x57534e, { side: DS })); hood.position.y = 6.8 * s; g.add(hood);
      const duct = cyl(1 * s, 1 * s, 3 * s, M(0x57534e), 16); duct.position.y = 9 * s; g.add(duct);
      const lance = cyl(0.08 * s, 0.08 * s, 5 * s, M(C.light), 8); g.add(lance);
      const glowM = new THREE.MeshBasicMaterial({ color: 0xffa53a }); const glow = new THREE.Mesh(new THREE.CircleGeometry(0.9 * s, 24), glowM); glow.rotation.x = -PI / 2; glow.position.y = 2.38 * s; piv.add(glow);
      const stream = cyl(0.12 * s, 0.12 * s, 1, new THREE.MeshBasicMaterial({ color: 0xff9a2e }), 8); stream.userData.fx = true; g.add(stream);
      g.add(Object.assign(lathe([[0, 0], [1, 0], [1.25, 1.6], [1.3, 1.6]].map(([r, y]) => [r * s, y * s]), M(0x57534e), 20), {}).translateX(2.5 * s));
      const sp = sparks(g, 40), mouth = new THREE.Vector3(), ph = Math.random();
      return (dt, t, it) => {
        const u = it.running ? (t * 0.035 + ph) % 1 : 0; let tilt = 0, blow = false, tap = false;
        if (u < 0.6) blow = true; else if (u < 0.72) tilt = (u - 0.6) / 0.12; else if (u < 0.88) { tilt = 1; tap = true; } else tilt = 1 - (u - 0.88) / 0.12;
        const a = -tilt * 1.45; piv.rotation.z = a;
        lance.position.set(0, (blow ? 4.6 : 7.5) * s, 0);
        glowM.color.setHSL(0.07, 1, it.running ? 0.5 + Math.random() * 0.08 : 0.1);
        const mx = -2.4 * s * Math.sin(a), my = 3 * s + 2.4 * s * Math.cos(a);
        sp(dt, blow && it.running, mouth.set(mx, my, 0), 1.5 * s, 4 * s);
        stream.visible = tap && it.running; if (stream.visible) { const h = Math.max(0.1, my - 1.6 * s); stream.scale.y = h; stream.position.set(mx, 1.6 * s + h / 2, 0); }
        heatTo(vm, it.r.bath, 800, 1800, 0.6);
      };
    } },
  eaf: { fam: "metals", name: "Electric arc furnace", pre: "EAF", params: { size: { l: "Size", min: 0.7, max: 1.4, step: 0.05, v: 1 } },
    tags: () => [T("mw", "Arc power", "MW", 90, { noise: 2, d: 0 }), T("tap", "Tap temp", "°C", 1640, { off: AMB, noise: 2, d: 0, warn: 1690, crit: 1710, fault: 1720 }), T("kwh", "Energy", "kWh/t", 380, { noise: 1, d: 0 })],
    binds: () => [["Electrodes", "Regulate up and down", "mw"], ["Arc glow", "Flicker with power", "mw"], ["Shell", "Heat colour", "tap"]],
    build(p, g) {
      const s = p.size, shm = M(0x4b5563, { metalness: 0.6 });
      const cr = box(6 * s, 1 * s, 5 * s, M(C.steel)); cr.position.y = 0.5 * s; g.add(cr);
      g.add(lathe([[0, 1 * s], [2.4 * s, 1.2 * s], [2.8 * s, 2.2 * s], [2.8 * s, 3.6 * s]], shm, 36));
      g.add(lathe([[2.9 * s, 3.6 * s], [2.2 * s, 4.3 * s], [0.9 * s, 4.6 * s], [0, 4.6 * s]], M(0x57534e, { side: DS }), 36));
      const col = box(0.8 * s, 8 * s, 0.8 * s, M(0x6b7280)); col.position.set(-4 * s, 4 * s, 0); g.add(col);
      const els: any[] = [];
      for (let i = 0; i < 3; i++) { const a = i / 3 * 2 * PI, ex = Math.cos(a) * 0.7 * s, ez = Math.sin(a) * 0.7 * s; const e = new THREE.Group(); g.add(e); const rod = cyl(0.22 * s, 0.22 * s, 4 * s, M(0x27272a, { metalness: 0.2 }), 12); rod.position.set(ex, 6.2 * s, ez); e.add(rod); e.add(beam(P(-4 * s, 8 * s + i * 0.35 * s, ez), P(ex, 8 * s + i * 0.35 * s, ez), 0.3 * s, 0.3 * s, M(0x6b7280))); els.push(e); }
      const light = new THREE.PointLight(0xfff1c1, 1.5, 10 * s); light.position.set(0, 4.2 * s, 0); g.add(light);
      const ph = Math.random() * 5;
      return (dt, t, it) => { els.forEach((e, i) => e.position.y = it.running ? Math.sin(t * 3 + i * 2 + ph) * 0.12 * s : 0.6 * s); light.intensity = it.running ? (0.8 + Math.random() * 1.2) * it.r.mw / 90 : 0; heatTo(shm, it.r.tap, 800, 1800, 0.5); };
    } },
  ladlefurnace: { fam: "metals", name: "Ladle furnace", pre: "LF", params: {},
    tags: () => [T("temp", "Steel temp", "°C", 1600, { off: AMB, noise: 1.5, d: 0, warn: 1650, crit: 1670, fault: 1680 }), T("ar", "Argon stirring", "L/min", 300, { noise: 3, d: 0 })],
    binds: () => [["Arc glow", "Flicker", "temp"], ["Ladle", "Heat colour", "temp"]],
    build(p, g) {
      const lm = M(0x57534e);
      const car = box(3.4, 0.6, 3, M(C.orange)); car.position.y = 0.3; g.add(car);
      [-1, 1].forEach(sd => { const r = box(6, 0.1, 0.15, M(C.steel)); r.position.set(0, 0.05, sd * 1.1); g.add(r); });
      g.add(lathe([[0, 0.6], [1.2, 0.6], [1.5, 3], [1.55, 3]], lm, 28));
      const glowM = new THREE.MeshBasicMaterial({ color: 0xffa53a }); const gl = new THREE.Mesh(new THREE.CircleGeometry(1.4, 24), glowM); gl.rotation.x = -PI / 2; gl.position.y = 2.9; g.add(gl);
      const roof = cyl(1.7, 1.7, 0.4, M(0x6b7280), 24); roof.position.y = 3.7; g.add(roof);
      for (let i = 0; i < 3; i++) { const a = i / 3 * 2 * PI; const e = cyl(0.14, 0.14, 3, M(0x27272a), 10); e.position.set(Math.cos(a) * 0.45, 4.8, Math.sin(a) * 0.45); g.add(e); }
      const fr = box(0.5, 6.5, 0.5, M(C.steel)); fr.position.set(-2.4, 3.25, 0); g.add(fr); g.add(beam(P(-2.4, 6.2, 0), P(0, 6.2, 0), 0.4, 0.4, M(C.steel)));
      const light = new THREE.PointLight(0xffb347, 1, 6); light.position.set(0, 3.3, 1.8); g.add(light);
      return (dt, t, it) => { glowM.color.setHSL(0.07, 1, it.running ? 0.5 + Math.random() * 0.1 : 0.1); light.intensity = it.running ? 0.8 + Math.random() * 0.6 : 0; heatTo(lm, it.r.temp, 800, 1800, 0.4); };
    } },
  caster: { fam: "metals", name: "Continuous caster", pre: "CC", params: { strands: { l: "Strands", min: 1, max: 4, step: 1, v: 2 } },
    tags: () => [T("speed", "Casting speed", "m/min", 1.2, { noise: 0.01, d: 2 }), T("ml", "Mould level deviation", "mm", 1.5, { noise: 0.15, warn: 6, crit: 10, fault: 12 }), T("tund", "Tundish temp", "°C", 1545, { off: AMB, noise: 1, d: 0 })],
    binds: () => [["Slab", "Move along the arc", "speed"], ["Slab", "Cool from mould to cut-off", "tund"], ["Label", "Show value", "speed"]],
    build(p, g) {
      const N = p.strands | 0, R = 5, top = 7, W = N * 2.2;
      const tun = box(1.4, 0.8, W, M(0x57534e)); tun.position.set(0, top + 0.9, 0); g.add(tun);
      const lad = lathe([[0, 0], [1.1, 0], [1.35, 1.8], [1.4, 1.8]], M(0x57534e), 20); lad.position.set(0, top + 1.5, 0); g.add(lad);
      const tu = cyl(0.5, 0.8, top + 1.4, M(C.steel), 12); tu.position.set(-2.2, (top + 1.4) / 2, 0); g.add(tu); g.add(beam(P(-2.2, top + 1.4, 0), P(0, top + 1.4, 0), 0.4, 0.4, M(C.steel)));
      const path: any[] = []; for (let k = 0; k <= 12; k++) { const f = k / 12 * PI / 2; path.push(P(R - R * Math.cos(f), top - R * Math.sin(f), 0)); } path.push(P(R + 8, top - R, 0));
      const line = polyline(path), slabs: any[] = [], rm = M(0x6b7280);
      for (let si = 0; si < N; si++) {
        const z = (si - (N - 1) / 2) * 2.2;
        const md = box(0.6, 0.9, 1.4, M(0x2563eb)); md.position.set(0, top + 0.1, z); g.add(md);
        for (let k = 1; k <= 11; k++) { const f = k / 12 * PI / 2, cx = R - R * Math.cos(f), cy = top - R * Math.sin(f); [-1, 1].forEach(sd => { const r = cyl(0.15, 0.15, 1.5, rm, 10); r.rotation.x = PI / 2; r.position.set(cx - sd * 0.35 * Math.cos(f), cy - sd * 0.35 * Math.sin(f), z); g.add(r); }); }
        for (let x = R + 0.5; x < R + 8; x += 0.8) { const r = cyl(0.15, 0.15, 1.5, rm, 10); r.rotation.x = PI / 2; r.position.set(x, top - R - 0.35, z); g.add(r); }
        const torch = box(0.4, 0.6, 1.8, M(C.orange)); torch.position.set(R + 5, top - R + 0.6, z); g.add(torch);
        for (let i = 0; i < 24; i++) { const sb = box(0.55, 0.25, 1.3, M(0x52525b)); sb.userData.u = i / 24; sb.userData.z = z; g.add(sb); slabs.push(sb); }
      }
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      return (dt, t, it) => slabs.forEach(sb => {
        sb.userData.u = (sb.userData.u + dt * it.r.speed / 60 * 20 / line.total) % 1;
        line.at(sb.userData.u, a); line.at(Math.min(1, sb.userData.u + 0.01), b);
        sb.position.set(a.x, a.y, sb.userData.z); sb.rotation.z = Math.atan2(b.y - a.y, b.x - a.x || 1e-6);
        heatTo(sb.material, it.running ? 1450 - 900 * sb.userData.u : AMB, 300, 1500, 1);
      });
    } },
  rollstand: { fam: "metals", name: "Rolling mill stands", pre: "RM", params: { stands: { l: "Stands", min: 1, max: 7, step: 1, v: 4 } },
    tags: () => [T("speed", "Exit speed", "m/s", 8, { noise: 0.05 }), T("force", "Roll force", "MN", 18, { noise: 0.15, warn: 26, crit: 30, fault: 31 }), T("exit", "Exit temp", "°C", 880, { off: AMB, noise: 1, d: 0 })],
    main: () => "force", binds: () => [["Work & backup rolls", "Rotate", "speed"], ["Strip", "Run + heat colour", "exit"], ["Label", "Show value", "force"]],
    build(p, g) {
      const N = p.stands | 0, sp = 3.2, L = N * sp + 4, rolls: any[] = [], hm = M(0x2563eb);
      for (let i = 0; i < N; i++) {
        const x = -L / 2 + 2 + (i + 0.5) * sp;
        [-1, 1].forEach(sd => { const h = box(0.6, 5, 0.7, hm); h.position.set(x, 2.5, sd * 1.5); g.add(h); });
        const tb = box(0.8, 0.6, 3.7, hm); tb.position.set(x, 5.2, 0); g.add(tb);
        [[1.25 + 0.38, 0.35], [1.25 - 0.38, 0.35], [1.25 + 1.35, 0.6], [1.25 - 1.35, 0.6]].forEach(([y, r], k) => { const w = wheel(r, 2.6, 0x9aa6b6, k < 2 ? 2 : 1); w.position.set(x, Math.max(r + 0.05, y), 0); g.add(w); rolls.push({ w, dir: k % 2 ? 1 : -1, r }); });
        const shaft = cyl(0.18, 0.18, 1.6, M(C.light), 10); shaft.rotation.x = PI / 2; shaft.position.set(x, 1.25, -2.4); g.add(shaft);
        const mot = box(1.2, 1.4, 1.2, M(0x334155)); mot.position.set(x, 0.9, -3.8); g.add(mot);
      }
      const segN = Math.max(4, N * 2), segs: any[] = [];
      for (let j = 0; j < segN; j++) { const m = M(0x52525b); const s = box(L / segN, 0.06, 1.8, m); s.position.set(-L / 2 + (j + 0.5) * L / segN, 1.25, 0); g.add(s); segs.push(m); }
      const marks: any[] = []; for (let i = 0; i < 10; i++) { const mk = box(0.08, 0.07, 1.8, M(0x27272a)); mk.userData.u = i / 10; g.add(mk); marks.push(mk); }
      return (dt, t, it) => {
        rolls.forEach(r => r.w.rotation.z += r.dir * dt * it.r.speed / r.r * 0.15);
        segs.forEach((m, j) => heatTo(m, it.running ? 1100 - (1100 - it.r.exit) * j / (segN - 1) : AMB, 300, 1300, 1));
        marks.forEach(mk => { mk.userData.u = (mk.userData.u + dt * it.r.speed * 0.15 / L) % 1; mk.position.set(-L / 2 + mk.userData.u * L, 1.29, 0); });
      };
    } },
  coiler: { fam: "metals", name: "Down coiler", pre: "DC", params: {},
    tags: () => [T("temp", "Coiling temp", "°C", 600, { off: AMB, noise: 1.5, d: 0, warn: 660, crit: 690, fault: 700 }), T("wt", "Coil weight", "t", 22, { noise: 0.1 })],
    binds: () => [["Coil", "Grow and rotate", "wt"], ["Coil", "Heat colour", "temp"]],
    build(p, g) {
      const fr = box(3, 3, 0.6, M(0x2563eb)); fr.position.set(0, 1.5, -1.4); g.add(fr);
      const cm = M(0x71717a); const coil = new THREE.Group(); coil.position.set(0, 1.6, 0); g.add(coil);
      const cc = cyl(1, 1, 1.8, cm, 32); cc.rotation.x = PI / 2; coil.add(cc); coil.add(box(2.05, 0.08, 1.82, M(0x3f3f46)));
      const pr = wheel(0.25, 2, 0x9aa6b6, 2); pr.position.set(-2, 2.4, 0); g.add(pr);
      const car = box(2.4, 0.5, 2.2, M(C.orange)); car.position.set(0, 0.25, 0); g.add(car);
      const ph = Math.random();
      return (dt, t, it) => { const u = it.running ? (t * 0.05 + ph) % 1 : 0.6; const r = 0.45 + 0.65 * u; coil.scale.set(r, r, 1); coil.rotation.z -= dt * (it.running ? 3 / r : 0); pr.rotation.z -= dt * (it.running ? 8 : 0); heatTo(cm, it.running ? it.r.temp : AMB, 200, 1200, 1); };
    } },

  /* ---- oil & gas additions ---- */
  heater: { fam: "oilgas", name: "Fired heater", pre: "H", params: { size: { l: "Size", min: 0.7, max: 1.6, step: 0.1, v: 1 } },
    tags: () => [T("out", "Outlet temp", "°C", 360, { off: AMB, noise: 0.6, d: 0, warn: 375, crit: 385, fault: 392 }), T("o2", "Flue O₂", "%", 3, { noise: 0.04, low: true, warn: 1.5, crit: 1 }), T("duty", "Firing duty", "MW", 25, { noise: 0.2 })],
    binds: () => [["Burner windows", "Flame flicker", "duty"], ["Radiant box", "Heat colour", "out"], ["Stack", "Smoke", "duty"]],
    build(p, g) {
      const s = p.size, rm = M(0x6b7280);
      const rb = box(3 * s, 4 * s, 3 * s, rm); rb.position.y = 2 * s + 0.6; g.add(rb); legs4(g, 2.6 * s, 2.6 * s, 0.6, M(C.steel), 0.1);
      const cv = box(2 * s, 1.6 * s, 2 * s, M(0x57534e)); cv.position.y = 4.8 * s + 0.6; g.add(cv);
      const st = cyl(0.4 * s, 0.45 * s, 6 * s, M(0x52525b), 16); st.position.y = 8.6 * s + 0.6; g.add(st);
      const fm = new THREE.MeshBasicMaterial({ color: 0xff8a1a });
      [-0.8, 0, 0.8].forEach(x => { const w = new THREE.Mesh(new THREE.CircleGeometry(0.22 * s, 16), fm); w.position.set(x * s, 1.2 * s + 0.6, 1.51 * s); g.add(w); });
      const sm = smoke(g, 0, 11.7 * s + 0.6, 0, 10, 0x9ca3af, 0.3 * s);
      return (dt, t, it) => { fm.color.setHSL(0.07, 1, it.running ? 0.45 + Math.random() * 0.12 : 0.08); heatTo(rm, it.r.out, 200, 600, 0.6); sm(dt, it.running, it.r.duty / 25, 3 * s); };
    } },
  manifold: { fam: "oilgas", name: "Manifold / header", pre: "MF", params: { inlets: { l: "Inlets", min: 2, max: 8, step: 1, v: 4 } },
    tags: () => [T("pres", "Header pressure", "bar", 45, { noise: 0.2 }), T("flow", "Total flow", "m³/h", 1200, { noise: 8, d: 0 })],
    binds: () => [["Label", "Show value", "pres"]],
    build(p, g) {
      const N = p.inlets | 0, L = N * 1.2 + 1, pm = M(C.grey);
      const h = X(cyl(0.22, 0.22, L, pm, 16)); h.position.set(0, 0.9, 0); g.add(h);
      for (let i = 0; i < N; i++) {
        const x = -L / 2 + 0.9 + i * 1.2;
        g.add(pipe(P(x, 0.9, 0), P(x, 0.9, -1.8), 0.14, pm)); g.add(pipe(P(x, 0.9, -1.8), P(x, 0.2, -1.8), 0.14, pm));
        const v = box(0.35, 0.35, 0.35, M(0xb91c1c)); v.position.set(x, 0.9, -0.9); g.add(v);
        const w = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 20), M(C.yellow)); w.rotation.x = PI / 2; w.position.set(x, 1.25, -0.9); g.add(w);
        const s = box(0.15, 0.7, 0.15, M(C.steel)); s.position.set(x, 0.35, 0); g.add(s);
      }
      g.add(pipe(P(L / 2, 0.9, 0), P(L / 2 + 1.2, 0.9, 0), 0.22, pm));
    } },
  meter: { fam: "oilgas", name: "Metering skid", pre: "FM", params: { runs: { l: "Meter runs", min: 1, max: 4, step: 1, v: 2 } },
    tags: () => [T("flow", "Flow", "m³/h", 850, { noise: 4, d: 0 }), T("dens", "Density", "kg/m³", 842, { noise: 0.3, d: 0 }), T("dp", "Strainer ΔP", "bar", 0.3, { noise: 0.01, d: 2, warn: 0.8, crit: 1.2, fault: 1.3 })],
    binds: () => [["Meter displays", "Status colour", "flow"], ["Label", "Show value", "flow"]],
    build(p, g) {
      const N = p.runs | 0, W = N * 0.9 + 0.6, pm = M(C.grey), disp: any[] = [];
      const sk = box(4.4, 0.2, W + 0.4, M(C.dark)); sk.position.y = 0.1; g.add(sk);
      [-1.9, 1.9].forEach(x => { const hd = cyl(0.18, 0.18, W, pm, 12); hd.rotation.x = PI / 2; hd.position.set(x, 0.8, 0); g.add(hd); });
      for (let i = 0; i < N; i++) {
        const z = -W / 2 + 0.6 + i * 0.9;
        const r = X(cyl(0.13, 0.13, 3.8, pm, 12)); r.position.set(0, 0.8, z); g.add(r);
        const mb = box(0.5, 0.45, 0.45, M(0x2563eb)); mb.position.set(0, 0.8, z); g.add(mb);
        const dm = M(0x0f172a, { emissive: 0x22c55e, emissiveIntensity: 0.8 }); const d = box(0.3, 0.04, 0.22, dm); d.position.set(0, 1.04, z); g.add(d); disp.push(dm);
        [-1.2, 1.2].forEach(x => { const v = box(0.3, 0.3, 0.3, M(0xb91c1c)); v.position.set(x, 0.8, z); g.add(v); });
      }
      const pr = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.1, 8, 30, PI), pm); pr.position.set(0, 0.8, W / 2 + 0.3); g.add(pr);
      return (dt, t, it) => disp.forEach(m => m.emissive.setHex(SCOL[it.status]));
    } },
  pipeline: { fam: "oilgas", name: "Pipeline section", pre: "PL", params: { length: { l: "Length (m)", min: 6, max: 30, step: 1, v: 14 } },
    tags: () => [T("flow", "Flow", "m³/h", 1200, { noise: 8, d: 0 }), T("pin", "Inlet pressure", "bar", 62, { noise: 0.2 }), T("pout", "Outlet pressure", "bar", 48, { noise: 0.2, low: true, warn: 40, crit: 35, fault: 30 })],
    main: () => "pout", binds: () => [["Product inside", "Flow speed", "flow"], ["Label", "Show value", "pout"]],
    build(p, g) {
      const L = p.length;
      const pp = X(cyl(0.3, 0.3, L, glass(0x9aa6b6, 0.35), 20, true)); pp.position.y = 1; g.add(pp);
      for (let x = -L / 2 + 1; x <= L / 2 - 1; x += 2.5) { const s = box(0.2, 0.7, 0.9, M(C.steel)); s.position.set(x, 0.35, 0); g.add(s); }
      const v = box(0.6, 0.6, 0.6, M(0xb91c1c)); v.position.set(0, 1, 0); g.add(v);
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 6, 20), M(C.yellow)); w.rotation.x = PI / 2; w.position.set(0, 1.45, 0); g.add(w);
      const fl = particles(g, polyline([P(-L / 2, 1, 0), P(L / 2, 1, 0)]), Math.round(L * 2), 0xf59e0b, 0.09);
      return (dt, t, it) => fl.update(dt, it.running ? it.r.flow / 1200 * 2 : 0);
    } },

  /* ---- pharma ---- */
  granulator: { fam: "pharma", name: "High-shear granulator", pre: "HSG", params: { size: { l: "Size", min: 0.7, max: 1.5, step: 0.1, v: 1 } },
    tags: () => [T("imp", "Impeller", "rpm", 180, { noise: 1, d: 0 }), T("chop", "Chopper", "rpm", 1500, { noise: 8, d: 0 }), T("kw", "Impeller power", "kW", 11, { noise: 0.1, warn: 18, crit: 22, fault: 24 })],
    main: () => "kw", binds: () => [["Impeller", "Rotate", "imp"], ["Chopper", "Rotate", "chop"], ["Label", "Show value", "kw"]],
    build(p, g) {
      const s = p.size, ss = M(0xcbd5e1, { metalness: 0.7, roughness: 0.3 });
      const st = box(1.6 * s, 1 * s, 1.6 * s, ss); st.position.y = 0.5 * s; g.add(st);
      const bowl = lathe([[0, 0], [0.5, 0], [0.9, 0.5], [0.9, 1.1]].map(([r, y]) => [r * s, y * s]), glass(0xe2e8f0, 0.35), 32); bowl.position.y = 1 * s; g.add(bowl);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.92 * s, 28, 10, 0, 2 * PI, 0, PI / 2), M(0xe2e8f0, { metalness: 0.8 })); lid.scale.y = 0.3; lid.position.y = 2.1 * s; g.add(lid);
      const imp = new THREE.Group(); imp.position.y = 1.08 * s; g.add(imp);
      for (let i = 0; i < 3; i++) { const b = box(0.7 * s, 0.05 * s, 0.12 * s, M(0x94a3b8)); b.position.set(Math.cos(i * 2 * PI / 3) * 0.35 * s, 0, Math.sin(i * 2 * PI / 3) * 0.35 * s); b.rotation.y = -i * 2 * PI / 3; imp.add(b); }
      const pw = cyl(0.55 * s, 0.7 * s, 0.25 * s, M(0xfafaf9, { metalness: 0, roughness: 1 }), 24); pw.position.y = 1.25 * s; g.add(pw);
      const ch = fanRotor(4, 0.18 * s, 0.06 * s); const chh = holder("x", ch); chh.position.set(0.75 * s, 1.45 * s, 0); g.add(chh);
      const pn = box(0.5 * s, 0.8 * s, 0.1, M(0x0f172a, { emissive: 0x0e7490, emissiveIntensity: 0.7 })); pn.position.set(-1.1 * s, 1.2 * s, 0.5 * s); g.add(pn);
      return (dt, t, it) => { imp.rotation.y += dt * spinVis(it.r.imp); ch.rotation.y += dt * spinVis(it.r.chop); pw.rotation.y += dt * spinVis(it.r.imp) * 0.5; };
    } },
  fbd: { fam: "pharma", name: "Fluid bed dryer", pre: "FBD", params: {},
    tags: () => [T("inlet", "Inlet air", "°C", 60, { off: AMB, noise: 0.3, d: 0, warn: 70, crit: 75 }), T("prod", "Product temp", "°C", 38, { off: AMB, noise: 0.2 }), T("lod", "Moisture (LOD)", "%", 2.5, { noise: 0.03, warn: 4, crit: 5, fault: 5.5 })],
    main: () => "lod", binds: () => [["Granules", "Fluidise with airflow", "inlet"], ["Label", "Show value", "lod"]],
    build(p, g) {
      const base = box(1.6, 1, 1.6, M(0xcbd5e1, { metalness: 0.7, roughness: 0.3 })); base.position.y = 0.5; g.add(base);
      const cont = lathe([[0.45, 0], [0.85, 1.2]], glass(0xe2e8f0, 0.35), 28); cont.position.y = 1; g.add(cont);
      const exp = cyl(0.88, 0.88, 1.6, M(0xe2e8f0, { metalness: 0.8, roughness: 0.25 }), 28); exp.position.y = 3; g.add(exp);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.88, 28, 10, 0, 2 * PI, 0, PI / 2), M(0xe2e8f0, { metalness: 0.8 })); top.scale.y = 0.4; top.position.y = 3.8; g.add(top);
      const bl = box(1, 0.8, 0.8, M(C.blue)); bl.position.set(1.5, 0.4, 0); g.add(bl);
      const pts: any[] = [], pm = M(0xfafaf9, { metalness: 0 });
      for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), pm); m.userData.fx = true; m.userData.a = Math.random() * 6.3; m.userData.r = Math.random() * 0.4; m.userData.ph = Math.random() * 6; g.add(m); pts.push(m); }
      return (dt, t, it) => pts.forEach(m => { const h = it.running ? (Math.sin(t * 3 + m.userData.ph) + 1) / 2 * 0.9 : 0; const k = 1 + h * 0.6; m.position.set(Math.cos(m.userData.a + t * 0.3) * m.userData.r * k, 1.05 + h, Math.sin(m.userData.a + t * 0.3) * m.userData.r * k); });
    } },
  tabletpress: { fam: "pharma", name: "Rotary tablet press", pre: "TP", params: { stations: { l: "Punch stations", min: 8, max: 40, step: 2, v: 24 } },
    tags: () => [T("rate", "Output", "tablets/h", 180000, { noise: 400, d: 0 }), T("force", "Main compression", "kN", 18, { noise: 0.15 }), T("wdev", "Weight deviation", "%", 0.8, { noise: 0.02, d: 2, warn: 2, crit: 3, fault: 3.2 })],
    binds: () => [["Turret", "Rotate", "rate"], ["Punches", "Rise and fall on the cams", "rate"], ["Label", "Show value", "rate"]],
    build(p, g) {
      const N = p.stations | 0;
      const cab = box(1.4, 1, 1.4, M(0xe2e8f0, { metalness: 0.5, roughness: 0.4 })); cab.position.y = 0.5; g.add(cab);
      const tur = new THREE.Group(); tur.position.y = 1.15; g.add(tur); tur.add(cyl(0.55, 0.55, 0.25, M(0xcbd5e1, { metalness: 0.9, roughness: 0.2 }), 32));
      const pu: any[] = [], pmat = M(0x94a3b8);
      for (let i = 0; i < N; i++) { const a = i / N * 2 * PI; const u = cyl(0.025, 0.025, 0.35, pmat, 6); u.position.set(Math.cos(a) * 0.45, 0.35, Math.sin(a) * 0.45); tur.add(u); pu.push({ m: u, a }); }
      const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.08, 0.5, 16, 1, true), M(0xe2e8f0, { side: DS })); hop.position.set(0.2, 1.9, 0.2); g.add(hop);
      const gd = box(1.4, 0.9, 1.4, glass(0xe2e8f0, 0.18)); gd.position.y = 1.5; g.add(gd);
      const ch = box(0.5, 0.04, 0.12, M(C.light)); ch.position.set(0.85, 1.05, 0); ch.rotation.z = -0.4; g.add(ch);
      return (dt, t, it) => { tur.rotation.y += dt * it.r.rate / 180000 * 1.5; pu.forEach(o => { o.m.position.y = 0.3 + 0.1 * Math.max(0, Math.cos((o.a + tur.rotation.y) * 2)); }); };
    } },
  coater: { fam: "pharma", name: "Tablet coater", pre: "CO", params: {},
    tags: () => [T("drum", "Drum speed", "rpm", 8, { noise: 0.05 }), T("inlet", "Inlet air", "°C", 60, { off: AMB, noise: 0.3, d: 0 }), T("gain", "Weight gain", "%", 3, { noise: 0.02, warn: 4.5, crit: 5 })],
    binds: () => [["Perforated drum", "Rotate", "drum"], ["Tablets", "Tumble", "drum"]],
    build(p, g) {
      const sm = M(0xe2e8f0, { metalness: 0.6, roughness: 0.3 });
      const back = box(2.2, 2.2, 0.1, sm); back.position.set(0, 1.1, -0.85); g.add(back);
      [-1.05, 1.05].forEach(x => { const sd = box(0.1, 2.2, 1.8, sm); sd.position.set(x, 1.1, 0); g.add(sd); });
      const top = box(2.2, 0.1, 1.8, sm); top.position.y = 2.2; g.add(top); const bs = box(2.2, 0.5, 1.8, sm); bs.position.y = 0.25; g.add(bs);
      const fr = box(2.0, 1.6, 0.04, glass(0xe2e8f0, 0.15)); fr.position.set(0, 1.3, 0.88); g.add(fr);
      const drum = new THREE.Group(); drum.position.set(0, 1.3, 0); g.add(drum);
      const dc = cyl(0.7, 0.7, 1.2, M(0x94a3b8, { metalness: 0.8, roughness: 0.3, side: DS }), 28, true); dc.rotation.x = PI / 2; drum.add(dc);
      for (let i = 0; i < 10; i++) { const a = i / 10 * 2 * PI; const h = box(0.06, 0.06, 1.2, M(0x334155)); h.position.set(Math.cos(a) * 0.71, Math.sin(a) * 0.71, 0); drum.add(h); }
      const tabs: any[] = [], tm = M(0xfca5a5, { metalness: 0 });
      for (let i = 0; i < 30; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), tm); m.scale.y = 0.5; m.userData.fx = true; m.userData.a = Math.random(); m.userData.z = (Math.random() - 0.5); g.add(m); tabs.push(m); }
      const gun = box(0.08, 0.08, 1, M(C.light)); gun.position.set(0, 1.55, 0); g.add(gun);
      const duct = cyl(0.2, 0.2, 0.8, M(C.grey), 12); duct.position.set(0.6, 2.6, -0.3); g.add(duct);
      return (dt, t, it) => { drum.rotation.z -= dt * it.r.drum / 60 * 2 * PI; tabs.forEach(m => { const a = -PI / 2 - 0.9 + ((m.userData.a + (it.running ? t * 0.4 : 0)) % 1) * 1.4; m.position.set(Math.cos(a) * 0.55, 1.3 + Math.sin(a) * 0.55, m.userData.z); }); };
    } },
  blister: { fam: "pharma", name: "Blister packing line", pre: "BP", params: {},
    tags: () => [T("rate", "Output", "blisters/min", 300, { noise: 2, d: 0 }), T("rej", "Rejects", "%", 0.4, { noise: 0.02, d: 2, warn: 1, crit: 2, fault: 2.2 }), T("seal", "Seal temp", "°C", 180, { off: AMB, noise: 0.4, d: 0 })],
    binds: () => [["Foil web", "Run", "rate"], ["Sealing roller", "Rotate", "rate"], ["Cartons", "Move out", "rate"]],
    build(p, g) {
      const base = box(5, 0.9, 1, M(0xe2e8f0, { metalness: 0.5, roughness: 0.4 })); base.position.y = 0.45; g.add(base);
      const cv = document.createElement("canvas"); cv.width = 64; cv.height = 32; const x = cv.getContext("2d")!; x.fillStyle = "#e5e7eb"; x.fillRect(0, 0, 64, 32); x.fillStyle = "#fca5a5";
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { x.beginPath(); x.arc(8 + i * 16, 8 + j * 16, 5, 0, 7); x.fill(); }
      const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(10, 1);
      const web = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.6), new THREE.MeshStandardMaterial({ map: tex, metalness: 0.3, roughness: 0.5 })); web.rotation.x = -PI / 2; web.position.y = 0.92; g.add(web);
      const fs = box(0.8, 0.8, 0.9, M(0x94a3b8)); fs.position.set(-1.6, 1.3, 0); g.add(fs);
      const cs = box(0.6, 0.8, 0.9, M(0x94a3b8)); cs.position.set(1.5, 1.3, 0); g.add(cs);
      const sr = wheel(0.25, 0.8, 0x9aa6b6, 2); sr.position.set(0, 1.2, 0); g.add(sr);
      const gd = box(4.8, 1.0, 1.0, glass(0xe2e8f0, 0.15)); gd.position.y = 1.4; g.add(gd);
      const ob = box(1.6, 0.06, 0.6, M(C.belt)); ob.position.set(3.3, 0.8, 0); g.add(ob);
      const ct: any[] = [], cm = M(0xffffff, { metalness: 0, roughness: 0.9 });
      for (let i = 0; i < 4; i++) { const c = box(0.3, 0.18, 0.5, cm); c.userData.u = i / 4; g.add(c); ct.push(c); }
      return (dt, t, it) => { const v = it.r.rate / 300; tex.offset.x -= dt * 0.5 * v; sr.rotation.z -= dt * 3 * v; ct.forEach(c => { c.userData.u = (c.userData.u + dt * 0.25 * v) % 1; c.position.set(2.6 + c.userData.u * 1.4, 0.92, 0); }); };
    } },

  /* ---- water & effluent ---- */
  clarifier: { fam: "water", name: "Clarifier", pre: "CL", params: { dia: { l: "Diameter (m)", min: 6, max: 20, step: 1, v: 10 } },
    tags: () => [T("ntu", "Outlet turbidity", "NTU", 4, { noise: 0.05, warn: 10, crit: 15, fault: 18 }), T("blanket", "Sludge blanket", "m", 1.2, { noise: 0.01, d: 2, warn: 2, crit: 2.5 })],
    binds: () => [["Bridge", "Rotate", "ntu"], ["Water", "Colour by turbidity", "ntu"]],
    build(p, g) {
      const R = p.dia / 2;
      const wall = cyl(R, R, 2, M(0xa8a29e, { roughness: 0.9, metalness: 0, side: DS }), 48, true); wall.position.y = 1; g.add(wall);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.1, 6, 48), M(0x78716c)); rim.rotation.x = PI / 2; rim.position.y = 2; g.add(rim);
      const wm = M(0x0e7490, { metalness: 0.2, roughness: 0.3, transparent: true, opacity: 0.9 }); const w = cyl(R * 0.98, R * 0.98, 0.05, wm, 48); w.position.y = 1.8; g.add(w);
      const cw = cyl(0.8, 0.8, 1.2, M(0xa8a29e), 20); cw.position.y = 1.9; g.add(cw);
      const br = new THREE.Group(); br.position.y = 2.3; g.add(br);
      const bb = box(R, 0.25, 0.8, M(C.steel)); bb.position.x = R / 2; br.add(bb);
      const rl = box(R, 0.5, 0.04, M(C.yellow)); rl.position.set(R / 2, 0.35, 0.4); br.add(rl);
      const clean = new THREE.Color(0x0e7490), dirty = new THREE.Color(0x854d0e);
      return (dt, t, it) => { br.rotation.y += dt * (it.running ? 0.08 : 0); wm.color.copy(clean).lerp(dirty, clamp(it.r.ntu / 20, 0, 1)); };
    } },
  aeration: { fam: "water", name: "Aeration tank", pre: "AT", params: { length: { l: "Length (m)", min: 6, max: 20, step: 1, v: 12 }, width: { l: "Width (m)", min: 4, max: 10, step: 1, v: 6 } },
    tags: () => [T("do", "Dissolved oxygen", "mg/L", 2.2, { noise: 0.03, low: true, warn: 1.5, crit: 1, fault: 0.7 }), T("mlss", "MLSS", "mg/L", 3200, { noise: 10, d: 0 }), T("blower", "Blower", "%", 70, { noise: 0.3, d: 0 })],
    main: () => "do", binds: () => [["Bubbles", "Rise with blower output", "blower"], ["Label", "Show value", "do"]],
    build(p, g) {
      const L = p.length, W = p.width, cm = M(0xa8a29e, { roughness: 0.9, metalness: 0 });
      [W / 2, -W / 2].forEach(z => { const b = box(L, 2, 0.3, cm); b.position.set(0, 1, z); g.add(b); });
      [-L / 2, L / 2].forEach(x => { const b = box(0.3, 2, W, cm); b.position.set(x, 1, 0); g.add(b); });
      const w = box(L - 0.3, 0.05, W - 0.3, M(0x65a30d, { metalness: 0.1, roughness: 0.4, transparent: true, opacity: 0.85 })); w.position.y = 1.7; g.add(w);
      const bl = box(1.5, 1, 1, M(C.blue)); bl.position.set(-L / 2 - 1.2, 0.5, 0); g.add(bl);
      g.add(pipe(P(-L / 2 - 0.5, 1, 0), P(-L / 2 - 0.5, 2.2, 0), 0.15, M(C.grey))); g.add(pipe(P(-L / 2 - 0.5, 2.2, 0), P(L / 2 - 0.5, 2.2, 0), 0.12, M(C.grey)));
      const bub: any[] = [], bm = new THREE.MeshBasicMaterial({ color: 0xf0fdf4, transparent: true, opacity: 0.8 }), n = Math.round(L * W / 2);
      for (let i = 0; i < n; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), bm); m.userData.fx = true; m.userData.x = rnd(L - 1); m.userData.z = rnd(W - 1); m.userData.u = Math.random(); g.add(m); bub.push(m); }
      return (dt, t, it) => bub.forEach(m => { m.userData.u = (m.userData.u + dt * (it.running ? it.r.blower / 70 * 1.2 : 0)) % 1; m.position.set(m.userData.x, 1.65 + m.userData.u * 0.15, m.userData.z); m.scale.setScalar(it.running ? 0.5 + m.userData.u : 0.01); });
    } },
  glb: { fam: "other", name: "Uploaded 3D model", pre: "U", hidden: true, params: { scale: { l: "Scale", min: 0.2, max: 5, step: 0.1, v: 1 } },
    tags: () => [T("speed", "Speed", "rpm", 1200, { noise: 5, d: 0 }), T("temp", "Temperature", "°C", 60, { off: AMB, noise: 0.2, warn: 80, crit: 95, fault: 100 })],
    binds: (p, it) => (it.gb || []).map((b: any) => [b.mesh, b.beh, b.k]),
    build(p, g, it) {
      const o = it.glbObj.clone(true);
      o.traverse((c: any) => { if (c.isMesh && c.material) c.material = Array.isArray(c.material) ? c.material.map((m: any) => m.clone()) : c.material.clone(); });
      o.scale.setScalar(it.glbK * p.scale); g.add(o); o.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(o); o.position.set(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
      return (dt, t, it2) => (it2.gb || []).forEach(bd => {
        const mesh = o.getObjectByName(bd.mesh); if (!mesh) return; const v = it2.r[bd.k];
        if (bd.beh.startsWith("Rotate")) mesh.rotation[bd.beh.slice(-1).toLowerCase()] += dt * (bd.k === "speed" ? spinVis(v) : v * 0.02);
        else if (bd.beh === "Heat colour") { const mm = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material; if (mm && mm.emissive) heatTo(mm, v, bd.k === "temp" ? 20 : 0, bd.k === "temp" ? 120 : 1500, 1); }
        else if (bd.beh === "Blink on alarm") mesh.visible = it2.status === "crit" ? Math.sin(t * 10) > 0 : true;
      });
    } },
};
export const GBEH = ["Rotate X", "Rotate Y", "Rotate Z", "Heat colour", "Blink on alarm"];
