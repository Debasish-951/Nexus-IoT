/**
 * Feature switches for things that are built but deliberately not exposed yet.
 *
 * A switch here removes a feature from BOTH the sidebar and the router, so a
 * disabled feature is unreachable rather than merely hidden — someone with the
 * old URL bookmarked lands on Home, not on a half-supported page.
 *
 * The page components stay in the tree and keep being typechecked and built, so
 * re-enabling is only ever flipping the flag back to `true`. Nothing to restore,
 * nothing to remember.
 *
 * A flag can also be forced on at build time with a Vite env var, which is what
 * makes it usable for a staging build without touching source:
 *
 *   VITE_ENABLE_PAYLOAD_SIMULATOR=true pnpm --filter @workspace/iot-platform build
 */

/** `true` only for the literal string "true" — an unset var must never read as on. */
function envOn(value: unknown): boolean {
  return value === "true";
}

export const FEATURES = {
  /**
   * Animated network background (features/home/HomeBackground.tsx) behind every
   * page instead of only Home. Off: tried app-wide and the owner preferred it on
   * Home only, with the plain background elsewhere. To show it on every page:
   *
   *   VITE_ENABLE_APP_BACKGROUND=true pnpm --filter @workspace/iot-platform build
   */
  appBackground: envOn(import.meta.env.VITE_ENABLE_APP_BACKGROUND),
  /**
   * Payload Simulator (`/simulator`, pages/IngestSimulator.tsx).
   *
   * Turned off on request — the platform now has real gateways posting to the
   * per-project ingest endpoints, so a browser-based payload generator is a
   * demo/testing tool rather than part of the product surface. Turn back on when
   * it is needed for commissioning or a demo.
   */
  payloadSimulator: envOn(import.meta.env.VITE_ENABLE_PAYLOAD_SIMULATOR),

  /**
   * Hierarchy Generator (`/hierarchy-generator`, pages/HierarchyGenerator.tsx).
   *
   * Turned off on request, with the page left intact so bringing it back is one
   * flag flip. Assets are built through the tree and the create wizard in the
   * meantime; nothing else depends on the generator.
   */
  hierarchyGenerator: envOn(import.meta.env.VITE_ENABLE_HIERARCHY_GENERATOR),

  /**
   * Alarm notification channels: the Email / WhatsApp / SMS toggles and the
   * recipients picker on Alarm Rules (pages/AlarmRules.tsx), and the
   * Notification Groups page (`/notification-groups`,
   * pages/NotificationGroups.tsx) with its nav entry.
   *
   * Shown by default at the owner's request, so people can see these features
   * and configure them ahead of time. Note: the server does not deliver Email,
   * WhatsApp or SMS yet; the settings are saved for when it does. Webhooks on
   * alarm rules are delivered today. To hide the channels:
   *
   *   VITE_DISABLE_NOTIFICATION_CHANNELS=true pnpm --filter @workspace/iot-platform build
   */
  notificationChannels: import.meta.env.VITE_DISABLE_NOTIFICATION_CHANNELS !== "true",

  /**
   * Alarm rule options the server saves but does not evaluate yet, on Alarm
   * Rules (pages/AlarmRules.tsx): the Deviation and Heartbeat rule types, the
   * rate-of-change Window, Scan Rate and Require Acknowledge.
   *
   * Off so nobody relies on a setting that does nothing. Existing rules keep
   * their stored values: they still open, show their type, and save them back
   * unchanged. Turn back on once routes/ingest.ts evaluates them:
   *
   *   VITE_ENABLE_ADVANCED_ALARM_OPTIONS=true pnpm --filter @workspace/iot-platform build
   */
  advancedAlarmOptions: envOn(import.meta.env.VITE_ENABLE_ADVANCED_ALARM_OPTIONS),

  /**
   * "Events" widget in the Visualization widget library
   * (features/dashboards/registry.tsx).
   *
   * Off because it has no event source behind it — it rendered the bound
   * telemetry series (or sample rows) under an "Events" heading, which reads as
   * a real event log on an operator screen. The renderer is kept; dashboards
   * that already hold one show a "not available" placeholder instead of the
   * misleading rows. Turn back on once it is wired to a real event feed:
   *
   *   VITE_ENABLE_EVENTS_WIDGET=true pnpm --filter @workspace/iot-platform build
   */
  dashboardEventsWidget: envOn(import.meta.env.VITE_ENABLE_EVENTS_WIDGET),

  /**
   * The expanded widget set in the Visualization widget library
   * (features/dashboards/pro): 52 animated widgets across Charts Pro,
   * Instruments, Equipment, Plant Status, Alarms & Operations, Analytics, Energy
   * and Process. The original widgets are unchanged; these sit beside them.
   *
   * ON by default. Turning it off removes them from the library and the type
   * dropdown; a dashboard that already holds one shows a "not available"
   * placeholder, and turning it back on restores it as it was:
   *
   *   VITE_DISABLE_PRO_WIDGETS=true pnpm --filter @workspace/iot-platform build
   */
  proWidgets: import.meta.env.VITE_DISABLE_PRO_WIDGETS !== "true",

  /**
   * "3D plant twins" on the Live Twin page (features/plantTwin): whole plants
   * laid out by process from industry templates, stored on the server
   * (plant_twins), with machines linked to assets so live telemetry drives them.
   * The original image twins are unchanged and sit beside it behind a switch.
   *
   * ON by default. Turning it off hides the switch and shows only image twins;
   * saved 3D twins stay in the database and come back when it is turned on:
   *
   *   VITE_DISABLE_PLANT_TWIN_3D=true pnpm --filter @workspace/iot-platform build
   *
   * Not built yet: saving uploaded .glb models (they show for the session only),
   * per-reading alarm limits (each model's built-in limits are used) and sharing
   * a twin with edit rights (only the owner or an administrator can change it).
   */
  plantTwin3d: import.meta.env.VITE_DISABLE_PLANT_TWIN_3D !== "true",

  /**
   * Live Twin layout. Off (default): one twin type at a time, chosen from a
   * dropdown, with the saved twins of that type in a side panel; the types
   * offered come from LIVE_TWIN_TYPES below. On: the earlier layout with all
   * five views as tabs, kept intact:
   *
   *   VITE_LIVE_TWIN_TABS=true pnpm --filter @workspace/iot-platform build
   */
  liveTwinTabs: envOn(import.meta.env.VITE_LIVE_TWIN_TABS),

  /**
   * Opaque address-bar tokens (lib/routeSlugs.ts).
   *
   * ON by default, unlike everything else here — this one was asked for, and
   * the switch exists so it can be turned off without a code change if the
   * unreadable URLs get in the way of support or debugging:
   *
   *   VITE_READABLE_URLS=true pnpm --filter @workspace/iot-platform build
   *
   * Turning it off is safe at any time: readable paths are always accepted, so
   * links minted while it was on keep resolving either way.
   *
   * Not an access control. See the header of lib/routeSlugs.ts.
   */
  opaqueRoutes: !envOn(import.meta.env.VITE_READABLE_URLS),
} as const;

export type FeatureKey = keyof typeof FEATURES;

/**
 * Twin types offered on Live Twin, set per installation to match what the
 * customer has taken: `image` (2D twin: photo with pinned values), `asset`
 * (3D machines), `process` (P&ID), `plant` (saved 3D plants, view only) and
 * `builder` (3D Builder: lays plants out from industry templates and the
 * machine library). Comma separated, in dropdown order. Unset or empty means
 * all five. With one type the dropdown is replaced by its name. Offer `plant`
 * with `builder` unless plants are built for the customer. Example, asset
 * twin only:
 *
 *   VITE_LIVE_TWIN_TYPES=asset pnpm --filter @workspace/iot-platform build
 *
 * This only decides what the page shows. Twins of other types already saved
 * stay in the database, and the API does not refuse them.
 */
export type LiveTwinType = "image" | "asset" | "process" | "plant" | "builder";
const ALL_TWIN_TYPES: LiveTwinType[] = ["image", "asset", "process", "plant", "builder"];
function parseTwinTypes(value: unknown): LiveTwinType[] {
  const picked = String(value ?? "").split(",").map((t) => t.trim().toLowerCase())
    .filter((t, i, a): t is LiveTwinType => (ALL_TWIN_TYPES as string[]).includes(t) && a.indexOf(t) === i);
  return picked.length ? picked : ALL_TWIN_TYPES;
}
export const LIVE_TWIN_TYPES: LiveTwinType[] = parseTwinTypes(import.meta.env.VITE_LIVE_TWIN_TYPES);
