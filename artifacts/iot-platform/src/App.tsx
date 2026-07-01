import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import { UserProvider } from "@/contexts/UserContext";
import AlarmToastListener from "@/components/AlarmToastListener";
import NotFound from "@/pages/not-found";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Assets from "@/pages/Assets";
import AssetDetails from "@/pages/AssetDetails";
import AssetManagement from "@/pages/AssetManagement";
import AssetTemplates from "@/pages/AssetTemplates";
import AssetTemplateDetails from "@/pages/AssetTemplateDetails";
import Alarms from "@/pages/Alarms";
import AlarmHistory from "@/pages/AlarmHistory";
import AlarmRules from "@/pages/AlarmRules";
import Users from "@/pages/Users";
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
      retry: 1,
      staleTime: 10_000,
    },
  },
});

function AppRouter() {
  const [location, navigate] = useLocation();
  const authed = typeof window !== "undefined" && localStorage.getItem("ws_authed") === "1";

  // Gate: send unauthenticated users to the login screen.
  useEffect(() => {
    if (!authed && location !== "/login") navigate("/login", { replace: true });
  }, [authed, location, navigate]);

  return (
    <Switch>
      {/* Login lives outside the app Layout (no sidebar). */}
      <Route path="/login" component={Login} />
      <Route>
        <Layout>
          <Switch>
            <Route path="/" component={Dashboard} />
        <Route path="/asset-management" component={AssetManagement} />
        <Route path="/assets" component={Assets} />
        <Route path="/assets/:id" component={AssetDetails} />
        <Route path="/asset-templates" component={AssetTemplates} />
        <Route path="/asset-templates/:id" component={AssetTemplateDetails} />
        <Route path="/alarms" component={Alarms} />
        <Route path="/alarm-history" component={AlarmHistory} />
        <Route path="/alarm-rules" component={AlarmRules} />
        <Route path="/users" component={Users} />
        <Route path="/brokers" component={Brokers} />
        <Route path="/api-clients" component={ApiClients} />
        <Route path="/destinations" component={Destinations} />
        <Route path="/data-explorer" component={DataExplorerHome} />
        <Route path="/integrations" component={IntegrationHub} />
        <Route path="/integration-guide" component={IntegrationGuide} />
        <Route path="/activity-log" component={ActivityLog} />
        <Route path="/data-management" component={DataManagement} />
        <Route path="/reports" component={Reports} />
        <Route path="/visualization" component={Visualization} />
        <Route path="/live" component={LiveFeed} />
        <Route path="/ai-copilot" component={AICopilot} />
        <Route path="/settings" component={Settings} />
        <Route path="/media-library" component={MediaLibrary} />
        <Route path="/notification-groups" component={NotificationGroups} />
            <Route path="/simulator" component={IngestSimulator} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
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
