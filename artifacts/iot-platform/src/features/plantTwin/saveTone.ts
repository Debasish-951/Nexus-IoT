/**
 * Save button colour, shared by every twin view:
 * orange = never saved (or the last save failed), light orange = unsaved changes (press
 * Save), grey = everything saved.
 */
export function saveTone(state: string): string {
  if (state === "new" || state === "error") return "bg-orange-500 hover:bg-orange-600 text-white border-orange-500";
  if (state === "dirty" || state === "saving") return "bg-orange-300 hover:bg-orange-400 text-orange-950 border-orange-300";
  return "bg-muted hover:bg-muted/80 text-muted-foreground border-border";
}
