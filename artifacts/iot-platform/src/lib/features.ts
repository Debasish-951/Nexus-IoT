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
   * Off because nothing on the server delivers these channels yet — the
   * toggles saved a flag that no code acted on. Webhooks on alarm rules are
   * real and stay visible regardless. Turn back on once delivery exists:
   *
   *   VITE_ENABLE_NOTIFICATION_CHANNELS=true pnpm --filter @workspace/iot-platform build
   */
  notificationChannels: envOn(import.meta.env.VITE_ENABLE_NOTIFICATION_CHANNELS),

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
