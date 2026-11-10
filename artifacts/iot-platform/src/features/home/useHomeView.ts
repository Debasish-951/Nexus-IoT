import { useCallback, useEffect, useState } from "react";

/**
 * Which home page the user sees.
 *
 * The original Dashboard is untouched and still reachable — this is the switch
 * between them, not a replacement. A redesign that removes the thing it
 * replaces has no way back if it turns out to be wrong on real data, and the
 * only honest test of this page is a plant with live telemetry on it.
 *
 * Stored per browser rather than per account: it is a display preference, and
 * putting it in the database would mean a schema change, an endpoint, a route
 * rule and a migration to answer "which of two layouts do I like".
 */

export type HomeView = "projects" | "overview" | "classic";

// Renamed when Projects became the default, so an old saved view does not hide it.
const KEY = "nexus.home.view.v2";
const EVENT = "nexus:home-view";

function read(): HomeView {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "classic" || stored === "overview" ? stored : "projects";
  } catch {
    // Private browsing or a blocked storage partition. Fall back rather than
    // taking the page down over a preference.
    return "projects";
  }
}

export function useHomeView(): [HomeView, (next: HomeView) => void] {
  const [view, setView] = useState<HomeView>(read);

  // Keeps every mounted consumer in step — including a second tab, which gets
  // the native `storage` event.
  useEffect(() => {
    const sync = () => setView(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = useCallback((next: HomeView) => {
    try { localStorage.setItem(KEY, next); } catch { /* preference is best-effort */ }
    setView(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [view, update];
}
