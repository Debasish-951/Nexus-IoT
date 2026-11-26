/**
 * Pure rules shared by the Live Twin (plant_twins) and Visualization (viz_nodes)
 * routes. Kept free of database calls so the regression tests can run them.
 */

/**
 * True when a write carrying `expected` (the `updatedAt` the client last read)
 * must be refused because the row has changed since. No `expected` means an old
 * client: accepted, as before (the route logs it).
 */
export function isStaleWrite(current: Date, expected: string | undefined): boolean {
  if (expected === undefined) return false;
  return current.getTime() !== new Date(expected).getTime();
}

/**
 * Moving `id` under `newParent` would close a loop: `newParent` is `id` itself
 * or one of its descendants. `parentOf` gives each node's current parent.
 * A chain that is already broken or looping is walked at most `limit` steps.
 */
export function wouldCreateCycle(parentOf: (id: string) => string | null | undefined, id: string, newParent: string, limit = 10_000): boolean {
  let cur: string | null | undefined = newParent;
  const seen = new Set<string>();
  for (let i = 0; cur && i < limit; i++) {
    if (cur === id) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = parentOf(cur);
  }
  return false;
}

/**
 * Only a caller who may open every project may show a twin in all projects
 * (projectId null). `restricted` is true when the caller's projects are limited.
 * Keeping a twin that already has no project (a scene save, a rename) is fine.
 */
export function mayUseNoProject(restricted: boolean, currentProjectId: string | null | undefined, nextProjectId: string | null | undefined): boolean {
  if (!restricted) return true;
  if (nextProjectId !== null) return true;            // a project, or not being changed
  return currentProjectId === null;                   // already shown everywhere: unchanged
}
