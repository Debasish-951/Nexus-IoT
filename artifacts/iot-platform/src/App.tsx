import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import Dashboard from "@/pages/Dashboard";
import Assets from "@/pages/Assets";
import AssetDetails from "@/pages/AssetDetails";
import AssetManagement from "@/pages/AssetManagement";
import HierarchyGenerator from "@/pages/HierarchyGenerator";
import AssetTemplates from "@/pages/AssetTemplates";
import AssetTemplateDetails from "@/pages/AssetTemplateDetails";
import Alarms from "@/pages/Alarms";
import AlarmHistory from "@/pages/AlarmHistory";
import AlarmRules from "@/pages/AlarmRules";
import Users from "@/pages/Users";
import SecurityCenter from "@/pages/SecurityCenter";
import Brokers from "@/pages/Brokers";
import ApiClients from "@/pages/ApiClients";
import Settings from "@/pages/Settings";
import MediaLibrary from "@/pages/MediaLibrary";
import NotificationGroups from "@/pages/NotificationGroups";
import IngestSimulator from "@/pages/IngestSimulator";
import Destinations from "@/pages/Destinations";
import DataExplorerHome from "@/pages/DataExplorerHome";
import IntegrationGuide from "@/pages/NodeRedDocs";
import IntegrationHub from "@/pages/IntegrationHub";
import ActivityLog from "@/pages/ActivityLog";
import DataManagement from "@/pages/DataManagement";
import Reports from "@/pages/Reports";
import Visualization from "@/pages/Visualization";
import LiveFeed from "@/pages/LiveFeed";
import AICopilot from "@/pages/AICopilot";

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
 */
const ROUTES: { path: string; component: React.ComponentType; module?: string }[] = [
  { path: "/",                     component: Dashboard,            module: "dashboard" },
  { path: "/asset-management",     component: AssetManagement,      module: "assets" },
  { path: "/hierarchy-generator",  component: HierarchyGenerator,   module: "assets" },
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
  { path: "/simulator",            component: IngestSimulator,      module: "brokers" },
  { path: "/api-clients",          component: ApiClients,           module: "api_clients" },
  { path: "/data-explorer",        component: DataExplorerHome,     module: "explorer" },
  { path: "/ai-copilot",           component: AICopilot,            module: "explorer" },
  { path: "/activity-log",         component: ActivityLog,          module: "activity_log" },
  { path: "/data-management",      component: DataManagement,       module: "reports" },
  { path: "/reports",              component: Reports,              module: "reports" },
  { path: "/visualization",        component: Visualization,        module: "visualization" },
  { path: "/live",                 component: LiveFeed,             module: "live" },
  // Personal preferences — available to anyone signed in.
  { path: "/settings",             component: Settings },
];

function AppRouter() {
  return (
    <Switch>
      {/* Public routes — outside the app Layout (no sidebar) and outside
          <Protected>, since by definition the user has no session yet. */}
      <Route path="/login" component={Login} />
      <Route path="/activate" component={Activate} />
      <Route path="/reset-password" component={ResetPassword} />

      <Route>
        <Protected>
          <Layout>
            <Switch>
              {ROUTES.map(({ path, component: Component, module }) => (
                <Route key={path} path={path}>
                  <Protected module={module}>
                    <Component />
                  </Protected>
                </Route>
              ))}
              <Route component={NotFound} />
            </Switch>
          </Layout>
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
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
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
