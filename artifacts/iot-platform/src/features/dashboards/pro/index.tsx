/**
 * Entry point for the Pro widget set: renderer lookup and the per-type settings
 * editor used by the widget config panel.
 */
import "./pro.css";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { proDef } from "./defs";
import type { ProProps } from "./common";
import { LinePro, BarPro, StackAreaPro, DonutPro, Stream, TodayVs, CalHeat, RangeBand, Waterfall, Forecast, ShiftNotes } from "./charts";
import { GaugePro, KpiTrend, Readout, ThermoPro, LiquidTank, Bullet, Counter, ShiftProgress, EnergyRing, Pump, FanW, Pipe, Valve, ThermalProfile, Spectrum, Iso10816 } from "./instruments";
import { MachineGrid, GridPro, StateTimeline, Connectivity, FloorPlan, SiteMap, Ticker, AlarmPanel, Pareto, Mtbf } from "./status";
import { OeeRings, OeeMachine, Anomaly, AnomalyBoard, HealthScore, Rul, FailRisk, RiskMatrix } from "./analytics";
import { EnergyCost, Co2, Sec, PeakDemand, PowerQuality, Recipe, GoldenBatch } from "./energy";
import { Chiller, KwTr, CoolingTower, AirComp, DraftFan, Boiler, BoilerEff, Combustion, DutyStandby, RefrigPlant, AirDryer, ThermicFluid, SteamCond } from "./equip/utilities";
import { HeatEx, FurnaceZones, Separator, Reactor, TankFarm, GasDetect, FlowBalance, Permissives, SurgeMap, PumpCurve, DistColumn, Pipeline, TurbineGen, Flare, DustCollector } from "./equip/process";
import { Cleanroom, EnvCompliance, Mkt, Sterilizer, ColdRoom, Psychro, PwLoop, Lyophilizer, Ahu, FilterLoad, RoPlant, Etp } from "./equip/compliance";
import { Pue, RackHeat, Ups, DgSet, Transformer, Sld, MotorHealth, MaintDue, SolarPv, BatteryString, RackPdu, LeakFire } from "./equip/power";

export { PRO_CATEGORIES, PRO_TYPES, PRO_MULTI_TYPES, PRO_SINGLE_TYPES, PRO_SCOPE_TYPES, proDef } from "./defs";
export type { ProProps } from "./common";

const RENDERERS: Record<string, (p: ProProps) => React.ReactNode> = {
  linepro: LinePro, barpro: BarPro, stackareapro: StackAreaPro, donutpro: DonutPro, stream: Stream, todayvs: TodayVs,
  calheat: CalHeat, rangeband: RangeBand, waterfall: Waterfall, forecast: Forecast, shiftnotes: ShiftNotes,
  gaugepro: GaugePro, kpitrend: KpiTrend, readout: Readout, thermopro: ThermoPro, liquidtank: LiquidTank, bullet: Bullet,
  counter: Counter, shiftprogress: ShiftProgress, energyring: EnergyRing,
  pump: Pump, fan: FanW, pipe: Pipe, valve: Valve, thermalprofile: ThermalProfile, spectrum: Spectrum, iso10816: Iso10816,
  machinegrid: MachineGrid, gridpro: GridPro, statetimeline: StateTimeline, connectivity: Connectivity, floorplan: FloorPlan, sitemap: SiteMap,
  ticker: Ticker, alarmpanel: AlarmPanel, pareto: Pareto, mtbf: Mtbf,
  oeerings: OeeRings, oeemachine: OeeMachine, anomaly: Anomaly, anomalyboard: AnomalyBoard, healthscore: HealthScore, rul: Rul, failrisk: FailRisk, riskmatrix: RiskMatrix,
  energycost: EnergyCost, co2: Co2, sec: Sec, peakdemand: PeakDemand, powerquality: PowerQuality, recipe: Recipe, goldenbatch: GoldenBatch,
  // Equipment and industry widgets (equip/)
  chiller: Chiller, kwtr: KwTr, coolingtower: CoolingTower, aircomp: AirComp, draftfan: DraftFan, boiler: Boiler, boilereff: BoilerEff,
  combustion: Combustion, dutystandby: DutyStandby, refrigplant: RefrigPlant, airdryer: AirDryer, thermicfluid: ThermicFluid, steamcond: SteamCond,
  heatex: HeatEx, furnacezones: FurnaceZones, separator: Separator, reactor: Reactor, tankfarm: TankFarm, gasdetect: GasDetect, flowbalance: FlowBalance,
  permissives: Permissives, surgemap: SurgeMap, pumpcurve: PumpCurve, distcolumn: DistColumn, pipeline: Pipeline, turbinegen: TurbineGen, flare: Flare,
  dustcollector: DustCollector,
  cleanroom: Cleanroom, envcompliance: EnvCompliance, mkt: Mkt, sterilizer: Sterilizer, coldroom: ColdRoom, psychro: Psychro, pwloop: PwLoop,
  lyophilizer: Lyophilizer, ahu: Ahu, filterload: FilterLoad, roplant: RoPlant, etp: Etp,
  pue: Pue, rackheat: RackHeat, ups: Ups, dgset: DgSet, transformer: Transformer, sld: Sld, motorhealth: MotorHealth, maintdue: MaintDue,
  solarpv: SolarPv, batterystring: BatteryString, rackpdu: RackPdu, leakfire: LeakFire,
};

/**
 * Whether the widget is drawing sample values rather than real data. Most types
 * follow `bound`; a few load their own history, and scope types read alarms or
 * asset health, which are always real.
 */
function isSampleFor(p: ProProps): boolean {
  const c = p.c;
  switch (p.type) {
    case "todayvs": case "calheat": return !(c.assetId && c.tag);
    case "goldenbatch": return !(c.assetId && c.tag && c.refFrom && c.refTo) || !p.bound;
    case "sec": return !p.bound || p.keys.length < 2;
    case "healthscore": return !c.assetId;
  }
  const bind = proDef(p.type)?.bind;
  return (bind === "single" || bind === "multi") && !p.bound;
}

export function ProWidgetView(props: ProProps) {
  const R = RENDERERS[props.type];
  if (!R) return null;
  const sampleMode = isSampleFor(props);
  const need = proDef(props.type)?.need;
  return (
    <div className="h-full w-full flex flex-col">
      <div className="relative flex-1 min-h-0"><R {...props} /></div>
      {/* A footer line rather than an overlay, so it never covers the widget.
          Sample values must never pass for live numbers. */}
      {sampleMode && (
        <p className={`shrink-0 truncate text-[10px] leading-4 px-1 ${need ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} title={need}>
          Sample data{need ? ` · ${need}` : proDef(props.type)?.bind === "scope" ? ". Pick an asset in Edit Widget." : ". Bind a metric in Edit Widget."}
        </p>
      )}
    </div>
  );
}

/** Settings block for one Pro type, rendered inside the widget config panel. */
export function ProFields({ type, draft, set }: { type: string; draft: Record<string, any>; set: (patch: Record<string, any>) => void }) {
  const def = proDef(type);
  if (!def) return null;
  const selCls = "w-full h-8 rounded-md border border-border text-sm px-2 bg-background";
  return (
    <div className="pt-2 mt-1 border-t border-border space-y-2.5">
      {def.need && (
        <p className="text-[11px] leading-snug rounded-md px-2 py-1.5 bg-amber-500/10 text-amber-700 dark:text-amber-400">{def.need}</p>
      )}
      {def.roles && (
        <div className="text-[11px] text-muted-foreground">
          <p className="font-semibold uppercase tracking-wide mb-0.5">Inputs, in order</p>
          <ol className="list-decimal pl-4 space-y-0.5">
            {def.roles.map((r, i) => <li key={i}>{i === 0 ? "Attribute" : `Series ${i}`}: {r}</li>)}
          </ol>
        </div>
      )}
      {def.bindHelp && <p className="text-[11px] text-muted-foreground">{def.bindHelp}</p>}
      {def.fields && def.fields.length > 0 && (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Settings</p>
          {def.fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}</Label>
              {f.kind === "select" ? (
                <select value={draft[f.key] ?? f.options?.[0]?.value ?? ""} onChange={(e) => set({ [f.key]: e.target.value })} className={selCls}>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.kind === "textarea" ? (
                <textarea value={draft[f.key] ?? ""} onChange={(e) => set({ [f.key]: e.target.value })} placeholder={f.placeholder}
                  className="w-full rounded-md border border-border p-2 text-xs font-mono h-20 resize-y bg-background" />
              ) : (
                <Input type={f.kind === "number" ? "number" : f.kind === "datetime" ? "datetime-local" : "text"} value={draft[f.key] ?? ""}
                  onChange={(e) => set({ [f.key]: e.target.value })} placeholder={f.placeholder} className="h-8 text-sm" />
              )}
              {f.help && <p className="text-[11px] text-muted-foreground">{f.help}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
