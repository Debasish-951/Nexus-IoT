import { useCallback, useMemo } from "react";
import { useListAssets, getListAssetsQueryKey } from "@workspace/api-client-react";
import { useProject } from "@/contexts/ProjectContext";
import { useCurrentUser } from "@/contexts/UserContext";

interface AssetLike { id: string; name: string; parentId?: string | null }

/** Ids of `rootId` and every asset below it. */
export function subtreeIds(list: AssetLike[], rootId: string): Set<string> {
  const keep = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of list) {
      if (a.parentId && keep.has(a.parentId) && !keep.has(a.id)) { keep.add(a.id); grew = true; }
    }
  }
  return keep;
}

/**
 * The open project's asset subtree, for narrowing page lists to `/p/:id`.
 *
 * `assetIds` is null when there is nothing to narrow to: no project in the URL
 * (a fresh install), or an asset list this user cannot read (no `assets` grant),
 * in which case pages stay unscoped exactly as ProjectGate does — the server
 * still applies the user's project restriction.
 *
 * `inScope(assetId)` treats a missing asset id as in scope, so a rule that
 * applies to all assets shows in every project. Pass `{ strict: true }` to
 * exclude it instead.
 */
export function useProjectScope() {
  const { currentProjectId } = useProject();
  const { canModule } = useCurrentUser();
  const canReadAssets = canModule("assets");
  const { data, isSuccess, isError } = useListAssets(undefined, {
    query: { enabled: canReadAssets, queryKey: getListAssetsQueryKey() },
  });
  const assets = useMemo(() => (data as AssetLike[] | undefined) ?? [], [data]);

  // While the list is still loading the subtree is unknown: show nothing that is
  // tied to an asset yet, rather than flash other projects' rows.
  const pending = canReadAssets && !isSuccess && !isError;
  const assetIds = useMemo(
    () => (!currentProjectId || !canReadAssets || isError
      ? null
      : pending ? new Set<string>() : subtreeIds(assets, currentProjectId)),
    [assets, currentProjectId, canReadAssets, isError, pending],
  );

  const inScope = useCallback(
    (assetId: string | null | undefined, opts?: { strict?: boolean }) => {
      if (!assetIds) return true;
      if (!assetId) return !opts?.strict;
      return assetIds.has(assetId);
    },
    [assetIds],
  );

  /** Name of the project (root asset) an asset belongs to, or null if unknown. */
  const projectNameOf = useMemo(() => {
    const byId = new Map(assets.map((a) => [a.id, a]));
    return (assetId: string | null | undefined): string | null => {
      let cur = assetId ? byId.get(assetId) : undefined;
      for (let guard = 0; cur?.parentId && guard < 1000; guard++) cur = byId.get(cur.parentId);
      return cur ? cur.name : null;
    };
  }, [assets]);

  /**
   * "Project · Asset" for showing where an alarm is, in views that stay global
   * (bell, critical banner). Just the asset name when the project is unknown or
   * the asset is the project itself.
   */
  const whereLabel = useCallback(
    (assetId: string | null | undefined, assetName: string | null | undefined) => {
      const project = projectNameOf(assetId);
      const asset = assetName ?? "";
      if (!project || project === asset) return asset;
      return asset ? `${project} · ${asset}` : project;
    },
    [projectNameOf],
  );

  return { projectId: currentProjectId, assetIds, inScope, projectNameOf, whereLabel, assets };
}
