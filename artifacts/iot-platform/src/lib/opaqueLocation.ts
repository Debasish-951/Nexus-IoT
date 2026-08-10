import { useCallback } from "react";
import { useBrowserLocation } from "wouter/use-browser-location";
import { encodePath, decodePath } from "@/lib/routeSlugs";

/**
 * A wouter location hook that keeps opaque tokens in the address bar while the
 * application continues to work in readable paths.
 *
 * Everything hangs on translating at exactly one boundary:
 *
 *   reading   window.location  →  decodePath  →  what <Route>/<Switch> match on
 *   writing   navigate(to)     →  encodePath  →  what the browser displays
 *
 * So `<Route path="/alarm-rules">`, `navigate("/assets")` and
 * `<Link href="/live-twin">` are all untouched across the ~30 pages that use
 * them, and no route table gains a parallel opaque copy that could drift out of
 * step with the real one.
 *
 * Set as the `hook` on the top-level Router. wouter resolves router options as
 * `props[k] ?? parent[k]`, so the nested per-project router — which sets only
 * `base` — inherits this automatically.
 *
 * The `hrefs` property is picked up by wouter for <Link>, so the anchor's real
 * href is the opaque form too. Without it the tokens would appear in the URL
 * bar but the readable path would still show in the browser's status bar on
 * hover, and in "Copy link address".
 */

type NavOptions = { replace?: boolean; state?: unknown };

export function opaqueLocationHook(opts: { ssrPath?: string } = {}): [
  string,
  (to: string, options?: NavOptions) => void,
] {
  const [rawPath, rawNavigate] = useBrowserLocation(opts);

  const navigate = useCallback(
    (to: string, options?: NavOptions) => rawNavigate(encodePath(to), options),
    [rawNavigate],
  );

  return [decodePath(rawPath), navigate];
}

opaqueLocationHook.hrefs = encodePath;
