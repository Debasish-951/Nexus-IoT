import { useEffect, useRef } from "react";

/**
 * Connects a twin view to the Live Twin side panel (pages/LiveTwin.tsx).
 *
 * The panel lists the twins; the view still owns loading, saving and drafts.
 * `pick` is a request from the panel: open twin `id`, or start a new draft when
 * `id` is null. `n` increases on every click so the same twin can be picked
 * twice. `onCurrent` reports which twin the view has open, so the panel can
 * highlight it. A view without a link keeps its own twin dropdown, as before.
 */
export interface TwinLink {
  pick: { id: string | null; n: number };
  onCurrent: (id: string | null) => void;
  /** Header slot next to the twin-type dropdown; the view renders its toolbar there. */
  toolbar?: HTMLElement | null;
  /** Folder selected in the side panel; a new twin is saved into it. */
  folderId?: string | null;
  /** Name of that folder, for the save dialog. */
  folderName?: string | null;
}

/** Runs `apply` for each new pick (n > 0) and reports the open twin back. */
export function useTwinLink(link: TwinLink | undefined, currentId: string | null, apply: (id: string | null) => void) {
  const applyRef = useRef(apply); applyRef.current = apply;
  const n = link?.pick.n ?? 0;
  useEffect(() => {
    if (!link || n === 0) return;
    applyRef.current(link.pick.id);
    // Only a new click should switch twins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  const report = link?.onCurrent;
  useEffect(() => { report?.(currentId); }, [currentId, report]);
}
