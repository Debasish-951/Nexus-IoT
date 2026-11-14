# 3D plant twins

Live Twin is its own entry in the main navigation, after Data Insights. The page (`/live-twin`) shows one twin type at a time, picked from a **Twin type** dropdown next to the title, in this order: **2D twin**, **Asset twin**, **Process twin**, **Plant twin**, **3D Builder**. The open twin's toolbar sits on the same row: **New** (once a twin is saved), **Add twin** (machine library), rename, delete, Demo values, live status, refresh, labels, **Fit** (frames everything and returns to the starting angle), full screen and, last, **Save**. **Back** stays inside Live Twin: it returns to the twin type or twin opened before, and from the first one goes to Home. (Visualization's Back likewise goes to the parent dashboard, then Home; Live Feed and Asset Template go to Home. None of them opens the Data Insights card page any more.)

The **Save** button shows the save state by colour: orange = not saved yet (or the last save failed), light orange = unsaved changes, grey = everything is saved. Edits are not saved on a timer: the button stays light orange until **Save** is pressed. Unsaved changes are still written when another twin is opened or the view is closed, and the browser warns before the page is reloaded or closed with unsaved changes. **New** is outlined in orange.

The panel on the left lists the saved twins of that type for the open project as a folder tree, like the Visualization dashboard panel: create folders (and folders inside folders) with the folder button, rename or delete them on hover, and drag a twin or folder onto a folder, or onto "Top level", to move it. Clicking a folder selects it; **Save** then stores a new twin in that folder. Deleting a folder keeps its contents, which move up one level. Folders are stored as `plant_twins` rows with `scene.kind = "folder"`; a twin's folder is `scene.parent` (no extra column). 2D twins live in the browser and have no folders. The last type and the panel state are remembered per browser.

While Demo values are on, the asset, plant and Builder views show a **Scenario** panel with only the scenarios that apply to the machines on the floor: Normal running and Machine fault always (each model's built-in fault values), Bearing overheat when there is a rotating machine, Cavitation and Pump trip only when there is a pump. Cavitation raises vibration and drops flow on pumps, Bearing overheat drives temperatures on rotating machines past their limits, Pump trip stops the pumps. Scenarios move demo values only; linked readings always show plant data.

Clicking a machine closes the library and shows its **Data Source** panel; a machine just added from the library keeps the library open so more can be added.

The 3D views have **X-ray**, **Auto-rotate** and **Heat map** buttons in the top right corner. Heat map tints each machine from blue to red by its temperature readings against their limits (machines without a temperature reading use their status). The process twin is a 2D diagram, so it has Heat map only (cooler and reactor by temperature, pump by status).

| Type | What | Stored as |
|---|---|---|
| Asset twin | Any machines from the library on a free 3D floor. The view starts empty; **Add twin** opens the library (71 machines in 12 groups, searchable) on the right. Drag a machine onto the 3D view or click it, then connect its data source. No industry template, areas or stages | `plant_twins`, `scene.kind = "asset"` |
| Asset twin, detailed pump skid | Chosen from the top of the library. One pump skid in close-up (X-ray, heat map, pins), six readings each linked to an asset metric. Listed with the asset twins as "Detailed pump skid" | `plant_twins`, `scene.kind = "machine"` |
| Process twin | Animated P&ID: tank, pump, control valve, cooler, reactor. Seven tags (level, flow, pressure, valve opening, cooler outlet, reactor temperature, agitator) | `plant_twins`, `scene.kind = "process"` |
| Plant twin | Saved plants in 3D, view only and large, with a demo **Scenario** panel, **Live tags · plant** and a legend. With no saved plant it shows a sample plant. **Edit in 3D Builder** opens the plant in the Builder | `plant_twins`, `scene.kind` absent or `"plant"` |
| 3D Builder | The plant editor described below. It starts with an empty floor: **Add twin** opens the library with an **Industry template** dropdown and **Load** at the top (replacing machines already on the floor asks first), and single machines below. Lists the same plants as Plant twin, in the same folders | same as Plant twin |
| 2D twin | The original image twins: a picture with pinned live values. Unchanged apart from the name | browser localStorage |

### Which types a customer gets

Each company has its own installation, so the types offered are set when the frontend is built, with a comma-separated list in dropdown order:

```bash
VITE_LIVE_TWIN_TYPES=asset pnpm --filter @workspace/iot-platform build            # asset twin only
VITE_LIVE_TWIN_TYPES=process,plant pnpm --filter @workspace/iot-platform build    # process and plant
```

Values: `image` (2D twin), `asset`, `process`, `plant`, `builder` (3D Builder). Unset, empty or unknown values mean all five. Offer `plant` together with `builder` unless the plants are built for the customer. With one type the dropdown is replaced by that type's name. This only decides what the page shows; twins of other types already saved stay in the database and the API does not refuse them.

The earlier layout, with all five views as tabs, is kept: build with `VITE_LIVE_TWIN_TABS=true` to use it instead.

On the Asset and Process twins, "Link all readings to one asset" matches every reading to that asset's metrics by name; each match can be changed per reading. With Demo values on, the demo scenarios (normal, cavitation, bearing overheat, pump trip) and the valve slider move the readings that are not linked. All three 3D views share the same live-value, demo-value and saving rules described below.

The 3D mode is behind the `plantTwin3d` switch in `artifacts/iot-platform/src/lib/features.ts`. It is on by default. Build with `VITE_DISABLE_PLANT_TWIN_3D=true` to show only image twins; saved 3D twins stay in the database.

## What a twin is

A twin is one plant, organised as **industry → process area → sub-process → machine → readings**:

- **Industry templates** (`engine/packs.ts`): textile mill, integrated steel plant, oil & gas (upstream), refinery, cement, chemical, pharma (oral solid dose), cold chain, power & energy, data center, glass & plastics, tank farm & terminal, water & effluent treatment. A template is data only: areas in process order, sub-processes, machines, which utility feeds which area, and the material flow between areas.
- **Machine models** (`engine/models.ts`): 71 models in 12 groups (including electric motor, gearbox and control valve) (rotating, vessels, thermal, material handling, textile, iron & steel, oil & gas, pharma, water, electrical, HVAC, other). Each is built in code from simple shapes and has settings (size, length, number of zones, type), so changing a setting rebuilds the model. Each declares the readings it understands and how its parts move with them.
- **Layout**: areas left to right in process order, sub-processes as columns, parallel machines side by side. Areas wrap to a new row past about 75 m.

With no twin yet, or after **New 3D twin**, the page opens a **draft**: a template laid out and fully editable but not saved. The **Industry** picker at the top of the side panel switches templates (on a saved twin it asks first, because it replaces the layout). **Save as twin** stores the draft with its changes.

If the API answers `503 plant_twins_table_missing`, the table has not been created: run `pnpm --filter @workspace/db run push`.

Users can untick stages a plant does not have (the layout is rebuilt; machines keep their settings and asset links), drag, rotate, duplicate and delete machines, add machines from the palette to any area, and draw pipes or cables between machines.

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
| See a twin, fetch live values | Visualization read, and the twin's project must be one the user may open (no project = every project) |
| Create | Visualization write; the creator is the owner |
| Change or delete | Visualization write, and the owner or a Super Admin / Company Admin |

Others see a twin read-only ("View only" in the toolbar). Live values are returned only for assets in the caller's projects.

The scene is saved automatically about a second after each change. Renames, project moves, creation and deletion are written to the activity log; ordinary scene saves are not.

After pulling this change, apply the new table: `pnpm --filter @workspace/db run push`.

## Not built yet

- **Uploaded `.glb` models** show for the current session only. Saving them needs file storage that accepts 3D files; the upload store accepts images only.
- **Alarm limits per reading**: each model's built-in limits are used. These are separate from Alarm Rules, which keep working as before.
- **Sharing with edit rights**: only the owner or an administrator can change a twin.
- **Process P&ID editor** and **replay timeline** from the concept demo. The process twin is a fixed diagram; the library does not add equipment to it.

## Files

| File | What |
|---|---|
| `artifacts/iot-platform/src/pages/LiveTwin.tsx` | Type dropdown and layout; image twins unchanged |
| `.../plantTwin/TwinSidebar.tsx`, `twinLink.ts` | Twin list panel, and how it opens twins in each view |
| `.../plantTwin/TwinLibrary.tsx` | Add twin library (drag onto the 3D view or click) |
| `.../plantTwin/DataSource.tsx`, `LiveTags.tsx`, `ReadingTrend.tsx` | Data source card, live tags list, trend graphs |
| `artifacts/iot-platform/src/lib/features.ts` | `LIVE_TWIN_TYPES`, `liveTwinTabs` |
| `artifacts/iot-platform/src/features/plantTwin/PlantTwinView.tsx` | Page: twin list, toolbar, saving, live values |
| `.../plantTwin/panels.tsx` | Process bar, process stages, machine inspector, add-machine palette |
| `.../plantTwin/engine/engine.ts` | three.js scene, layout, interaction, readings |
| `.../plantTwin/engine/models.ts`, `kit.ts` | Machine models and shared building blocks |
| `.../plantTwin/engine/packs.ts` | Industry templates |
| `.../plantTwin/api.ts` | Server calls |

three.js (pinned `0.150.1`) is loaded only when the 3D mode opens.
