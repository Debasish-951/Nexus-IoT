/* eslint-disable */
// Renewable-energy machine models for the Live Twin library: a solar PV plant
// (strings, tracker, combiner box, inverter, transformer, weather station) and
// a wind turbine (tower, yawing nacelle with drivetrain inside, pitching blades,
// pad-mount transformer). Like every model they are built from simple shapes,
// declare the readings they understand, and return a per-frame updater that
// moves their parts from those readings.
import * as THREE from "three";
import { PI, AMB, clamp, rnd, P, C, SCOL, M, glass, lamp, cyl, box, X, pipe, polyline, particles, heatTo, fanRotor, holder, lathe, canvas2d, T } from "./kit";
import type { ModelDef } from "./types";

const FULL_BOS = "Combiner, inverter, transformer, weather station";
const TRACKER = "Single-axis tracker";

/** Solar module face: dark blue cells with a light grid, drawn once and shared. */
let cellTex: THREE.CanvasTexture | null = null;
function moduleTexture() {
  if (cellTex) return cellTex;
  const { cv, x } = canvas2d(64, 104);
  x.fillStyle = "#0f2a63"; x.fillRect(0, 0, 64, 104);
  x.strokeStyle = "#5b7fc4"; x.lineWidth = 1;
  for (let i = 1; i < 6; i++) { x.beginPath(); x.moveTo(i * 64 / 6, 0); x.lineTo(i * 64 / 6, 104); x.stroke(); }
  for (let j = 1; j < 10; j++) { x.beginPath(); x.moveTo(0, j * 104 / 10); x.lineTo(64, j * 104 / 10); x.stroke(); }
  x.strokeStyle = "#c9d3df"; x.lineWidth = 3; x.strokeRect(1, 1, 62, 102);
  cellTex = new THREE.CanvasTexture(cv);
  return cellTex;
}

/** A blade that tapers from root to tip, with its root at the origin and its length along +Y. Chord along Z. */
function bladeMesh(len: number, chord: number, thick: number, mat: THREE.Material) {
  const geo = new THREE.BoxGeometry(thick, len, chord, 1, 8, 1);
  geo.translate(0, len / 2, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const u = clamp(pos.getY(i) / len, 0, 1), k = 1 - 0.78 * u;
    pos.setZ(i, pos.getZ(i) * k + chord * 0.18 * u); // taper and sweep the trailing edge
    pos.setX(i, pos.getX(i) * (1 - 0.6 * u));
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

/** Shortest signed difference between two compass angles, in degrees. */
const angDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

export const RENEWABLES: Record<string, ModelDef> = {
  solar: {
    fam: "renewable", name: "Solar PV plant", pre: "PV",
    params: {
      rows: { l: "Rows", min: 1, max: 6, step: 1, v: 3 },
      panels: { l: "Panels per row", min: 4, max: 16, step: 1, v: 8 },
      mount: { l: "Mounting", opts: ["Fixed tilt", TRACKER], v: "Fixed tilt" },
      bos: { l: "Balance of system", opts: [FULL_BOS, "Panels only"], v: FULL_BOS },
    },
    tags: (p) => {
      const n = (p.rows | 0) * (p.panels | 0), dc = Math.round(n * 0.435), ac = Math.round(n * 0.42);
      const out = [
        T("kw", "AC output", "kW", ac, { noise: Math.max(0.3, ac * 0.01), d: 0 }),
        T("dckw", "DC power", "kW", dc, { noise: Math.max(0.3, dc * 0.01), d: 0 }),
        T("irr", "Irradiance", "W/m²", 780, { off: 780, noise: 5, d: 0 }),
        T("pr", "Performance ratio", "%", 82, { off: 82, noise: 0.2, d: 0, low: true, warn: 75, crit: 70, fault: 64 }),
        T("idc", "String current", "A", 9.4, { noise: 0.08, fault: 1.6 }),
        T("vdc", "DC voltage", "V", 715, { off: 780, noise: 2, d: 0, low: true, warn: 560, crit: 480 }),
        T("mod", "Module temperature", "°C", 47, { off: 45, noise: 0.2, warn: 70, crit: 80, fault: 83 }),
        T("amb", "Ambient temperature", "°C", 31, { off: 31, noise: 0.05 }),
        T("inv", "Inverter temperature", "°C", 52, { off: AMB, noise: 0.2, warn: 70, crit: 80 }),
        T("eff", "Inverter efficiency", "%", 97.8, { noise: 0.03, low: true, warn: 95, crit: 92 }),
        T("wind", "Wind speed", "m/s", 4.5, { off: 4.5, noise: 0.3, warn: 15, crit: 18 }),
      ];
      if (p.mount === TRACKER) out.push(T("tilt", "Tracker angle", "°", 28, { off: 0, noise: 0.2, d: 0 }));
      return out;
    },
    main: () => "kw",
    scen: (p) => {
      const n = (p.rows | 0) * (p.panels | 0), dc = n * 0.435, ac = n * 0.42;
      return {
        cloud: { irr: 190, dckw: dc * 0.23, kw: ac * 0.22, idc: 2.2, vdc: 690, mod: 34, inv: 41 },
        storm: { wind: 22, tilt: 0, irr: 260, dckw: dc * 0.31, kw: ac * 0.3, idc: 2.9, mod: 33, inv: 43 },
      };
    },
    binds: (p) => [
      ["Panels", "Brightness by irradiance", "irr"],
      ["Faulty string", "Blink red when below expected current", "idc"],
      ...(p.mount === TRACKER ? [["Tracker rows", "Tilt to angle", "tilt"]] : []),
      ...(p.bos === FULL_BOS ? [
        ["DC cables", "Flow particles", "dckw"],
        ["Inverter fan", "Rotate with output", "kw"],
        ["AC cable", "Flow particles", "kw"],
        ["Anemometer", "Rotate with wind", "wind"],
      ] : []),
      ["Label", "Show value", "kw"],
    ],
    build(p, g) {
      const R = p.rows | 0, N = p.panels | 0, tracker = p.mount === TRACKER, full = p.bos === FULL_BOS;
      const W = N * 1.05, pitchZ = 2.8, H = 1.15, st = M(C.steel);
      const pm = M(0xffffff, { map: moduleTexture(), metalness: 0.5, roughness: 0.3, emissive: 0x1d4ed8, emissiveIntensity: 0.1 });
      const bad = M(0xffffff, { map: moduleTexture(), metalness: 0.5, roughness: 0.3, emissive: 0x1d4ed8, emissiveIntensity: 0.1 });
      const rows: THREE.Group[] = [], rowZ: number[] = [];
      for (let r = 0; r < R; r++) {
        const z = -(R * pitchZ) / 2 + (r + 0.5) * pitchZ; rowZ.push(z);
        const rg = new THREE.Group(); rg.position.set(0, H, z); rg.rotation.x = tracker ? -28 * PI / 180 : -0.5; g.add(rg); rows.push(rg);
        for (let i = 0; i < N; i++) {
          const pan = box(1, 0.04, 1.6, r === 0 && i >= N - 3 ? bad : pm);
          pan.position.set(-W / 2 + (i + 0.5) * 1.05, 0.08, 0); rg.add(pan);
        }
        // torque tube (tracker) or purlins (fixed tilt) under the modules
        if (tracker) rg.add(X(cyl(0.07, 0.07, W + 0.3, M(C.light), 12)));
        else [-0.5, 0.5].forEach((dz) => { const rail = box(W, 0.05, 0.06, st); rail.position.set(0, 0, dz); rg.add(rail); });
        const nPost = Math.max(2, Math.ceil(N / 4) + 1);
        for (let k = 0; k < nPost; k++) {
          const x = -W / 2 + (k / (nPost - 1)) * W;
          const post = cyl(0.05, 0.06, H, st, 8); post.position.set(x, H / 2, z); g.add(post);
          if (!tracker) { const leg = cyl(0.04, 0.04, H * 0.6, st, 8); leg.position.set(x, H * 0.3, z + 0.55); g.add(leg); }
        }
        if (tracker) { const drive = box(0.35, 0.35, 0.35, M(C.yellow)); drive.position.set(0, H - 0.22, z); g.add(drive); }
      }

      let dcFlows: ReturnType<typeof particles>[] = [], acFlow: ReturnType<typeof particles> | null = null, fan: THREE.Group | null = null;
      let invLed: THREE.MeshStandardMaterial | null = null, cups: THREE.Group | null = null, screenM: THREE.MeshStandardMaterial | null = null;
      const leds: THREE.MeshStandardMaterial[] = [];
      if (full) {
        const xC = W / 2 + 1.4, xI = W / 2 + 3.2, xT = W / 2 + 5.4;
        // combiner box with one LED per string
        const cb = box(0.6, 0.8, 0.3, M(0xd7dde5, { metalness: 0.3 })); cb.position.set(xC, 1.0, 0); g.add(cb);
        const cbp = cyl(0.05, 0.05, 0.6, st, 8); cbp.position.set(xC, 0.3, 0); g.add(cbp);
        for (let r = 0; r < R; r++) { const m = lamp(0x22c55e); leds.push(m); const l = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), m); l.position.set(xC - 0.2 + (r % 3) * 0.2, 1.25 - Math.floor(r / 3) * 0.14, 0.16); g.add(l); }
        const cableM = M(0x1f2937);
        rowZ.forEach((z) => {
          const pts = [P(W / 2, 0.25, z), P(xC - 0.4, 0.25, z), P(xC - 0.4, 0.25, 0), P(xC, 0.6, 0)];
          for (let i = 0; i < pts.length - 1; i++) g.add(pipe(pts[i], pts[i + 1], 0.03, cableM));
          dcFlows.push(particles(g, polyline([...pts, P(xI - 0.75, 0.6, 0)]), 7, 0xfbbf24, 0.05));
        });
        g.add(pipe(P(xC, 0.6, 0), P(xI - 0.75, 0.6, 0), 0.04, cableM));
        // inverter: plinth, cabinet, louvres, cooling fan, display and status LED
        const plinth = box(1.8, 0.15, 1.2, M(0x52525b)); plinth.position.set(xI, 0.075, 0); g.add(plinth);
        const inv = box(1.4, 1.6, 0.9, M(0xe5e7eb, { metalness: 0.25 })); inv.position.set(xI, 0.95, 0); g.add(inv);
        for (let k = 0; k < 6; k++) { const lv = box(0.9, 0.04, 0.02, M(C.grey)); lv.position.set(xI, 0.45 + k * 0.12, 0.46); g.add(lv); }
        const grill = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 8, 28), M(C.dark)); grill.rotation.y = PI / 2; grill.position.set(xI + 0.71, 1.2, 0); g.add(grill);
        fan = fanRotor(5, 0.24, 0.1); const fh = holder("x", fan); fh.position.set(xI + 0.73, 1.2, 0); g.add(fh);
        screenM = M(0x0f172a, { emissive: 0x0b3b66, emissiveIntensity: 0.8 });
        const scr = box(0.42, 0.26, 0.02, screenM); scr.position.set(xI - 0.25, 1.45, 0.46); g.add(scr);
        invLed = lamp(0x22c55e); const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), invLed); led.position.set(xI + 0.3, 1.5, 0.47); g.add(led);
        // transformer with radiator fins and three bushings
        const tank = box(1.2, 1.2, 1.0, M(0x4d6b5a)); tank.position.set(xT, 0.75, 0); g.add(tank);
        const tpl = box(1.6, 0.15, 1.4, M(0x52525b)); tpl.position.set(xT, 0.075, 0); g.add(tpl);
        for (let k = 0; k < 5; k++) [-1, 1].forEach((sd) => { const fin = box(0.06, 0.9, 0.3, M(0x3f5a4b)); fin.position.set(xT - 0.4 + k * 0.2, 0.75, sd * 0.65); g.add(fin); });
        for (let k = 0; k < 3; k++) { const bu = cyl(0.06, 0.08, 0.4, M(0xc2410c), 10); bu.position.set(xT - 0.35 + k * 0.35, 1.55, 0); g.add(bu); }
        g.add(pipe(P(xI + 0.7, 0.6, -0.3), P(xT - 0.6, 0.6, -0.3), 0.05, cableM));
        acFlow = particles(g, polyline([P(xI + 0.7, 0.6, -0.3), P(xT - 0.6, 0.6, -0.3)]), 8, 0x38bdf8, 0.05);
        // weather station: mast, pyranometer, anemometer, wind vane
        const xW = -W / 2 - 1.4;
        const mast = cyl(0.04, 0.05, 2.8, st, 8); mast.position.set(xW, 1.4, 0); g.add(mast);
        const arm = box(0.9, 0.04, 0.04, st); arm.position.set(xW, 2.4, 0); g.add(arm);
        const pyr = cyl(0.1, 0.1, 0.05, M(0xf8fafc)); pyr.position.set(xW - 0.4, 2.46, 0); g.add(pyr);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, 2 * PI, 0, PI / 2), glass(0xffffff, 0.5)); dome.position.set(xW - 0.4, 2.49, 0); g.add(dome);
        cups = new THREE.Group(); cups.position.set(xW, 2.95, 0); g.add(cups);
        for (let k = 0; k < 3; k++) { const piv = new THREE.Group(); piv.rotation.y = k * 2 * PI / 3; const a = box(0.22, 0.015, 0.015, st); a.position.x = 0.11; piv.add(a); const cup = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8, 0, PI), M(0xf8fafc)); cup.position.x = 0.22; cup.rotation.y = PI / 2; piv.add(cup); cups.add(piv); }
        const vane = box(0.35, 0.12, 0.01, M(C.orange)); vane.position.set(xW + 0.45, 2.55, 0); g.add(vane);
      }

      let tiltNow = tracker ? -28 : 0;
      return (dt, t, it) => {
        const irr = clamp(it.r.irr / 1000, 0, 1.2);
        pm.emissiveIntensity = 0.04 + 0.28 * irr;
        // A string is underperforming when its current is well below what the irradiance should give.
        const expected = 9.4 * clamp(it.r.irr / 780, 0, 1.5);
        const weak = it.running && (it.r.idc < expected * 0.6 || it.r.pr < 75);
        if (weak) { bad.emissive.setHex(0xef4444); bad.emissiveIntensity = Math.sin(t * 8) > 0 ? 0.9 : 0.1; }
        else { bad.emissive.copy(pm.emissive); bad.emissiveIntensity = pm.emissiveIntensity; }
        if (tracker) {
          // Trackers stow flat above the wind limit, whatever the angle reading says.
          const target = it.r.wind >= 18 ? 0 : -clamp(it.r.tilt ?? 0, -60, 60);
          tiltNow += (target - tiltNow) * Math.min(1, dt * 1.5);
          rows.forEach((rg) => { rg.rotation.x = tiltNow * PI / 180; });
        }
        const on = it.running ? 1 : 0, dcRated = Math.max(1, R * N * 0.435), acRated = Math.max(1, R * N * 0.42);
        dcFlows.forEach((f) => f.update(dt, on * clamp(it.r.dckw / dcRated, 0, 1.5) * 1.4));
        acFlow?.update(dt, on * clamp(it.r.kw / acRated, 0, 1.5) * 1.6);
        if (fan) fan.rotation.y += dt * on * 14 * clamp(it.r.kw / acRated, 0.15, 1.2);
        if (cups) cups.rotation.y += dt * clamp(it.r.wind, 0, 40) * 1.1;
        leds.forEach((m, i) => { const col = !it.running ? 0x334155 : i === 0 && weak ? 0xef4444 : 0x22c55e; m.color.setHex(col); m.emissive.setHex(col); m.emissiveIntensity = it.running ? 1 : 0.1; });
        if (invLed) { const c = SCOL[it.status] ?? 0x64748b; invLed.color.setHex(c); invLed.emissive.setHex(c); invLed.emissiveIntensity = it.status === "crit" ? (Math.sin(t * 9) > 0 ? 1.4 : 0.1) : 1; }
        if (screenM) screenM.emissiveIntensity = it.running ? 0.8 : 0.05;
      };
    },
  },

  wind: {
    fam: "renewable", name: "Wind turbine", pre: "WTG",
    params: {
      size: { l: "Size", min: 0.6, max: 2, step: 0.1, v: 1 },
      pad: { l: "Pad-mount transformer", opts: ["Yes", "No"], v: "Yes" },
    },
    tags: (p) => {
      const rated = Math.round(1650 * p.size * p.size / 10) * 10;
      return [
        T("kw", "Active power", "kW", rated, { noise: rated * 0.01, d: 0 }),
        T("ws", "Wind speed", "m/s", 9.5, { off: 9.5, noise: 0.4, warn: 20, crit: 25 }),
        T("wdir", "Wind direction", "°", 240, { off: 240, noise: 1.5, d: 0 }),
        T("yaw", "Nacelle direction", "°", 238, { off: 238, noise: 0.3, d: 0 }),
        T("rpm", "Rotor speed", "rpm", 14.2, { noise: 0.1 }),
        T("gen", "Generator speed", "rpm", 1480, { noise: 5, d: 0 }),
        T("pitch", "Blade pitch", "°", 2, { off: 88, noise: 0.1 }),
        T("gbx", "Gearbox oil temperature", "°C", 58, { off: 35, noise: 0.2, warn: 75, crit: 85, fault: 88 }),
        T("gwdg", "Generator winding temperature", "°C", 85, { off: 35, noise: 0.3, warn: 120, crit: 135, fault: 138 }),
        T("mbrg", "Main bearing temperature", "°C", 46, { off: 30, noise: 0.15, warn: 65, crit: 75 }),
        T("vib", "Nacelle vibration", "mm/s", 1.8, { noise: 0.12, warn: 4.5, crit: 7.1, fault: 7.6 }),
      ];
    },
    main: () => "kw",
    scen: (p) => {
      const rated = 1650 * p.size * p.size;
      return {
        storm: { ws: 27, pitch: 88, rpm: 0.3, gen: 0, kw: 0, vib: 2.6, gbx: 50, gwdg: 60 },
        lowwind: { ws: 3.2, rpm: 6, gen: 620, kw: rated * 0.04, pitch: 0, gbx: 45, gwdg: 55, vib: 0.9 },
      };
    },
    binds: (p) => [
      ["Rotor", "Rotate", "rpm"],
      ["Blades", "Pitch to angle", "pitch"],
      ["Nacelle", "Yaw to direction", "yaw"],
      ["Wind vane", "Point into wind", "wdir"],
      ["Anemometer", "Rotate with wind", "ws"],
      ["Gearbox", "Heat colour", "gbx"],
      ["Generator", "Heat colour", "gwdg"],
      ["Nacelle", "Shake", "vib"],
      ...(p.pad === "Yes" ? [["Power cable", "Flow particles", "kw"]] : []),
      ["Label", "Show value", "kw"],
    ],
    build(p, g) {
      const s = p.size, H = 16 * s, L = 8 * s, white = M(0xe2e8f0, { metalness: 0.2, roughness: 0.55 }), st = M(C.steel);
      // foundation, tower with flanges and door
      const fnd = cyl(1.6 * s, 1.8 * s, 0.3, M(0x6b7280), 28); fnd.position.y = 0.15; g.add(fnd);
      const tower = cyl(0.34 * s, 0.62 * s, H, white, 28); tower.position.y = 0.3 + H / 2; g.add(tower);
      [1 / 3, 2 / 3].forEach((u) => { const r = 0.62 * s - (0.28 * s) * u; const fl = new THREE.Mesh(new THREE.TorusGeometry(r + 0.01, 0.03 * s, 6, 28), M(0xcbd5e1)); fl.rotation.x = PI / 2; fl.position.y = 0.3 + H * u; g.add(fl); });
      const door = box(0.08, 0.9 * s, 0.45 * s, M(C.grey)); door.position.set(0.61 * s, 0.3 + 0.5 * s, 0); g.add(door);

      // nacelle (yaws about the tower axis); +X faces into the wind
      const nac = new THREE.Group(); nac.position.y = 0.3 + H; g.add(nac);
      const yawRing = cyl(0.42 * s, 0.42 * s, 0.18 * s, st, 24); yawRing.position.y = 0.09 * s; nac.add(yawRing);
      const yc = 0.95 * s;
      const cover = box(3.8 * s, 1.5 * s, 1.5 * s, M(0xe2e8f0, { metalness: 0.2, roughness: 0.55, transparent: true, opacity: 0.92 })); cover.position.set(0.3 * s, yc, 0); nac.add(cover);
      const bed = box(3.4 * s, 0.12 * s, 1.1 * s, st); bed.position.set(0.3 * s, yc - 0.6 * s, 0); nac.add(bed);
      // drivetrain: main shaft and bearing, gearbox, brake, high-speed shaft, generator, converter
      const shaft = X(cyl(0.12 * s, 0.12 * s, 1.4 * s, M(0xb8c2d0, { metalness: 0.9, roughness: 0.25 }), 16)); shaft.position.set(1.55 * s, yc, 0); nac.add(shaft);
      const mbM = M(0x4b5768); const mb = X(cyl(0.3 * s, 0.3 * s, 0.45 * s, mbM, 20)); mb.position.set(1.65 * s, yc, 0); nac.add(mb);
      const gbxM = M(0x5b6b80); const gb = box(0.95 * s, 0.95 * s, 0.95 * s, gbxM); gb.position.set(0.6 * s, yc, 0); nac.add(gb);
      const disc = X(cyl(0.34 * s, 0.34 * s, 0.05 * s, M(0x9ca3af, { metalness: 0.8 }), 24)); disc.position.set(-0.05 * s, yc, 0); nac.add(disc);
      const cal = box(0.12 * s, 0.2 * s, 0.14 * s, M(0xdc2626)); cal.position.set(-0.05 * s, yc + 0.3 * s, 0); nac.add(cal);
      const hss = X(cyl(0.06 * s, 0.06 * s, 0.5 * s, M(0xb8c2d0, { metalness: 0.9 }), 12)); hss.position.set(-0.25 * s, yc, 0); nac.add(hss);
      const genM = M(C.blue); const gen = X(cyl(0.42 * s, 0.42 * s, 1.0 * s, genM, 24)); gen.position.set(-0.85 * s, yc, 0); nac.add(gen);
      const conv = box(0.35 * s, 1.0 * s, 0.9 * s, M(0x94a3b8)); conv.position.set(-1.45 * s, yc - 0.1 * s, 0); nac.add(conv);
      const rad = box(0.6 * s, 0.5 * s, 0.08 * s, M(0x64748b)); rad.position.set(-1.2 * s, yc + 1.0 * s, 0); nac.add(rad);
      // anemometer, wind vane and aviation light on the roof
      const mastA = cyl(0.025 * s, 0.025 * s, 0.6 * s, st, 8); mastA.position.set(-1.25 * s, yc + 1.05 * s, 0.4 * s); nac.add(mastA);
      const cups = new THREE.Group(); cups.position.set(-1.25 * s, yc + 1.38 * s, 0.4 * s); nac.add(cups);
      for (let k = 0; k < 3; k++) { const piv = new THREE.Group(); piv.rotation.y = k * 2 * PI / 3; const a = box(0.22 * s, 0.015, 0.015, st); a.position.x = 0.11 * s; piv.add(a); const cup = new THREE.Mesh(new THREE.SphereGeometry(0.05 * s, 10, 8, 0, PI), M(0xf8fafc)); cup.position.x = 0.22 * s; cup.rotation.y = PI / 2; piv.add(cup); cups.add(piv); }
      const mastV = cyl(0.025 * s, 0.025 * s, 0.6 * s, st, 8); mastV.position.set(-1.25 * s, yc + 1.05 * s, -0.4 * s); nac.add(mastV);
      const vane = new THREE.Group(); vane.position.set(-1.25 * s, yc + 1.38 * s, -0.4 * s); nac.add(vane);
      const fin = box(0.4 * s, 0.16 * s, 0.01, M(C.orange)); fin.position.x = -0.2 * s; vane.add(fin);
      const avM = lamp(0xef4444); const av = new THREE.Mesh(new THREE.SphereGeometry(0.08 * s, 12, 12), avM); av.position.set(-0.6 * s, yc + 0.85 * s, 0); nac.add(av);

      // rotor: hub, spinner and three pitching blades
      const rotor = new THREE.Group(); rotor.position.set(2.5 * s, yc, 0); nac.add(rotor);
      const hub = X(cyl(0.38 * s, 0.38 * s, 0.6 * s, white, 24)); rotor.add(hub);
      const spin = lathe([[0, 0.75], [0.15, 0.68], [0.3, 0.45], [0.38, 0.12], [0.38, 0]].map(([r, y]) => [r * s, y * s]), white, 28);
      spin.rotation.z = -PI / 2; spin.position.x = 0.3 * s; rotor.add(spin);
      const bladeM = M(0xf1f5f9, { metalness: 0.15, roughness: 0.45 });
      const pitchers: THREE.Group[] = [];
      for (let i = 0; i < 3; i++) {
        const piv = new THREE.Group(); piv.rotation.x = i * 2 * PI / 3; rotor.add(piv);
        const root = cyl(0.12 * s, 0.14 * s, 0.4 * s, white, 16); root.position.y = 0.45 * s; piv.add(root);
        const pg = new THREE.Group(); pg.position.y = 0.6 * s; piv.add(pg); pitchers.push(pg);
        const bl = bladeMesh(L, 0.75 * s, 0.14 * s, bladeM); pg.add(bl);
        const tip = box(0.02, 0.5 * s, 0.12 * s, M(0xdc2626)); tip.position.set(0, L - 0.25 * s, 0.13 * s); pg.add(tip);
      }

      // pad-mount transformer at the foot of the tower, fed down the tower
      let flow: ReturnType<typeof particles> | null = null;
      if (p.pad === "Yes") {
        const tx = 2.4 * s, tz = 1.6 * s;
        const pad = box(1.4 * s, 0.15, 1.2 * s, M(0x52525b)); pad.position.set(tx, 0.075, tz); g.add(pad);
        const tr = box(1.1 * s, 1.0 * s, 0.9 * s, M(0x4d6b5a)); tr.position.set(tx, 0.15 + 0.5 * s, tz); g.add(tr);
        for (let k = 0; k < 4; k++) { const f2 = box(0.06, 0.7 * s, 0.25 * s, M(0x3f5a4b)); f2.position.set(tx - 0.3 * s + k * 0.2 * s, 0.15 + 0.5 * s, tz + 0.55 * s); g.add(f2); }
        const cab = M(0x1f2937);
        g.add(pipe(P(0.5 * s, 0.25, 0.3 * s), P(tx - 0.55 * s, 0.25, tz), 0.04, cab));
        flow = particles(g, polyline([P(0, 0.3 + H, 0), P(0, 0.4, 0), P(0.5 * s, 0.25, 0.3 * s), P(tx - 0.55 * s, 0.25, tz)]), 22, 0x38bdf8, 0.06 * Math.max(1, s));
      }

      let yawNow = 238, pitchNow = 2, vaneNow = 0;
      const rated = 1650 * s * s;
      return (dt, t, it) => {
        // yaw takes the shortest way round; real nacelles turn slowly
        const dy = angDiff(it.r.yaw, yawNow); yawNow += clamp(dy, -dt * 25, dt * 25);
        nac.rotation.y = (90 - yawNow) * PI / 180;
        const amp = clamp(it.r.vib, 0, 20) * 0.004 * s; nac.position.x = rnd(amp); nac.position.z = rnd(amp);
        rotor.rotation.x -= dt * clamp(it.r.rpm, 0, 40) / 60 * 2 * PI;
        pitchNow += (clamp(it.r.pitch, -5, 95) - pitchNow) * Math.min(1, dt * 1.2);
        pitchers.forEach((pg) => { pg.rotation.y = pitchNow * PI / 180; });
        vaneNow += (angDiff(it.r.wdir, it.r.yaw) - vaneNow) * Math.min(1, dt * 2);
        vane.rotation.y = -vaneNow * PI / 180;
        cups.rotation.y += dt * clamp(it.r.ws, 0, 40) * 1.2;
        heatTo(gbxM, it.r.gbx, 40, 95, 0.9); heatTo(genM, it.r.gwdg, 60, 150, 0.9); heatTo(mbM, it.r.mbrg, 30, 80, 0.9);
        avM.emissiveIntensity = Math.sin(t * PI) > 0.4 ? 1.6 : 0.05;
        flow?.update(dt, (it.running ? 1 : 0) * clamp(it.r.kw / Math.max(1, rated), 0, 1.3) * 3);
      };
    },
  },
};
