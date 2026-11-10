/**
 * Every asset under the given roots, the roots included.
 *
 * Kept free of other imports because lib/ws-broadcast.ts needs it, and most other
 * modules here reach ws-broadcast through security-log, which would form a cycle.
 * Iterative with a `seen` set: parentId carries no foreign key, so a corrupted
 * chain must not spin or overflow the stack.
 */
export function assetSubtree(
  roots: Iterable<string>,
  assets: ReadonlyArray<{ id: string; parentId: string | null }>,
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const a of assets) {
    if (!a.parentId) continue;
    const list = childrenOf.get(a.parentId) ?? [];
    list.push(a.id);
    childrenOf.set(a.parentId, list);
  }
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return seen;
}
