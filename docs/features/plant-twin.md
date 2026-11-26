# 3D plant twins

Live Twin is its own entry in the main navigation, after Data Studio. The page (`/live-twin`) shows one twin type at a time, picked from a **Twin type** dropdown next to the title, in this order: **2D twin**, **Asset twin**, **Process twin**, **Plant twin**, **3D Builder**, **Map view**. The open twin's toolbar sits on the same row: **New** (once a twin is saved), **Add twin** (machine library), rename, delete, Demo values, live status, refresh, labels, **Fit** (frames everything and returns to the starting angle), full screen, **Playback**, PNG snapshot and, last, **Save**. **Kiosk** (right of the toolbar) is described under [Kiosk mode](#kiosk-mode). **Back** stays inside Live Twin: it returns to the twin type or twin opened before, and from the first one goes to Home. (Visualization's Back likewise goes to the parent dashboard, then Home; Live Feed and Asset Template go to Home. None of them opens the Data Studio card page any more.)

The **Save** button shows the save state by colour: orange = not saved yet (or the last save failed), light orange = unsaved changes, grey = everything is saved. Edits are not saved on a timer: the button stays light orange until **Save** is pressed. Unsaved changes are still written when another twin is opened or the view is closed, and the browser warns before the page is reloaded or closed with unsaved changes. **New** is outlined in orange.

The panel on the left lists the saved twins of that type for the open project as a folder tree, like the Visualization dashboard panel: create folders (and folders inside folders) with the folder button, rename or delete them on hover, and drag a twin or folder onto a folder, or onto "Top level", to move it. Clicking a folder selects it; **Save** then stores a new twin in that folder. Deleting a folder keeps its contents, which move up one level. Folders are stored as `plant_twins` rows with `scene.kind = "folder"`; a twin's folder is `scene.parent` (no extra column). 2D twins and process twins use the same folders. The last type and the panel state are remembered per browser.

While Demo values are on, the asset, plant and Builder views show a **Scenario** panel with only the scenarios that apply to the machines on the floor: Normal running and Machine fault always (each model's built-in fault values), Bearing overheat when there is a rotating machine, Cavitation and Pump trip only when there is a pump, Cloud cover when there is a solar PV plant, Storm / high wind when there is a solar PV plant or wind turbine, Low wind when there is a wind turbine, and Battery charging / Battery discharging when there is a battery storage system. Models can declare their own scenario values (`scen` in `ModelDef`). Cavitation raises vibration and drops flow on pumps, Bearing overheat drives temperatures on rotating machines past their limits, Pump trip stops the pumps. Scenarios move demo values only; linked readings always show plant data.

The Asset twin and 3D Builder show the library as a panel on the left: every machine as a tile with a 3D picture, grouped and searchable, with the close-up twins (and, in the Builder, the industry template) at the top, like the Process twin symbols. Drag a tile onto the 3D view or click it. **Add twin** shows or hides the panel (remembered per browser); clicking a machine shows its **Data Source** panel on the right. The earlier list on the right is kept: build with `VITE_TWIN_LIBRARY_LIST=true` to use it.

The 3D views have **X-ray**, **Auto-rotate** and **Heat map** buttons in the top right corner. Heat map tints each machine from blue to red by its temperature readings against their limits (machines without a temperature reading use their status). The process twin is a 2D diagram, so it has Heat map only (cooler and reactor by temperature, pump by status).

| Type | What | Stored as |
|---|---|---|
| Asset twin | Any machines from the library on a free 3D floor. The view starts empty; **Add twin** opens the library (83 machines in 14 groups, searchable) on the left. Drag a machine onto the 3D view or click it, then connect its data source. No industry template, areas or stages | `plant_twins`, `scene.kind = "asset"` |
| Asset twin, detailed pump skid | Chosen from the top of the library. One pump skid in close-up (X-ray, heat map, pins), six readings each linked to an asset metric. Listed with the asset twins as "Detailed pump skid" | `plant_twins`, `scene.kind = "machine"` |
| Asset twin, close-up | **Detailed wind turbine**, **Detailed solar PV plant** and **Detailed battery storage (BMS)** at the top of the library. Each opens a new, unsaved asset twin with only that machine, framed close, demo values on; link it and Save (for a single-machine POC) | `plant_twins`, `scene.kind = "asset"` |
| Process twin | P&ID builder: draw your own diagram from 114 symbols (plus your own uploaded symbols), connect with pipes, link tag bubbles to asset metrics, or start from one of eight industry templates (see [Process twin builder](#process-twin-builder)) | `plant_twins`, `scene.kind = "process"`, `scene.version = 2` |
| Plant twin | Saved plants in 3D, view only and large, with a demo **Scenario** panel, **Live tags · plant** and a legend. With no saved plant it shows a sample plant. **Edit in 3D Builder** opens the plant in the Builder | `plant_twins`, `scene.kind` absent or `"plant"` |
| 3D Builder | The plant editor described below. It starts with an empty floor: **Add twin** opens the library with an **Industry template** dropdown and **Load** at the top (replacing machines already on the floor asks first), and single machines below. Lists the same plants as Plant twin, in the same folders | same as Plant twin |
| 2D twin | A drawing (SVG) or any image whose parts or drawn regions are mapped to readings (see [2D twin](#2d-twin)) | `plant_twins`, `scene.kind = "image"` |
| Map view | Every project the user may open, on a map, with status and alarms (see [Map view](#map-view)) | location in the project's attributes |

### Which types a customer gets

Each company has its own installation, so the types offered are set when the frontend is built, with a comma-separated list in dropdown order:

```bash
VITE_LIVE_TWIN_TYPES=asset pnpm --filter @workspace/iot-platform build            # asset twin only
VITE_LIVE_TWIN_TYPES=process,plant pnpm --filter @workspace/iot-platform build    # process and plant
```

Values: `image` (2D twin), `asset`, `process`, `plant`, `builder` (3D Builder), `map` (Map view). Unset, empty or unknown values mean all six. Offer `plant` together with `builder` unless the plants are built for the customer. With one type the dropdown is replaced by that type's name. This only decides what the page shows; twins of other types already saved stay in the database and the API does not refuse them.

The earlier layout, with the views as tabs, is kept: build with `VITE_LIVE_TWIN_TABS=true` to use it instead. The earlier 2D twin (photo with pins, saved in the browser) and the earlier fixed process diagram are also kept: build with `VITE_LIVE_TWIN_CLASSIC=true` to use them instead of the new 2D twin and the Process twin builder.

On the Asset and Process twins, "Link all readings to one asset" matches every reading to that asset's metrics by name; each match can be changed per reading. With Demo values on, the demo scenarios (normal, cavitation, bearing overheat, pump trip) and the valve slider move the readings that are not linked. All three 3D views share the same live-value, demo-value and saving rules described below.

The 3D mode is behind the `plantTwin3d` switch in `artifacts/iot-platform/src/lib/features.ts`. It is on by default. Build with `VITE_DISABLE_PLANT_TWIN_3D=true` to show only image twins; saved 3D twins stay in the database.

## What a twin is

A twin is one plant, organised as **industry → process area → sub-process → machine → readings**:

- **Industry templates** (`engine/packs.ts`): textile mill, integrated steel plant, oil & gas (upstream), refinery, cement, chemical, pharma (oral solid dose), cold chain, power & energy, data center, glass & plastics, tank farm & terminal, water & effluent treatment. A template is data only: areas in process order, sub-processes, machines, which utility feeds which area, and the material flow between areas.
- **Machine models** (`engine/models.ts`): 83 models in 14 groups (rotating, vessels, thermal, material handling, textile, iron & steel, oil & gas, pharma, water, electrical, instruments & meters, renewable energy, HVAC, other). The solar PV plant and wind turbine live in `engine/renewables.ts`, the battery storage system in `engine/storage.ts` and the instruments in `engine/instruments.ts` (see below). Each is built in code from simple shapes and has settings (size, length, number of zones, type), so changing a setting rebuilds the model. Each declares the readings it understands and how its parts move with them.
- **Layout**: areas left to right in process order, sub-processes as columns, parallel machines side by side. Areas wrap to a new row past about 75 m.

With no twin yet, or after **New 3D twin**, the page opens a **draft**: a template laid out and fully editable but not saved. The **Industry** picker at the top of the side panel switches templates (on a saved twin it asks first, because it replaces the layout). **Save as twin** stores the draft with its changes.

If the API answers `503 plant_twins_table_missing`, the table has not been created: run `pnpm --filter @workspace/db run push`.

Users can untick stages a plant does not have (the layout is rebuilt; machines keep their settings and asset links), drag, rotate, duplicate and delete machines, add machines from the palette to any area, and draw pipes or cables between machines.

## Solar PV plant and wind turbine

Both are in the library group **Renewable energy** and work in the Asset twin, Plant twin and 3D Builder like any other machine. They are defined in `engine/renewables.ts`.

**Solar PV plant** (`solar`, prefix PV). Settings: Rows (1-6), Panels per row (4-16), Mounting (Fixed tilt or Single-axis tracker), Balance of system (Combiner, inverter, transformer, weather station, or Panels only).

| Component | What moves it |
|---|---|
| Module rows with cell grid, purlins or torque tube, posts | Panels brighten with Irradiance |
| Single-axis tracker (slew drive per row) | Rows tilt to Tracker angle; they stow flat when Wind speed reaches 18 m/s |
| Faulty string (last three panels of row 1) | Blinks red when String current is below 60 % of what the irradiance should give, or Performance ratio is below 75 % |
| Combiner box, one LED per string | LED of the faulty string turns red; all LEDs off when stopped |
| DC cables to the combiner and inverter | Yellow particles flow with DC power |
| Inverter with louvres, cooling fan, display and status LED | Fan turns with AC output; LED shows the machine status (blinks on critical) |
| AC cable and transformer (radiator fins, bushings) | Blue particles flow with AC output |
| Weather station: pyranometer, anemometer, wind vane | Anemometer turns with Wind speed |

Readings: AC output, DC power, Irradiance, Performance ratio (alarm low), String current, DC voltage (alarm low), Module temperature, Ambient temperature, Inverter temperature, Inverter efficiency (alarm low), Wind speed, and Tracker angle when the tracker is chosen. Machine fault drives a string fault with a hot spot.

**Wind turbine** (`wind`, prefix WTG). Settings: Size (0.6-2; 1 is a 16 m tower with 8 m blades, rated power scales with size squared, 1650 kW at 1) and Pad-mount transformer (Yes or No).

| Component | What moves it |
|---|---|
| Foundation, tapered tower with flanges and door | - |
| Nacelle with yaw ring | Turns to Nacelle direction (shortest way, at most 25 degrees per second); shakes with Nacelle vibration |
| Hub, spinner and three tapered blades with red tips | Rotor turns with Rotor speed; each blade pitches to Blade pitch (88 degrees = feathered) |
| Drivetrain inside the nacelle (see with X-ray): main shaft and bearing, gearbox, brake disc and caliper, high-speed shaft, generator, converter, cooler | Main bearing, gearbox and generator glow with their temperatures |
| Anemometer and wind vane on the roof | Anemometer turns with Wind speed; vane points along Wind direction relative to the nacelle |
| Aviation light | Blinks red |
| Pad-mount transformer and cable down the tower | Particles flow with Active power |

Readings: Active power, Wind speed (warning 20, critical 25 m/s cut-out), Wind direction, Nacelle direction, Rotor speed, Generator speed, Blade pitch, Gearbox oil temperature, Generator winding temperature, Main bearing temperature, Nacelle vibration. Machine fault drives a drivetrain fault (gearbox and generator overheat, high vibration).

Demo scenarios added for them: **Cloud cover** (solar: irradiance and output drop), **Storm / high wind** (wind turbine feathers and stops; trackers stow), **Low wind** (wind turbine runs slowly at low power).

The earlier "Solar array" model keeps its type key, so saved twins open as the Solar PV plant with their rows and panels; they now also show the balance-of-system equipment on the right of the array (choose "Panels only" for the previous look).

## Data source: how data reaches a twin

A twin never connects to devices itself. The chain is:

1. A device sends telemetry through Integration Hub (HTTP `POST /api/ingest/payload` with an API client key, the per-project ingest endpoints, MQTT or Azure IoT).
2. The payload's `deviceId` is matched to an asset's **identifier**; the values are stored as that asset's metrics.
3. The twin machine is linked to that asset, and each reading to one of its metrics.

Select a machine to connect it. Its **Data source** section works like a Visualization widget: pick the **Asset**, then the **attribute for each reading** (the list unions the asset's live telemetry keys and its attributes). Readings are matched by name when the asset is picked; each match can be changed. Below that, a card (also on the detailed pump skid and process twin) shows this chain for the linked asset: its name and `deviceId`, how many readings are linked, and when data last arrived (checked every 30 s). **Payload a device sends** shows a ready JSON body with the asset's identifier and one metric per reading; metric names that match the readings (for example `winding_temperature`) link by themselves. A button opens Integration Hub. Creating the asset or the ingest credentials still happens in Asset Management and Integration Hub.

While no machine is selected, the side panel shows **Live tags**: up to 12 readings, machines linked to assets first, each with its trend graph. Clicking one selects that machine.

## Readings: live, demo, not linked

Each machine can be linked to **one asset**. When a machine is linked, its readings are matched to that asset's telemetry metrics by name, and a few common aliases (speed/rpm, vibration, temperature, pressure, current, power). Each match can be changed in the side panel.

Every reading is one of:

| State | When | Shown as |
|---|---|---|
| Live | linked to a metric and a value arrived | the value, tagged `live` |
| Demo | not linked, and the twin's **Demo values** switch is on | a simulated value, tagged `demo`, plus a banner counting them |
| Not linked | not linked, demo off | `not linked`; the part rests |

Demo values never come from the plant. New twins start with demo values on so the model moves before anything is linked. Turn the switch off once machines are linked. "Running" and "Simulate fault" exist only in demo mode.

Machine status (green, amber, red beacon and ring, process bar, alarm bar) comes from each model's built-in limits applied to its live and demo readings. A machine with no live or demo readings is grey.

Each reading has a small trend graph under it (on the Asset and Process twins, and for the selected machine on the Plant twin). A live reading shows the linked metric's last hour of telemetry from the server, refreshed every 30 s. A demo reading shows the simulated values since the page opened (about 90 s), kept in the browser only. A reading that is not linked has no graph.

Live values are fetched with `POST /api/plant-twins/values` every refresh interval (default 20 s) and when the WebSocket reports new telemetry (at most every 3 s).

## Storage and access

Table `plant_twins` (`lib/db/src/schema/plant_twins.ts`); routes in `artifacts/api-server/src/routes/plant_twins.ts`.

| Action | Needs |
|---|---|
| See a twin, fetch live values | Live Twin read, and the twin's project must be one the user may open (no project = every project) |
| Create | Live Twin write; the creator is the owner. A twin with no project (shown in every project) only by a user who may open every project |
| Change | Live Twin write, and the owner or a Super Admin / Company Admin |
| Delete | Live Twin delete, and the owner or a Super Admin / Company Admin |

Live Twin is its own module in Access Control (Read / Write / Delete) since November 2026. Role defaults match what Visualization gave before (roles that could edit twins can also delete them); a user whose Visualization access was overridden keeps that setting for Live Twin until Live Twin is set for them. 2D twins and process twins follow the same rules.

Others see a twin read-only ("View only" in the toolbar). Live values are returned only for assets in the caller's projects.

Scenes are saved with **Save** (and when another twin is opened or the view is closed). Renames, project moves, creation and deletion are written to the activity log; ordinary scene saves are not.

Saving is safe against two mistakes (audit H-6, M-18):

- **Save is off until the selected twin has loaded**, and stays off if it could not be opened (the view then becomes view only). All twin types (3D, asset, 2D, machine, process) keep the id of the twin they actually loaded and save only into that one, so the previous twin's layout or links can never be written into the newly selected twin.
- **Conflict check.** A save sends the `updatedAt` it loaded as `expectedUpdatedAt`; if the twin was saved elsewhere since, the server refuses with 409 (`plant_twin_conflict`) and the Save button shows "Not saved: … changed somewhere else"; open the twin again to get the latest version. A browser tab still running the previous version sends no `expectedUpdatedAt` and is accepted as before (the API logs a warning). `updatedAt` is the version of the scene: renames, project changes and folder moves keep it, so they never make an open editor's save fail.

Lists, folder moves and folder deletes read only the twins' names and hierarchy, never the scenes; a folder delete and the move of its contents happen in one transaction, and a folder cannot be moved into its own subfolder (checked on the server, under a lock). A scene may have up to 40,000 keys; the global request guard allows that on the plant-twin save routes, and a body refused only for its size is not recorded as a security event. Live values are fetched in batches of 500, so a twin with more readings shows them all.

After pulling this change, apply the new table: `pnpm --filter @workspace/db run push`.

## Instruments, meters and battery storage

**Instruments & meters** (`engine/instruments.ts`) are drawn larger than life; the Size setting scales them further. Each has a display or needle that moves with its reading and alarm colours from its limits.

| Model | Readings |
|---|---|
| Energy meter | active power, energy, voltage, current, power factor, frequency (display updates live, pulse LED blinks with power) |
| Pressure gauge | pressure (needle, warning and alarm bands on the dial) |
| Electromagnetic flow meter | flow, totaliser, conductivity, empty pipe |
| Coriolis flow meter | mass flow, density, temperature, drive gain (tubes vibrate with flow, visible in X-ray) |
| Vortex flow meter | flow, temperature, pressure, vortex frequency |
| Temperature transmitter | temperature (thermowell glows) |
| Radar level transmitter | level, distance to surface, signal strength |
| Gas detector | gas concentration (beacon blinks above the warning limit) |
| Control valve with positioner | position, set point, deviation, supply air (stem moves) |
| VFD panel | frequency, current, power, DC bus voltage, heatsink temperature |

**Battery energy storage (BESS / battery management system)** (`engine/storage.ts`, group Renewable energy): a container with 2–10 battery racks, BMS controller, PCS and transformer (optional), HVAC units and a fire panel with strobe. Readings: state of charge, state of health, power (+ discharge, − charge; the power flow runs in that direction), DC voltage and current, highest and lowest cell voltage, cell voltage spread (mV), highest and lowest cell temperature, rack temperature spread, insulation resistance, HVAC supply temperature, cycle count and BMS state (0 idle, 1 charging, 2 discharging, 3 fault). Each rack shows its charge as a fill bar and turns hot by cell temperature; the strobe blinks on fault. Machine fault shows a hot module and a cell-spread alarm.

## Copies, alarm limits, playback and alarms

- **Duplicate** (selected machine): 1–50 copies in a row or grid with a spacing in metres. Copies keep settings and reading links and number on from the name (WTG-01, WTG-02…). An option links each copy to the asset numbered one higher (matched by name or identifier); where none exists the copy keeps the same asset and the message says how many need re-linking.
- **Limits from alarm rules**: a linked reading with enabled threshold rules (Event Manager) takes its warning and alarm limits from them: critical and high rules give the alarm limit, other severities the warning limit, `gt`/`gte` upper and `lt`/`lte` lower limits. The reading row then says "Limits from alarm rules". Without rules, or for users without access to alarms, each model's built-in limits are used. The same rule applies to the 2D twin and the Process twin.
- **Playback**: replays the linked readings over the last 1, 6 or 24 hours with a time slider, play/pause and speed. Values come from `GET /api/telemetry/:assetId` (raw rows, up to 1000 per reading). Replayed values are marked "playback"; demo values are not recorded and are not replayed. Also on the 2D twin and the Process twin.
- **Active alarms**: with nothing selected, the side panel lists active alarms of the linked assets. Clicking one selects and frames the machine (2D twin and Process twin: flashes the linked parts). **Ack** appears for users allowed to acknowledge alarms. Users without access to alarms see a note.
- **PNG snapshot**: saves the current view as a picture (3D: the scene without floating labels).
- **Customer 3D models (`.glb`)**: upload a binary glTF model; it is stored with the uploads (`POST /api/uploads`, which now accepts `.glb`, recognised from its bytes) and saved with the twin. Uploading needs Visualization write; without it the model shows in that browser only, with a message saying so. **Pin a reading on a part** puts a value label on a clicked part of the model. Draco-compressed models are not supported.

### Kiosk mode

**Kiosk** shows the open twin full screen with only a thin bar for control-room displays. **Cycle twins** opens the next twin of the same type every 60 seconds. Leave with **Exit kiosk** or Esc.

## 2D twin

A 2D twin is a drawing or picture with live readings mapped onto it, stored on the server like the 3D twins (`scene.kind = "image"`, mapped elements in `scene.items`), in the open project and the selected folder.

**Background.** Upload or drop an SVG drawing, or any image the browser opens (PNG, JPEG, GIF, WebP, BMP, AVIF, ICO), or give an image address. Pictures are reduced to at most 2400 px and saved as WebP (JPEG where WebP is not available); a picture still above about 900 KB is refused. The drawing is stored inside the twin itself, not in the uploads store.

**SVG safety.** An SVG is cleaned with an allow-list when it is imported and again every time it is shown: scripts, styles, `foreignObject`, frames, animation, event handlers and links are removed, `href` is kept only for in-drawing references (`#id`) and embedded PNG/JPEG/WebP pictures, and `url()` only as `url(#id)`. That check runs on the value as the browser reads it (CSS escapes such as `u\72l(` decoded), and `image-set()`, `@import` and the other functions that fetch are refused (`imageTwin/cssUrl.ts`, tested in `api-server/src/tests/twin-fixes.test.ts`). The 1 MB limit of a 2D twin is counted in bytes.

**Mapping.**
1. Every SVG element with an id or layer name is a part: hover highlights it, click selects it. Generated ids (`path123`) are hidden unless **All ids** is on.
2. On any background, draw rectangle, ellipse or polygon regions, or place point pins.
3. In the mapping panel, give each part an asset, a metric and one or more behaviours: show value (movable label), colour by status, fill level, colour scale (min–max), rotate (SVG parts), blink on alarm, show/hide above a threshold, text for value ranges (for example 0 = Stopped, 1 = Running).

**Auto-match** links parts to a chosen asset's metrics by name, ignoring case, spaces, `-` and `_` (`TT-101` ↔ `tt101`), with a preview first. **CSV export/import** uses the columns `part, asset_identifier_or_name, metric, behaviours, unit, decimals, warn, crit, min, max`; problem rows are reported. The list has search and a "Not linked only" filter; selecting a row flashes the part.

Values refresh every 20 s and on new telemetry. **Demo values** give unlinked parts simulated values, marked "demo". Zoom with the wheel, pan by dragging, **Fit** to frame. 2D twins saved in this browser by the earlier version are offered once for **Import to server** (they become point pins with the same links and limits; the browser copies stay).

## Process twin builder

The Process twin is a P&ID editor (`scene.kind = "process"`, `scene.version = 2`). A new, empty diagram offers eight **industry templates**; the same list is under **More → Replace with a template**. Process twins saved by the earlier fixed diagram open as the reactor cooling loop sample with their links kept and are saved in the new format on the next save.

| Template | Contents |
|---|---|
| Reactor cooling loop (sample) | Feed tank, pump, control valve, cooler and reactor with recycle and cooling water |
| Water treatment | Lift station, coagulant dosing, clarifier, sand filter, UV and chlorination, treated-water tank and distribution pump, sludge press; zones Pre-treatment and Filtration & disinfection |
| Boiler house / steam | Deaerator, feed pump, boiler, steam turbine, generator, condenser and condensate return |
| Compressed air | Intake filter, compressor with motor, aftercooler, air receiver, dryer, line filter |
| Chiller plant | Chiller, cooling tower and condenser water pump, chilled water pump and AHU; zones for both loops |
| Textile dyeing | Soft water, dye and chemical dosing, jet dyeing machine with heat exchanger, washer, stenter |
| Pharma batch | WFI tank, fermenter, harvest pump, centrifuge, evaporator, spray dryer, CIP skid |
| Oil separation | Wellhead, choke valve, 3-phase separator, gas scrubber, flare, oil pump and storage tank |

Every template reading shows demo values until it is linked (use "Link all readings to one asset" or link each one).

The palette on the left lists every group closed; click a group to open it, or search (search opens every matching group).

- **Symbols** (114 in 13 groups, searchable, drag or click to add, tag numbered automatically such as P-101):
  - Vessels: tank, vertical vessel, reactor with agitator, silo, column, horizontal tank, spherical tank, day tank, cone-roof storage tank.
  - Rotating: centrifugal and positive-displacement pump, compressor, fan, agitator, motor.
  - Valves: gate, globe, control, check, ball, butterfly, 3-way, safety.
  - Heat transfer: shell-and-tube, plate, cooler, heater, boiler, cooling tower.
  - Instruments: FT, PT, TT, LT, AT, PDT, FIC, PIC, TIC, LIC, AIC, PDIC, SIC, level switch LSH, pressure switch PSH, flow switch FSL, flow meter, pressure gauge, energy meter, pH, conductivity and oxygen analysers, VFD (shows Hz).
  - Water & effluent: clarifier, thickener, aeration basin, sand filter, RO membrane, UV disinfection, chemical dosing skid, chlorinator, filter press, lift station.
  - Solids handling: bucket elevator, screw conveyor, rotary valve, crusher, ball mill, vibrating screen, bag filter, weigh feeder, rotary kiln, rotary dryer.
  - Pharma & food: fermenter, centrifuge, spray dryer, evaporator, homogeniser, CIP skid, autoclave, freeze dryer, filling line.
  - Oil & gas: 3-phase separator, desalter, pig launcher/receiver, wellhead, heater treater, gas scrubber.
  - Power & utilities: steam turbine, generator, transformer, switchgear/MCC, deaerator, air receiver, air dryer, chiller, AHU, solar PV array, battery storage (BESS), wind turbine.
  - Textile: jet dyeing machine, jigger, stenter, open-width washer, cylinder dryer.
  - Other: filter, separator, static mixer, conveyor, cyclone, flare, heat tracing.
  - Custom blocks: a labelled box (standard, wide, tall) with eight connection points for anything not in the library; it shows its label inside.
- **My symbols**: upload your own SVG drawing (up to 200 KB) or picture (PNG, JPEG, WebP or GIF, up to 3 MB; scaled down to 256 px) and give it a name. An SVG is cleaned by the same allow-list sanitiser as the 2D twin, and every uploaded symbol is drawn as an image, so it cannot run scripts or load links. It gets four connection points and can show one linked reading. The symbol is stored inside each diagram that uses it (in chunks, like the 2D twin; about 600 KB of uploaded symbols per diagram) and kept in this browser's library (`localStorage`) for other diagrams; the library is per browser, not shared between users.
- **Annotations**: free text (multi-line, colour, size), an area/zone (dashed box with a title, drawn behind everything, resized with its corner handle) and a line or arrow (drag its ends). Annotations are stored in `scene.notes` and are not counted as points.
- **Style**: per symbol a fill and line colour, the label position (below, above, left, right, hidden) and whether the tag number shows; per pipe a colour instead of the medium colour (alarm colours still win) and the label position.
- **Arrange**: resize a selected symbol with its corner handle (or the Size slider, 30-400 %); flip horizontally or vertically; with several items selected, align left, centre, right, top, middle or bottom, and distribute horizontally or vertically (three or more). **Lock** keeps an item from being moved, resized or deleted; it can still be selected and linked.
- **Pipes**: from port to port with horizontal and vertical runs; drag, add or remove bend points. Line types process, utility, signal (dashed) and electrical; colour by medium; flow arrows.
- **Tag bubbles**: a value box on a symbol or pipe linked to an asset metric, with unit, decimals and limits.
- **Editing**: grid and snapping, zoom and pan, box and Shift selection (a box selects a zone only when it holds all of it), move, rotate 90°, flip, resize, delete, copy/paste/duplicate, undo/redo, Edit/View switch, JSON export and import.
- **Live behaviour**: flow dashes move with the flow reading and stop at 0; tanks fill from level; rotors turn with speed or run status and go grey when stopped; valves shade with opening; heat equipment glows with temperature; symbols pulse amber or red on warning or alarm. Demo values with scenarios (normal, pump trip, high level, high temperature, blocked filter) for readings that are not linked.

Pipes do not route around equipment by themselves; add bends to steer them.

## Map view

**Map view** shows every project (root asset) the user may open as a marker: red for an active critical or high alarm, amber for other active alarms, green when data arrived in the last 15 minutes, grey otherwise. Nearby markers group into a numbered circle. The side list has search, a status filter and **Fit all**. Clicking a site shows its status, active alarms (top 3), asset count, maintenance count and last data time, with **Open project**, **Live Twin** and **Visualization**. The view refreshes every 30 s and on new alarms and telemetry.

**Location.** A project's location is three static attributes on the project asset: `Latitude`, `Longitude` (decimal degrees) and optionally `Address`. Users with Asset write set them from the map (**Place on map**, then click the map or type the coordinates); they can also be set in Asset Hub. Projects without a location are listed under "Unplaced sites".

**Base map.** The default map is country outlines bundled with the app, so it works offline and under the production Content-Security-Policy. **Street map** switches to OpenStreetMap tiles; that needs internet access from the browser and `https://tile.openstreetmap.org` in the nginx `img-src` (see `docs/operations/vm-deployment-checklist.md`). If the tiles do not load, the map falls back to the outlines.

Data comes from `GET /api/sites` (location, asset counts and newest data time per project the caller may open; Live Twin or Visualization read) and `/api/alarms` (only for users with access to alarms).

## Dashboard widgets

Visualization has a **Maps & twins** widget category:

- **Sites Map**: the map above, compact and view-only, for all permitted projects or chosen ones.
- **Live Twin**: shows a saved twin view-only with live values: 2D twins, process twins and asset or plant twins. The detailed pump skid shows a link to Live Twin instead. three.js and the map library load only on dashboards that use these widgets.

## Not built yet

- **Sharing with edit rights**: only the owner or an administrator can change a twin. When two of them edit the same twin, the second save is refused (see the conflict check above); merging their changes is not built.
- **Playback and alarm list on the detailed pump skid.**
- **Pipe auto-routing** in the Process twin, and editing polygon corners after drawing in the 2D twin.
- **Detailed street map offline**: the bundled map has country outlines only.

## Files

| File | What |
|---|---|
| `artifacts/iot-platform/src/pages/LiveTwin.tsx` | Type dropdown, layout, kiosk mode; classic image twins |
| `artifacts/iot-platform/src/features/imageTwin/` | 2D twin: stage, mapping panel, SVG sanitiser (`sanitize.ts`), CSV, live values |
| `artifacts/iot-platform/src/features/processTwin/` | Process twin builder: symbols, canvas, scene format and migration, live behaviour, industry templates (`templates.ts`), uploaded symbols (`mine.ts`) |
| `artifacts/iot-platform/src/features/sitesMap/` | Map view and the Sites Map / Live Twin dashboard widgets |
| `.../plantTwin/shared/` | Alarm-rule limits, playback, active alarms, PNG snapshot (used by every twin type) |
| `.../plantTwin/TwinEmbed.tsx` | View-only 3D twin for the dashboard widget |
| `artifacts/api-server/src/routes/sites.ts` | `GET /api/sites` |
| `.../plantTwin/TwinSidebar.tsx`, `twinLink.ts` | Twin list panel, and how it opens twins in each view |
| `.../plantTwin/TwinLibrary.tsx` | Add twin library (drag onto the 3D view or click) |
| `.../plantTwin/DataSource.tsx`, `LiveTags.tsx`, `ReadingTrend.tsx` | Data source card, live tags list, trend graphs |
| `artifacts/iot-platform/src/lib/features.ts` | `LIVE_TWIN_TYPES`, `liveTwinTabs`, `liveTwinClassic` |
| `artifacts/iot-platform/src/features/plantTwin/PlantTwinView.tsx` | Page: twin list, toolbar, saving, live values |
| `.../plantTwin/panels.tsx` | Process bar, process stages, machine inspector, add-machine palette |
| `.../plantTwin/engine/engine.ts` | three.js scene, layout, interaction, readings |
| `.../plantTwin/engine/models.ts`, `kit.ts`, `renewables.ts`, `storage.ts`, `instruments.ts` | Machine models and shared building blocks |
| `.../plantTwin/engine/packs.ts` | Industry templates |
| `.../plantTwin/api.ts` | Server calls |

three.js (pinned `0.150.1`) is loaded only when the 3D mode opens.
