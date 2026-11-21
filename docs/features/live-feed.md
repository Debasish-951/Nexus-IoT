# Live Feed (Live Operations Center)

Data Studio > Live Feed (`/live`, module `live`) shows what is happening in the plant right now and what needs attention. The earlier page is kept unchanged in `pages/LiveFeedClassic.tsx` and comes back with `VITE_CLASSIC_LIVE_FEED=true` at build time.

## One status rule

`features/liveFeed/status.ts` decides the data status of an asset, and every part of the page uses it:

| Status | Rule |
|---|---|
| Online | newest reading within the asset's expected interval |
| Delayed | older than the expected interval, within 1 hour |
| Offline | older than 1 hour |
| No data yet | never reported |

- **Expected interval:** 5 minutes by default. An asset can override it with a static attribute named `Expected interval (min)`. The name is matched without case, spaces or units, and the value may carry a unit ("10", "10 min"). The value is capped at 1 hour.
- **Newest reading:** the latest of live WebSocket telemetry, the asset health endpoint's `lastSeen` (newest stored reading) and the timestamps of its dynamic attributes.
- **Timestamps:** these are reading timestamps as stored by ingest. The API keeps no separate receive time, and ingest refuses future-dated readings.

## Data sources

No new endpoints. Everything comes from existing endpoints, and the project scope is applied as before.

- **Asset list:** `useListAssets`.
- **Per asset, every 30 s, six at a time:**
  - `GET /assets/:id/health`: newest stored reading and active alarms.
  - `GET /assets/:id/attributes`: latest value, unit, decimals and timestamp of each dynamic, metric or runtime attribute, plus the expected-interval attribute.
- **Once per asset, for users with Explorer or Visualization access (first 25 assets):** `GET /telemetry/:id?limit=300`. It seeds the sparklines and the messages-per-minute chart.
- **WebSocket:** `telemetry`, `alarm` and `activity_log` events. Audit events are used only for users who can read the audit log and are not project-restricted.
- **Alarms:** open alarms come from `useOpenAlarms`. Limits come from `useAlarmLimits` (enabled threshold rules: critical and high are the alarm limit, other severities the warning limit).

## Layout

1. **Header:** "Receiving data · N assets · readings/min · last message …", or "No data for …". The live-connection state is shown as a separate small badge.
2. **Filters:**
   - project or asset (`AssetScopePicker`)
   - machine (text)
   - reading search
   - Only problems
   - CSV export of the latest values: asset, machine path, reading, value, unit, status, last seen
3. **Status tiles:**
   - assets online / delayed / offline
   - active alarms (critical or high)
   - messages per minute over 15 minutes
   - data quality: readings outside alarm limits, and possibly stuck sensors (20 or more identical values in a row)
4. **Needs attention now:** a ranked list of up to 12 rows, most urgent first:
   - assets in alarm
   - readings over a limit
   - delayed or offline assets
   - possibly stuck sensors
   - the fastest-changing readings (relative change of 2 % per minute or more)

   Each row opens the asset (`/assets/:id`), the Live Twin, or AI Advisor via `/ai-copilot?scope=<assetId>&q=<question>`. That link selects the scope and prefills the question without sending it.
5. **Assets by machine:** metric names are split at the dots into a machine tree. Each reading shows its short name, value and unit, a 30-point sparkline and the limit colour. Assets and groups with problems open automatically. A group shows 40 readings before "Show all".
6. **Event stream:** newest first, capped at 200 entries. It can be paused and filtered by type. It contains:
   - alarms raised, acknowledged and cleared
   - status transitions, computed in the browser after the first poll
   - limit crossings from live readings
   - user actions

## Files

| File | Purpose |
|---|---|
| `artifacts/iot-platform/src/pages/LiveFeed.tsx` | Chooses the new or classic page |
| `artifacts/iot-platform/src/features/liveFeed/status.ts` | Status rule and pure helpers |
| `artifacts/iot-platform/src/features/liveFeed/useLiveData.ts` | Data sources, buffers, events |
| `artifacts/iot-platform/src/features/liveFeed/LiveFeedPage.tsx` | The page |
| `artifacts/iot-platform/src/pages/LiveFeedClassic.tsx` | The earlier page |
