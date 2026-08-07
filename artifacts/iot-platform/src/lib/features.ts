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
} as const;

export type FeatureKey = keyof typeof FEATURES;
