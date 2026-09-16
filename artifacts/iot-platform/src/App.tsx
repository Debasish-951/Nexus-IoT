import { useEffect, useRef, lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import { UserProvider } from "@/contexts/UserContext";
import { Protected } from "@/components/RouteGuard";
import AlarmToastListener from "@/components/AlarmToastListener";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import Activate from "@/pages/Activate";
import ResetPassword from "@/pages/ResetPassword";
import Home from "@/pages/Home";
import { FEATURES, type FeatureKey } from "@/lib/features";

/**
 * Route-level code splitting.
 *
 * The whole app used to ship as one ~2.7MB chunk, so a plant-floor terminal
 * downloaded the AI Copilot, the payload simulator, html2canvas and every chart
 * type before it could paint the login screen. Each page below is now its own
 * chunk, fetched when its route is first opened.
 *
 * Home, the auth screens and NotFound stay eager on purpose: they are the
 * first thing rendered after sign-in or the thing rendered when nothing else
 * matches, so lazy-loading them would only add a spinner to the critical path.
 *
 * `Home` picks between the banded Overview and the original Dashboard from a
 * per-browser preference — both pages are live, neither replaces the other.
 */
const AICopilot = lazy(() => import("@/pages/AICopilot"));
const ActivityLog = lazy(() => import("@/pages/ActivityLog"));
const AlarmHistory = lazy(() => import("@/pages/AlarmHistory"));
const AlarmRules = lazy(() => import("@/pages/AlarmRules"));
const Alarms = lazy(() => import("@/pages/Alarms"));
const ApiClients = lazy(() => import("@/pages/ApiClients"));
const AssetDetails = lazy(() => import("@/pages/AssetDetails"));
const AssetManagement = lazy(() => import("@/pages/AssetManagement"));
const AssetTemplateDetails = lazy(() => import("@/pages/AssetTemplateDetails"));
const AssetTemplates = lazy(() => import("@/pages/AssetTemplates"));
const Assets = lazy(() => import("@/pages/Assets"));
const Brokers = lazy(() => import("@/pages/Brokers"));
const DashboardTemplates = lazy(() => import("@/pages/DashboardTemplates"));
const DataExplorerHome = lazy(() => import("@/pages/DataExplorerHome"));
const DataManagement = lazy(() => import("@/pages/DataManagement"));
const Destinations = lazy(() => import("@/pages/Destinations"));
const HierarchyGenerator = lazy(() => import("@/pages/HierarchyGenerator"));
const IngestSimulator = lazy(() => import("@/pages/IngestSimulator"));
const IntegrationGuide = lazy(() => import("@/pages/NodeRedDocs"));
const IntegrationHub = lazy(() => import("@/pages/IntegrationHub"));
const LiveFeed = lazy(() => import("@/pages/LiveFeed"));
const LiveTwin = lazy(() => import("@/pages/LiveTwin"));
const MediaLibrary = lazy(() => import("@/pages/MediaLibrary"));
const NotificationGroups = lazy(() => import("@/pages/NotificationGroups"));
const Reports = lazy(() => import("@/pages/Reports"));
const SecurityCenter = lazy(() => import("@/pages/SecurityCenter"));
const Settings = lazy(() => import("@/pages/Settings"));
const Users = lazy(() => import("@/pages/Users"));
const Visualization = lazy(() => import("@/pages/Visualization"));

import { ProjectProvider, useProject, LAST_PROJECT_KEY } from "@/contexts/ProjectContext";
import { Button } from "@/components/ui/button";
import { opaqueLocationHook } from "@/lib/opaqueLocation";
import { encodePath } from "@/lib/routeSlugs";

/**
 * The deployment's own base path (`/` in dev, a subpath behind nginx if
 * configured). Needed wherever a link has to escape the nested project router
 * with `~`, because `~` drops EVERY base — including this one.
 */
const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 401/403 are terminal — retrying a permission failure just delays the
      // redirect and doubles the noise in the security event log.
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status;
        if (status === 401 || status === 403) return false;
        return failureCount < 1;
      },
      staleTime: 10_000,
    },
  },
});

/**
 * Route table.
 *
 * Every authenticated route is wrapped in <Protected>, and routes that belong
 * to a controlled module declare it, so a user who types the URL directly gets
 * the same answer as one who uses the nav. The API enforces the same rules —
 * this layer exists so the UI is coherent, not so it is secure.
 *
 * A route may also name a feature switch. A route whose switch is off is not
 * registered at all, so the URL falls through to NotFound rather than rendering
 * a page that is meant to be unavailable.
 */
const ROUTES: {
  path: string;
  component: React.ComponentType;
  module?: string;
  feature?: FeatureKey;
}[] = [
  { path: "/",                     component: Home,                 module: "dashboard" },
  { path: "/asset-management",     component: AssetManagement,      module: "assets" },
  { path: "/hierarchy-generator",  component: HierarchyGenerator,   module: "assets", feature: "hierarchyGenerator" },
  { path: "/assets",               component: Assets,               module: "assets" },
  { path: "/assets/:id",           component: AssetDetails,         module: "assets" },
  { path: "/asset-templates",      component: AssetTemplates,       module: "assets" },
  { path: "/asset-templates/:id",  component: AssetTemplateDetails, module: "assets" },
  { path: "/media-library",        component: MediaLibrary,         module: "assets" },
  { path: "/alarms",               component: Alarms,               module: "alarms" },
  { path: "/alarm-history",        component: AlarmHistory,         module: "alarms" },
  { path: "/alarm-rules",          component: AlarmRules,           module: "alarms" },
  { path: "/notification-groups",  component: NotificationGroups,   module: "alarms" },
  { path: "/users",                component: Users,                module: "users" },
  { path: "/security",             component: SecurityCenter,       module: "security" },
  { path: "/brokers",              component: Brokers,              module: "brokers" },
  { path: "/destinations",         component: Destinations,         module: "brokers" },
  { path: "/integrations",         component: IntegrationHub,       module: "brokers" },
  { path: "/integration-guide",    component: IntegrationGuide },
  { path: "/simulator",            component: IngestSimulator,      module: "brokers", feature: "payloadSimulator" },
  { path: "/api-clients",          component: ApiClients,           module: "api_clients" },
  { path: "/data-explorer",        component: DataExplorerHome,     module: "explorer" },
  { path: "/ai-copilot",           component: AICopilot,            module: "explorer" },
  { path: "/activity-log",         component: ActivityLog,          module: "activity_log" },
  { path: "/data-management",      component: DataManagement,       module: "reports" },
  { path: "/reports",              component: Reports,              module: "reports" },
  { path: "/visualization",        component: Visualization,        module: "visualization" },
  { path: "/live-twin",            component: LiveTwin,             module: "visualization" },
  { path: "/dashboard-templates",  component: DashboardTemplates,   module: "visualization" },
  { path: "/live",                 component: LiveFeed,             module: "live" },
  // Personal preferences — available to anyone signed in.
  { path: "/settings",             component: Settings },
];

/**
 * Rewrites an arriving readable URL into its opaque form.
 *
 * Readable paths stay valid forever — an old bookmark, a link in a support
 * ticket, or a URL typed from the docs must still open the right page. But once
 * it has opened, leaving `/p/<id>/alarm-rules` in the address bar would defeat
 * the point, so it is replaced (not pushed — the readable form should not
 * become a back-button step).
 *
 * Query and fragment are carried over explicitly: history.replaceState is given
 * a whole URL, so anything omitted here is dropped.
 */
function OpaqueUrlNormaliser() {
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (!FEATURES.opaqueRoutes) return;
    const shown = window.location.pathname;
    if (encodePath(shown) === shown) return;
    navigate(location + window.location.search + window.location.hash, { replace: true });
  }, [location, navigate]);

  return null;
}

/** The signed-in application: sidebar plus the route table above. */
function WorkspaceShell() {
  return (
    <Layout>
      <OpaqueUrlNormaliser />
      {/* Every page below the Dashboard is a lazy chunk, so the first visit to a
          route needs somewhere to wait. The boundary sits INSIDE Layout on
          purpose: the sidebar and top bar stay on screen while the page loads,
          rather than the whole shell blinking out and back. */}
      <Suspense fallback={<PageSpinner />}>
        <Switch>
          {ROUTES
            .filter(({ feature }) => !feature || FEATURES[feature])
            .map(({ path, component: Component, module }) => (
            <Route key={path} path={path}>
              <Protected module={module}>
                <Component />
              </Protected>
            </Route>
          ))}
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

/**
 * Waiting state for a lazy page chunk. Sized to the content area, not the
 * viewport — the shell around it is already on screen.
 */
function PageSpinner() {
  return (
    <div className="flex h-full min-h-[50vh] w-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function Splash({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}

/**
 * A project workspace: everything under `/p/<projectId>/…`.
 *
 * The nested <Router base> is what keeps this from being a rewrite of every
 * page. Inside it wouter reports and accepts paths RELATIVE to the prefix, so a
 * page that already says `navigate("/assets")` or `<Link href="/alarms">` keeps
 * working untouched and simply resolves inside the open project. The route
 * table above needs no project-aware duplicates either.
 *
 * <Protected> sits OUTSIDE the nested router deliberately: it redirects to
 * /login, which is an app-root route. Inside the nested router that target would
 * be rewritten to /p/<id>/login and 404.
 */
function ProjectWorkspace({ projectId }: { projectId: string }) {
  return (
    <Protected>
      <ProjectProvider projectId={projectId}>
        <WouterRouter base={`/p/${projectId}`}>
          <ProjectGate />
        </WouterRouter>
      </ProjectProvider>
    </Protected>
  );
}

/**
 * Refuses to render a project the user cannot open.
 *
 * A link to a deleted project — or to one the recipient is not assigned to,
 * which is the normal outcome of pasting a link to a colleague — must say so.
 * Silently swapping in a different project would be worse than an error: the
 * page would look right while showing another plant's data.
 */
function ProjectGate() {
  const { currentProject, currentProjectId, projects, loaded, canListProjects } = useProject();
  const [location, navigate] = useLocation();

  /**
   * The last project id that actually resolved.
   *
   * This separates the two ways `currentProject` can be null, which look
   * identical here but must not be treated the same:
   *
   *   never resolved  → the id was pasted, mistyped, or belongs to someone
   *                     else's plant. Refuse it. Silently opening a DIFFERENT
   *                     project would show another plant's data under a URL
   *                     that looks correct.
   *   resolved, then  → the project was deleted while the user was working in
   *   disappeared       it — almost always because they just deleted that root
   *                     asset themselves. Nothing is ambiguous and nothing is
   *                     being substituted behind their back, so stranding them
   *                     on an error wall is purely an obstacle.
   *
   * Comparing the ID rather than keeping a boolean is what makes the second
   * case safe: a boolean would stay true after the user edits the URL to some
   * OTHER project's id, and we would bounce them into a project they did not
   * ask for instead of refusing an id they cannot open.
   */
  const lastResolvedId = useRef<string | null>(null);
  if (currentProject) lastResolvedId.current = currentProject.id;
  const vanished = !currentProject
    && currentProjectId !== null
    && lastResolvedId.current === currentProjectId;

  // Carry the user to another project on the SAME page. `location` is relative
  // to the `/p/<id>` base, so deleting a root asset from /assets lands back on
  // /assets — the page they were already on, minus the asset.
  useEffect(() => {
    if (!loaded || !vanished || projects.length === 0) return;
    navigate(`~${APP_BASE}/p/${projects[0].id}${location}`, { replace: true });
  }, [loaded, vanished, projects, location, navigate]);

  if (!loaded) return <Splash label="Opening project…" />;

  // The project list is unreadable for this user (no `assets` grant), so there
  // is nothing to check the prefix against. Render the app rather than refuse
  // it — the API still enforces what each page may load.
  if (!canListProjects) return <WorkspaceShell />;

  if (!currentProject) {
    // Deleted out from under us, with somewhere to go — the effect above is
    // already moving; showing the wall for that frame would flash an error for
    // what is a successful delete.
    if (vanished && projects.length > 0) return <Splash label="Returning…" />;

    // Deleted, and it was the last project. Keep rendering the page they are on.
    // Routes still match against the now-dead prefix, so Assets shows an empty
    // tree with its Create Asset button — which is the useful next step, and a
    // far better end state than an error page with no way forward.
    if (vanished) return <WorkspaceShell />;

    return (
      <div className="flex min-h-screen w-full items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Project unavailable</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            This project does not exist, or it has not been assigned to your
            account. Ask an administrator if you need access to it.
          </p>
          {projects.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="mt-6"
              // `~` escapes the project base, so this leaves the dead prefix
              // instead of appending to it. APP_BASE goes back on by hand.
              onClick={() => navigate(`~${APP_BASE}/p/${projects[0].id}`)}
            >
              Open {projects[0].name}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return <WorkspaceShell />;
}

/**
 * Entry point for any signed-in URL with no `/p/<id>` prefix.
 *
 * Two jobs. It keeps every pre-existing link working — `/alarm-rules` from an
 * old bookmark, an email, or the docs resolves to the last project the user had
 * open, rather than 404ing. And it is the landing step after login.
 *
 * An installation with no projects yet renders unscoped, so a brand-new
 * deployment is still usable: you cannot pick a project before creating the
 * first asset, and a redirect loop would be the only alternative.
 */
function ProjectEntry() {
  const { projects, loaded, canListProjects } = useProject();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (!loaded || projects.length === 0) return;
    const remembered = window.localStorage.getItem(LAST_PROJECT_KEY);
    const target = projects.find((p) => p.id === remembered) ?? projects[0];
    // Carry the whole address across, so a deep link keeps its query and hash.
    const suffix = location === "/" ? "" : location;
    navigate(`/p/${target.id}${suffix}${window.location.search}${window.location.hash}`, {
      replace: true,
    });
  }, [loaded, projects, location, navigate]);

  if (!loaded) return <Splash label="Loading projects…" />;
  // No projects to scope to — a fresh installation, or a user who cannot read
  // the asset list. Either way the app runs unprefixed rather than blocking.
  if (!canListProjects || projects.length === 0) return <WorkspaceShell />;
  return <Splash label="Opening project…" />;
}

function AppRouter() {
  return (
    <Switch>
      {/* Public routes — outside the app Layout (no sidebar) and outside
          <Protected>, since by definition the user has no session yet. */}
      <Route path="/login" component={Login} />
      <Route path="/activate" component={Activate} />
      <Route path="/reset-password" component={ResetPassword} />

      {/* Project-scoped: /p/<projectId>/<anything>, and the bare prefix. */}
      <Route path="/p/:projectId/*?">
        {(params) => <ProjectWorkspace projectId={params.projectId as string} />}
      </Route>

      <Route>
        <Protected>
          <ProjectProvider projectId={null}>
            <ProjectEntry />
          </ProjectProvider>
        </Protected>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <TooltipProvider>
          {/* `hook` is what puts opaque tokens in the address bar. It is set
              once here and inherited by the nested per-project router, since
              wouter resolves options as `props[k] ?? parent[k]`. Omitted when
              the switch is off, which falls back to wouter's own browser hook
              and readable URLs. */}
          <WouterRouter
            base={APP_BASE}
            hook={FEATURES.opaqueRoutes ? opaqueLocationHook : undefined}
          >
            <AppRouter />
          </WouterRouter>
          <AlarmToastListener />
          <Toaster />
          <SonnerToaster position="top-right" richColors={false} closeButton />
        </TooltipProvider>
      </UserProvider>
    </QueryClientProvider>
  );
}

export default App;
