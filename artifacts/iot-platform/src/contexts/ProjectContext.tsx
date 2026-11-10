import { createContext, useContext, useEffect, useMemo } from "react";
import { useListAssets, getListAssetsQueryKey } from "@workspace/api-client-react";
import { useCurrentUser } from "@/contexts/UserContext";

/**
 * The current project, derived from the `/p/:projectId/...` URL prefix.
 *
 * A "project" is a root-level asset — one with no parent. That is not a new
 * concept invented here; it is the definition the API server already uses
 * (routes/api_clients.ts: "Root-level assets are the platform's projects") and
 * the one behind the per-user `allowedProjects` restriction. This context just
 * gives the frontend a first-class handle on it.
 *
 * Scope of this context is deliberately narrow: it resolves the id in the URL
 * to a project and decides whether that URL may be opened. It does not filter
 * what pages display itself; pages narrow their lists to the open project with
 * hooks/useProjectScope.ts.
 *
 * Access is filtered here: a user with `restrictProjects` cannot open a project
 * outside their `allowedProjects`. That mirrors, but does not replace, the
 * server — the API applies the same restriction itself.
 */

export interface Project {
  id: string;
  name: string;
}

interface ProjectContextValue {
  /** Projects this user may open, name-sorted. Empty until assets have loaded. */
  projects: Project[];
  /** The project named by the URL, or null while loading / if the id is unknown. */
  currentProject: Project | null;
  /** The id from the URL, trusted as-is — resolution against `projects` is separate. */
  currentProjectId: string | null;
  /** True once the asset list has settled either way, so callers can tell "none" from "not yet". */
  loaded: boolean;
  /**
   * False when the asset list could not be read at all.
   *
   * Projects are derived from assets, so a user with no `assets` grant — an
   * alarms-only operator, say — gets a 403 here. That must NOT be treated as
   * "you have zero projects", or they would be gated out of the pages they DO
   * have access to. Callers fall back to running unscoped instead.
   */
  canListProjects: boolean;
}

const ProjectContext = createContext<ProjectContextValue>({
  projects: [],
  currentProject: null,
  currentProjectId: null,
  loaded: false,
  canListProjects: true,
});

interface AssetLike { id: string; name: string; parentId?: string | null }

export function ProjectProvider({
  projectId,
  children,
}: {
  projectId: string | null;
  children: React.ReactNode;
}) {
  const { canProject, canModule } = useCurrentUser();
  // Not asked for without the `assets` grant: the answer is a known 403, and a
  // denied request is logged as a security event on every refetch.
  const canReadAssets = canModule("assets");
  const { data, isSuccess, isError } = useListAssets(undefined, {
    query: { enabled: canReadAssets, queryKey: getListAssetsQueryKey() },
  });
  const assets = (data as AssetLike[] | undefined) ?? [];

  const projects = useMemo(
    () =>
      assets
        .filter((a) => !a.parentId && canProject(a.id))
        .map((a) => ({ id: a.id, name: a.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [assets, canProject],
  );

  const currentProject = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  // Remembered only once the id is confirmed against the list the user may
  // actually open, so a link to a forbidden project cannot poison the default
  // and lock someone out of their own entry point on the next visit.
  useEffect(() => {
    if (currentProject) window.localStorage.setItem(LAST_PROJECT_KEY, currentProject.id);
  }, [currentProject]);

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      currentProjectId: projectId,
      currentProject,
      // Settled either way — a permanent 403 must end the loading state, not
      // leave the app spinning on a splash that will never resolve.
      loaded: !canReadAssets || isSuccess || isError,
      canListProjects: canReadAssets && !isError,
    }),
    [projects, projectId, currentProject, isSuccess, isError, canReadAssets],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() { return useContext(ProjectContext); }

/** Storage key for the project to reopen when a bare URL carries no prefix. */
export const LAST_PROJECT_KEY = "nexus.lastProjectId";
