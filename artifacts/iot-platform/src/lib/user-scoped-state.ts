/**
 * Keeps one user's browser-side state away from the next user of the same tab.
 *
 * Signing out used to reset only the user object. The React Query cache, the
 * in-memory caches some modules keep, and the localStorage keys pages write
 * (notification groups, media links, templates, bookmarks, the last project…)
 * all survived, so the next person to sign in on that browser briefly saw the
 * previous user's projects and alarms, and kept their local lists outright.
 *
 * Two pieces live here:
 *
 *   1. In-memory caches. A module that caches per-user data registers a reset
 *      with `onUserReset`; UserProvider runs them all on sign-out and whenever a
 *      different user signs in. A registry rather than direct imports, so the
 *      provider does not pull lazily-loaded dashboard code into the main chunk.
 *
 *   2. localStorage. Several features (notification groups, Live Twin, media
 *      "Add by URL" links, templates, bookmarks) keep their ONLY copy in this
 *      browser. Deleting those keys on sign-out would wipe the feature's data
 *      for good, so instead they are moved aside under the owner's user id and
 *      put back when that same user signs in again. The active keys — the only
 *      ones any page reads — are empty for everyone else.
 *
 * Per-device preferences (theme, skin, the Home view choice) are not touched.
 */

type Reset = () => void;
const resets = new Set<Reset>();

/** Register a reset for an in-memory per-user cache. Returns an unregister. */
export function onUserReset(fn: Reset): () => void {
  resets.add(fn);
  return () => { resets.delete(fn); };
}

/** Run every registered reset. A failing reset must not stop the others. */
export function runUserResets(): void {
  for (const fn of resets) {
    try { fn(); } catch { /* best-effort */ }
  }
}

// ── localStorage ─────────────────────────────────────────────────────────────

/** Which user the active user-scoped keys belong to. */
const OWNER_KEY = "nexus.storage-owner";
/** Moved-aside keys for one user. */
const STASH_PREFIX = "nexus.storage-stash:";

/** Keys written per user. Exact names. */
const USER_KEYS = new Set([
  "nexus.lastProjectId",   // ProjectContext — last project opened
  "viz_explorer_state",    // useDashboards — folders, favourites, recent
  "viz_templates",         // dashboard templates
]);

/**
 * Key prefixes written per user: `wsviz:` (bookmarks, clipboards, per-dashboard
 * range/refresh, Live Twin, legacy dashboards) and `ws-` (notification groups,
 * alarm recipients, media library, legacy analytics).
 */
const USER_PREFIXES = ["wsviz:", "ws-"];

function isUserKey(key: string): boolean {
  return USER_KEYS.has(key) || USER_PREFIXES.some((p) => key.startsWith(p));
}

function activeUserKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && isUserKey(k)) out.push(k);
  }
  return out;
}

/** Move the active user-scoped keys aside under `ownerId` and clear them. */
function stashFor(ownerId: string): void {
  const keys = activeUserKeys();
  if (keys.length === 0) return;
  const stashKey = STASH_PREFIX + ownerId;
  let stash: Record<string, string> = {};
  try {
    const raw = localStorage.getItem(stashKey);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") stash = parsed;
  } catch { /* unreadable stash: start a fresh one */ }
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v !== null) stash[k] = v;
  }
  // Write the stash before removing anything, so a quota failure leaves the
  // data where it was rather than losing it.
  localStorage.setItem(stashKey, JSON.stringify(stash));
  for (const k of keys) localStorage.removeItem(k);
}

/** Put `userId`'s moved-aside keys back. */
function restoreFor(userId: string): void {
  const stashKey = STASH_PREFIX + userId;
  const raw = localStorage.getItem(stashKey);
  if (!raw) return;
  try {
    const stash = JSON.parse(raw) as Record<string, unknown>;
    for (const [k, v] of Object.entries(stash)) {
      if (isUserKey(k) && typeof v === "string") localStorage.setItem(k, v);
    }
    localStorage.removeItem(stashKey);
  } catch { /* leave the stash in place if it cannot be restored */ }
}

/**
 * Sign-out: move the current owner's keys aside so the next user starts empty.
 */
export function releaseUserStorage(): void {
  try {
    const owner = localStorage.getItem(OWNER_KEY);
    if (owner) {
      stashFor(owner);
      localStorage.removeItem(OWNER_KEY);
    }
  } catch { /* storage unavailable — nothing to protect */ }
}

/**
 * Sign-in (or a session re-read): make the active keys `userId`'s.
 *
 * Keys owned by someone else — left behind by a session that expired rather
 * than signing out — are moved aside under that owner first. Keys with no owner
 * at all predate this mechanism and are adopted by the first user to sign in,
 * which is exactly what they saw before.
 */
export function claimUserStorage(userId: string): void {
  try {
    const owner = localStorage.getItem(OWNER_KEY);
    if (owner === userId) return;
    if (owner) {
      stashFor(owner);
      restoreFor(userId);
    } else if (activeUserKeys().length === 0) {
      restoreFor(userId);
    }
    localStorage.setItem(OWNER_KEY, userId);
  } catch { /* storage unavailable — pages fall back to empty state */ }
}
