/* eslint-disable */
// Battery energy storage system (BESS) with its battery management system (BMS)
// for the Live Twin library: a container of battery racks, each rack a stack of
// modules with cell LEDs, a BMS controller, HVAC units, a fire suppression panel
// with strobe, the power conversion system (PCS) and a transformer outside.
//
// Power is signed: positive = discharging to the grid, negative = charging. The
// flow particles run the matching way. Each rack shows its state of charge as a
// fill bar; a module glows by its cell temperature, so a hot module (the start
// of thermal runaway) stands out.
import * as THREE from "three";
import { PI, AMB, clamp, P, C, SCOL, M, glass, lamp, cyl, box, pipe, polyline, particles, heatTo, fanRotor, holder, canvas2d, T } from "./kit";
import type { ModelDef } from "./types";

const WITH_PCS = "PCS and transformer";
const MODS = 8;
const STATE = ["Idle", "Charging", "Discharging", "Fault"];

/** kW per rack (about 250 kWh, 0.5C). */
const rackKw = 125;

export const STORAGE: Record<string, ModelDef> = {
  bess: {
    fam: "renewable", name: "Battery energy storage (BESS)", pre: "BESS",
    params: {
      racks: { l: "Battery racks", min: 2, max: 10, step: 1, v: 6 },
      pcs: { l: "Power conversion", opts: [WITH_PCS, "Container only"], v: WITH_PCS },
    },
    tags: (p) => {
      const rated = (p.racks | 0) * rackKw;
      return [
        T("soc", "State of charge", "%", 68, { off: 68, noise: 0.02, d: 1, low: true, warn: 15, crit: 8 }),
        T("soh", "State of health", "%", 94, { off: 94, noise: 0, d: 1, low: true, warn: 80, crit: 70 }),
        T("kw", "Power (+ discharge, - charge)", "kW", Math.round(rated * 0.55), { noise: rated * 0.006, d: 0 }),
        T("vdc", "DC voltage", "V", 1180, { off: 1250, noise: 1, d: 0, low: true, warn: 1000, crit: 950 }),
        T("idc", "DC current", "A", Math.round(rated * 0.55 * 1000 / 1180), { noise: 1, d: 0 }),
        T("vmax", "Max cell voltage", "V", 3.34, { off: 3.33, noise: 0.002, d: 3, warn: 3.55, crit: 3.65, fault: 3.68 }),
        T("vmin", "Min cell voltage", "V", 3.31, { off: 3.31, noise: 0.002, d: 3, low: true, warn: 2.9, crit: 2.7 }),
        T("dv", "Cell voltage spread", "mV", 28, { off: 20, noise: 0.8, d: 0, warn: 80, crit: 150, fault: 190 }),
        T("tmax", "Max cell temperature", "°C", 31, { off: 26, noise: 0.1, warn: 45, crit: 55, fault: 68 }),
        T("tmin", "Min cell temperature", "°C", 26, { off: 24, noise: 0.1 }),
        T("tdel", "Rack temperature spread", "°C", 3.5, { off: 2, noise: 0.1, warn: 8, crit: 12, fault: 15 }),
        T("iso", "Insulation resistance", "kΩ", 2400, { off: 2500, noise: 10, d: 0, low: true, warn: 500, crit: 100 }),
        T("hvac", "HVAC supply temperature", "°C", 21, { off: 22, noise: 0.1, warn: 28, crit: 32 }),
        T("cyc", "Cycle count", "", 742, { off: 742, noise: 0, d: 0 }),
        T("state", "BMS state", "", 2, { off: 0, noise: 0, d: 0, warn: 2.5, crit: 2.9, fault: 3 }),
      ];
    },
    main: () => "soc",
    scen: (p) => {
      const rated = (p.racks | 0) * rackKw;
      return {
        charge: { kw: -rated * 0.6, idc: -rated * 0.6 * 1000 / 1290, state: 1, soc: 90, vdc: 1290, vmax: 3.42, vmin: 3.38, dv: 34, tmax: 33, tmin: 27, hvac: 20 },
        discharge: { kw: rated * 0.85, idc: rated * 0.85 * 1000 / 1150, state: 2, soc: 30, vdc: 1150, vmax: 3.27, vmin: 3.22, dv: 46, tmax: 36, tmin: 28, hvac: 19 },
      };
    },
    binds: (p) => [
      ["Rack SOC bars", "Fill to state of charge", "soc"],
      ["Battery modules", "Heat colour by cell temperature", "tmax"],
      ["Cell LEDs", "Light by state of charge", "soc"],
      ["Fire panel strobe", "Blink on fault", "state"],
      ["HVAC fans", "Rotate with cooling demand", "tmax"],
      ["BMS display", "Show SOC, power, state", "soc"],
      ...(p.pcs === WITH_PCS ? [["DC and AC cables", "Flow particles, direction by charge or discharge", "kw"], ["PCS fan", "Rotate with power", "kw"]] : []),
      ["Label", "Show value", "soc"],
    ],
    build(p, g) {
      const R = p.racks | 0, withPcs = p.pcs === WITH_PCS;
      const rw = 0.62, L = R * (rw + 0.12) + 2.6, Wd = 2.44, H = 2.6;
      const x0 = -L / 2;
      // container shell: floor, roof, back and end walls solid, front wall glazed so the racks show
      const shellM = M(0xe5e7eb, { metalness: 0.35, roughness: 0.6 });
      const floor = box(L, 0.15, Wd, M(0x52525b)); floor.position.set(0, 0.2, 0); g.add(floor);
      const roof = box(L, 0.08, Wd, shellM); roof.position.set(0, 0.2 + H, 0); g.add(roof);
      const back = box(L, H, 0.06, shellM); back.position.set(0, 0.2 + H / 2, -Wd / 2); g.add(back);
      [-1, 1].forEach((sd) => { const end = box(0.06, H, Wd, shellM); end.position.set(sd * L / 2, 0.2 + H / 2, 0); g.add(end); });
      const front = box(L, H, 0.02, glass(0xbfd4e6, 0.14)); front.position.set(0, 0.2 + H / 2, Wd / 2); g.add(front);
      for (let k = 0; k <= Math.ceil(L / 1.2); k++) { const rib = box(0.05, H, 0.04, M(0xd1d5db)); rib.position.set(x0 + Math.min(L, k * 1.2), 0.2 + H / 2, -Wd / 2 - 0.03); g.add(rib); }
      [-1, 1].forEach((sd) => [-1, 1].forEach((sz) => { const blk = box(0.4, 0.2, 0.4, M(0x6b7280)); blk.position.set(sd * (L / 2 - 0.4), 0.1, sz * (Wd / 2 - 0.4)); g.add(blk); }));
      // door at the left end
      const door = box(0.04, 2.0, 0.9, M(C.grey)); door.position.set(x0 - 0.02, 0.2 + 1.1, 0.5); g.add(door);

      // battery racks: modules with a heat-coloured front and four cell LEDs, plus a SOC bar
      const ledOn = lamp(0x22c55e), ledOff = new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0x000000 }), ledHot = lamp(0xef4444);
      const modM: THREE.MeshStandardMaterial[] = [], modF: number[] = [], leds: THREE.Mesh[][] = [];
      const socBars: THREE.Mesh[] = [], socM: THREE.MeshStandardMaterial[] = [];
      const hotIdx = Math.floor(R / 2) * MODS + 3;
      const rackX0 = x0 + 1.6;
      for (let r = 0; r < R; r++) {
        const x = rackX0 + r * (rw + 0.12) + rw / 2;
        const frame = box(rw, 2.2, 0.75, M(0x1f2937)); frame.position.set(x, 0.28 + 1.1, -Wd / 2 + 0.5); g.add(frame);
        for (let m = 0; m < MODS; m++) {
          const i = r * MODS + m;
          const mm = M(0x334155, { emissive: 0x000000, metalness: 0.3 }); modM.push(mm);
          // fixed spread of module temperatures between min and max cell temperature
          modF.push(i === hotIdx ? 1 : ((i * 37) % 11) / 18);
          const mod = box(rw - 0.06, 0.2, 0.04, mm); mod.position.set(x, 0.45 + m * 0.25, -Wd / 2 + 0.89); g.add(mod);
          const row: THREE.Mesh[] = [];
          for (let k = 0; k < 4; k++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), ledOff); l.position.set(x - 0.2 + k * 0.06, 0.45 + m * 0.25, -Wd / 2 + 0.915); g.add(l); row.push(l); }
          leds.push(row);
        }
        const barBg = box(0.06, 2.0, 0.02, M(0x0f172a)); barBg.position.set(x + rw / 2 - 0.06, 0.38 + 1.0, -Wd / 2 + 0.9); g.add(barBg);
        const bm = lamp(0x22c55e); socM.push(bm);
        const barG = new THREE.BoxGeometry(0.045, 1, 0.025); barG.translate(0, 0.5, 0);
        const bar = new THREE.Mesh(barG, bm); bar.position.set(x + rw / 2 - 0.06, 0.38, -Wd / 2 + 0.91); g.add(bar); socBars.push(bar);
      }
      // DC busbar along the top of the racks
      g.add(pipe(P(rackX0, 2.55, -Wd / 2 + 0.5), P(rackX0 + R * (rw + 0.12), 2.55, -Wd / 2 + 0.5), 0.04, M(0xb45309)));

      // BMS controller cabinet with display, next to the door
      const bmsX = x0 + 0.75;
      const bms = box(0.8, 2.0, 0.6, M(0xd1d5db, { metalness: 0.3 })); bms.position.set(bmsX, 0.28 + 1.0, -Wd / 2 + 0.4); g.add(bms);
      const { cv, x: ctx } = canvas2d(256, 160); const scrTex = new THREE.CanvasTexture(cv);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshStandardMaterial({ map: scrTex, emissive: 0xffffff, emissiveMap: scrTex, emissiveIntensity: 0.85 }));
      scr.position.set(bmsX, 1.75, -Wd / 2 + 0.705); g.add(scr);
      const bmsLed = lamp(0x22c55e); const bl = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), bmsLed); bl.position.set(bmsX + 0.28, 1.45, -Wd / 2 + 0.71); g.add(bl);

      // fire suppression panel with strobe, on the back wall by the door
      const fire = box(0.45, 0.55, 0.12, M(0xb91c1c)); fire.position.set(bmsX, 1.3, Wd / 2 - 0.2); g.add(fire);
      const strobeM = lamp(0xf87171); strobeM.emissiveIntensity = 0.05;
      const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10, 0, 2 * PI, 0, PI / 2), strobeM); strobe.position.set(bmsX, 0.2 + H + 0.04, 0); g.add(strobe);
      const cyl1 = cyl(0.12, 0.12, 0.9, M(0xdc2626), 16); cyl1.position.set(bmsX - 0.25, 0.28 + 0.45, Wd / 2 - 0.25); g.add(cyl1);

      // HVAC units on the right end wall, with spinning condenser fans
      const fans: THREE.Group[] = [];
      [-0.6, 0.6].forEach((z) => {
        const u = box(0.45, 1.1, 0.9, M(0xf1f5f9, { metalness: 0.2 })); u.position.set(L / 2 + 0.25, 1.3, z); g.add(u);
        const fan = fanRotor(4, 0.3, 0.06, C.dark); const fh = holder("x", fan); fh.position.set(L / 2 + 0.49, 1.45, z); g.add(fh); fans.push(fan);
        const grill = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.02, 6, 24), M(C.dark)); grill.rotation.y = PI / 2; grill.position.set(L / 2 + 0.49, 1.45, z); g.add(grill);
      });

      // PCS (inverter) and transformer outside, with cables
      let dcF: ReturnType<typeof particles> | null = null, dcR: ReturnType<typeof particles> | null = null;
      let acF: ReturnType<typeof particles> | null = null, acR: ReturnType<typeof particles> | null = null;
      let pcsFan: THREE.Group | null = null, pcsLed: THREE.MeshStandardMaterial | null = null;
      if (withPcs) {
        const zP = Wd / 2 + 2.0, xP = -0.6, xT = 2.0, cab = M(0x1f2937);
        const pl = box(2.0, 0.15, 1.2, M(0x52525b)); pl.position.set(xP, 0.075, zP); g.add(pl);
        const pcs = box(1.7, 2.0, 1.0, M(0xe5e7eb, { metalness: 0.25 })); pcs.position.set(xP, 1.15, zP); g.add(pcs);
        for (let k = 0; k < 6; k++) { const lv = box(1.1, 0.04, 0.02, M(C.grey)); lv.position.set(xP, 0.5 + k * 0.12, zP + 0.51); g.add(lv); }
        pcsFan = fanRotor(5, 0.26, 0.08); const fh = holder("y", pcsFan); fh.position.set(xP, 2.2, zP); g.add(fh);
        pcsLed = lamp(0x22c55e); const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), pcsLed); led.position.set(xP + 0.5, 1.7, zP + 0.51); g.add(led);
        const tank = box(1.3, 1.3, 1.1, M(0x4d6b5a)); tank.position.set(xT, 0.8, zP); g.add(tank);
        const tpl = box(1.7, 0.15, 1.5, M(0x52525b)); tpl.position.set(xT, 0.075, zP); g.add(tpl);
        for (let k = 0; k < 5; k++) [-1, 1].forEach((sd) => { const fin = box(0.06, 1.0, 0.3, M(0x3f5a4b)); fin.position.set(xT - 0.45 + k * 0.22, 0.8, zP + sd * 0.7); g.add(fin); });
        for (let k = 0; k < 3; k++) { const bu = cyl(0.06, 0.08, 0.4, M(0xc2410c), 10); bu.position.set(xT - 0.4 + k * 0.4, 1.65, zP); g.add(bu); }
        const dcPts = [P(0, 0.35, Wd / 2), P(0, 0.35, zP - 0.6), P(xP, 0.35, zP - 0.6)];
        const acPts = [P(xP + 0.85, 0.5, zP), P(xT - 0.65, 0.5, zP)];
        for (let i = 0; i < dcPts.length - 1; i++) g.add(pipe(dcPts[i], dcPts[i + 1], 0.05, cab));
        g.add(pipe(acPts[0], acPts[1], 0.05, cab));
        dcF = particles(g, polyline(dcPts), 12, 0xfbbf24, 0.06); dcR = particles(g, polyline([...dcPts].reverse()), 12, 0xfbbf24, 0.06);
        acF = particles(g, polyline(acPts), 8, 0x38bdf8, 0.06); acR = particles(g, polyline([...acPts].reverse()), 8, 0x38bdf8, 0.06);
      }

      let lastDraw = -1;
      const rated = Math.max(1, R * rackKw);
      return (dt, t, it) => {
        const soc = clamp(it.r.soc, 0, 100), on = it.running;
        const fault = it.r.state >= 2.9 || it.r.tmax >= 55;
        const barCol = soc < 8 ? 0xef4444 : soc < 15 ? 0xf59e0b : 0x22c55e;
        socBars.forEach((b, i) => { b.scale.y = Math.max(0.01, soc / 100 * 2.0) * (1 + ((i * 13) % 5 - 2) * 0.004); socM[i].color.setHex(barCol); socM[i].emissive.setHex(barCol); });
        const lit = on ? Math.ceil(soc / 25) : 0;
        const tmin = it.r.tmin, tmax = it.r.tmax;
        modM.forEach((m, i) => {
          const temp = tmin + (tmax - tmin) * modF[i];
          if (temp > 38) heatTo(m, temp, 30, 75, 1);
          else m.emissive.setHex(it.r.state >= 0.5 && it.r.state < 1.5 && on ? 0x0b2a4a : 0x000000);
          const hot = temp >= 55;
          leds[i].forEach((l, k) => { l.material = hot ? (Math.sin(t * 10) > 0 ? ledHot : ledOff) : k < lit ? ledOn : ledOff; });
        });
        // charging pulses the LEDs blue-ish green, discharging steady
        ledOn.emissiveIntensity = it.r.state >= 0.5 && it.r.state < 1.5 ? 0.6 + 0.6 * Math.abs(Math.sin(t * 2)) : 1;
        strobeM.emissiveIntensity = fault ? (Math.sin(t * 12) > 0.3 ? 2 : 0.05) : 0.05;
        const cool = clamp((tmax - 20) / 20, 0.15, 1.5);
        fans.forEach((fn) => { fn.rotation.y += dt * 12 * cool; });
        const k = it.r.kw / rated, sp = on ? clamp(Math.abs(k), 0, 1.3) * 1.8 : 0;
        dcF?.update(dt, k > 0.01 ? sp : 0); dcR?.update(dt, k < -0.01 ? sp : 0);
        acF?.update(dt, k > 0.01 ? sp : 0); acR?.update(dt, k < -0.01 ? sp : 0);
        if (pcsFan) pcsFan.rotation.y += dt * (on ? 4 + 12 * Math.abs(k) : 0);
        const sc = SCOL[it.status] ?? 0x64748b;
        [pcsLed, bmsLed].forEach((m) => { if (!m) return; m.color.setHex(sc); m.emissive.setHex(sc); m.emissiveIntensity = it.status === "crit" ? (Math.sin(t * 9) > 0 ? 1.4 : 0.1) : 1; });
        if (lastDraw < 0 || t - lastDraw >= 0.5) {
          lastDraw = t;
          const st = STATE[clamp(Math.round(it.r.state), 0, 3)] ?? "";
          ctx.fillStyle = "#03110e"; ctx.fillRect(0, 0, 256, 160);
          if (on) {
            ctx.fillStyle = fault ? "#f87171" : "#5eead4"; ctx.textBaseline = "top";
            ctx.font = "16px monospace"; ctx.fillText("BMS  " + st.toUpperCase(), 10, 8);
            ctx.font = "bold 46px monospace"; ctx.fillText(soc.toFixed(1) + "%", 10, 30);
            ctx.font = "18px monospace";
            ctx.fillText(`P ${Math.round(it.r.kw)} kW`, 10, 86);
            ctx.fillText(`Tmax ${tmax.toFixed(1)} C`, 10, 108);
            ctx.fillText(`dV ${Math.round(it.r.dv)} mV`, 10, 130);
            ctx.fillStyle = "#1e293b"; ctx.fillRect(200, 30, 40, 110);
            ctx.fillStyle = soc < 15 ? "#f59e0b" : "#22c55e"; ctx.fillRect(200, 30 + 110 * (1 - soc / 100), 40, 110 * soc / 100);
          }
          scrTex.needsUpdate = true;
        }
      };
    },
  },
};
