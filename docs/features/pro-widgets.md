# Expanded widget library ("Pro" widgets)

The Visualization widget library has 104 more widgets on top of the original set, in thirteen library groups:

- 52 general widgets: Charts Pro, Instruments, Equipment, Plant Status, Alarms & Operations, Analytics, Energy and Process.
- 52 equipment and industry widgets: Utilities, Process Equipment, Pharma & Cold Chain, HVAC & Water, and Power & Facility. These were previewed as Sets 6–12 of the widget gallery.

## Where the code is

| Path | Holds |
|---|---|
| `artifacts/iot-platform/src/features/dashboards/pro/defs.ts` | Catalogue: type key, label, icon, size, binding kind, settings fields, data-needed text |
| `pro/charts.tsx` | Charts Pro |
| `pro/instruments.tsx` | Instruments and Equipment |
| `pro/status.tsx` | Plant Status, Alarms & Operations |
| `pro/analytics.tsx` | Analytics |
| `pro/energy.tsx` | Energy and Process |
| `pro/common.tsx` | Shared props, helpers, sample data |
| `pro/index.tsx` | Renderer lookup, "Sample data" footer, settings editor (`ProFields`) |
| `pro/pro.css` | Animations, all switched off under `prefers-reduced-motion` |
| `pro/equip/defs.ts` | Catalogue of the equipment widgets, with named inputs (`roles`) |
| `pro/equip/kit.tsx` | Shared drawing parts and input helpers for the equipment widgets |
| `pro/equip/utilities.tsx` | Chiller, kW/TR, cooling tower, air compressor, draft fan, boiler, boiler efficiency, combustion, duty/standby, refrigeration, air dryer, thermic fluid, steam & condensate |
| `pro/equip/process.tsx` | Heat exchanger, furnace zones, separator, reactor, tank farm, gas detection, flow balance, permissives, surge map, pump curve, distillation column, pipeline, turbine, flare, dust collector |
| `pro/equip/compliance.tsx` | Cleanroom cascade, temperature/RH compliance, MKT, sterilizer F₀, cold room, psychrometric chart, PW/WFI loop, lyophilizer, AHU, filter loading, RO, ETP/STP |
| `pro/equip/power.tsx` | PUE, rack heatmap, UPS, DG set, transformer, single-line diagram, motor health, maintenance due, solar PV, battery string, rack PDU, leak & fire panel |

`registry.tsx` adds the groups to the library and hands Pro types to `ProWidgetView`. `WidgetConfigPanel.tsx` shows the existing Data Source editors for them, plus `ProFields`.

## Compatibility

- Every original widget keeps its type, config and look. The improved versions (Line Chart Pro, Radial Gauge Pro, Liquid Tank, and so on) are new types beside them, so saved dashboards render as before.
- One switch hides the whole set: `VITE_DISABLE_PRO_WIDGETS=true` at build time (`FEATURES.proWidgets` in `lib/features.ts`). A dashboard that holds a Pro widget then shows a "not available" placeholder. Turning the switch back on restores it.

## Binding kinds

| Kind | Editor | Used by |
|---|---|---|
| single | Data Source + Attribute | gauge, tank, pump, energy cost, forecast, … |
| multi | Primary attribute + overlay series (each with its own asset) | grids, timelines, OEE, bullet, ring, … |
| scope | Optional asset; covers that asset and everything below it | ticker, alarm panel, pareto, MTBF, connectivity, health score |
| none | Nothing | multi-site map |

A widget with nothing bound draws sample values with a "Sample data" footer line, so sample numbers never pass for live ones. Where a widget depends on data or settings a plant may not have, the footer and the Edit Widget panel say what is needed.

## Equipment widgets: named inputs

Most equipment widgets have a fixed list of inputs, for example Chiller Plant: 1 CHW supply temperature, 2 CHW return temperature, 3 CHW flow, 4 chiller power, 5 condenser water in, 6 condenser water out. They use the multi-series editor: the Attribute is input 1 and each added series is the next input. Edit Widget labels every input with its meaning, and the **Add** button names the next one.

The renderer reads input *i* from series `s{i}`. An input left empty shows "—", and the other inputs keep their meaning. Values worked out from missing inputs (TR, kW/TR, efficiency) also show "—".

List widgets have no fixed inputs: one series per tank, detector, zone, rack, cell, filter or machine, named after its asset. These are Tank Farm, Gas Detection, Furnace Zones, Duty/Standby, Cleanroom, Rack Heatmap, Rack PDU (in A/B pairs), Battery String, Filter Loading, Maintenance Due, Permissives, Single-Line Diagram and Leak & Fire.

Gas Detection, Permissives and Leak & Fire only display status. They never replace a safety or fire system.

## Where the numbers come from

No server changes were needed. Everything uses existing endpoints:

- Telemetry series: `/api/telemetry/:id`, `/api/system/aggregate` (through `useSeriesSet` / `useTelemetrySeries`).
- Open alarms and acknowledge: `/api/alarms`, `POST /api/alarms/:id/acknowledge` (CSRF via the generated client). The Acknowledge button only appears for users with `acknowledge_alarms`; the server still decides.
- Alarm history (Pareto, MTBF/MTTR): `/api/alarms/history` over the widget's time range.
- Asset health (Health Score, Device Connectivity): `/api/assets/:id/health`.

Analytics are worked out in the browser and kept simple and explainable:

| Widget | Method |
|---|---|
| Anomaly Detection Chart | Rolling mean ± k standard deviations over the previous N points |
| Anomaly Scoreboard | How many standard deviations the latest value is from the range average |
| Forecast Chart | Straight-line trend plus hour-of-day pattern; band ±2 residual standard deviations, widening with distance |
| Remaining Useful Life | Straight-line fit of the recent half of the range, projected to the failure limit |
| Failure Risk / Risk Matrix | Closeness to warn/critical limits plus unusualness, raised by open alarms |
| Machine Health Score | 100 minus 15 per open alarm (25 if critical/high), scaled by data freshness |
| MTBF / MTTR | Alarms in range count as failures, raised to cleared |
| Energy Cost / CO₂ / SEC | Rise of a meter total (or sum of per-reading energy) times the tariff, factor or production count |
| Chiller TR | CHW flow (m³/h) × ΔT × 0.3307 |
| Boiler efficiency | 100 − (Siegert dry flue gas loss from O₂ and temperatures + the other losses set in Edit Widget) |
| Refrigeration saturation | Curve fit per refrigerant (R717, R134a, R404A, R22), approximate |
| MKT | Haynes formula over the readings in the time range, ΔH settable (default 83.144 kJ/mol) |
| Sterilizer F₀ | Sum of Δt × 10^((T − 121.1)/z) over the time range |
| Reactor rate of rise | Straight-line fit of mass temperature over the last 10 minutes |
| Tank days of stock, filter days to change, heat-exchanger cleaning | Straight-line trend over the time range |
| Pump efficiency | Flow × head / (367 × power) |

## Known limits

- OEE needs Availability, Performance and Quality in percent. Performance and Quality need production and good counts that devices do not send yet.
- Shift Notes are saved with the dashboard and added in Edit Widget. Adding a note by clicking the chart needs a notes table on the server, which is not built.
- Multi-site Map is a schematic layout of projects. A geographic map needs site locations and internet map tiles.
- A server-side anomaly, forecast or failure model would be more accurate than the browser calculations above.
- Several equipment widgets need settings from datasheets or permits: the compressor surge line, pump BEP and shut-off head, tank capacities, filter clean/change ΔP, service intervals, ETP consent limits, and furnace set points.
- RO permeate flow is compared with the start of the range without temperature correction.
- The pipeline's expected gradient is a straight line between the first and last station.
