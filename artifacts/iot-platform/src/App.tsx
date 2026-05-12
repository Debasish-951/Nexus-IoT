import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import { UserProvider } from "@/contexts/UserContext";
import AlarmToastListener from "@/components/AlarmToastListener";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Assets from "@/pages/Assets";
import AssetTemplates from "@/pages/AssetTemplates";
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
import DataExplorer from "@/pages/DataExplorer";
import IntegrationGuide from "@/pages/NodeRedDocs";
import IntegrationHub from "@/pages/IntegrationHub";
import ActivityLog from "@/pages/ActivityLog";
import DataManagement from "@/pages/DataManagement";
import Reports from "@/pages/Reports";
import Visualization from "@/pages/Visualization";
import LiveFeed from "@/pages/LiveFeed";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

function AppRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/assets" component={Assets} />
        <Route path="/asset-templates" component={AssetTemplates} />
        <Route path="/alarms" component={Alarms} />
        <Route path="/alarm-history" component={AlarmHistory} />
        <Route path="/alarm-rules" component={AlarmRules} />
        <Route path="/users" component={Users} />
        <Route path="/brokers" component={Brokers} />
        <Route path="/api-clients" component={ApiClients} />
        <Route path="/destinations" component={Destinations} />
        <Route path="/data-explorer" component={DataExplorer} />
        <Route path="/integrations" component={IntegrationHub} />
        <Route path="/integration-guide" component={IntegrationGuide} />
        <Route path="/activity-log" component={ActivityLog} />
        <Route path="/data-management" component={DataManagement} />
        <Route path="/reports" component={Reports} />
        <Route path="/visualization" component={Visualization} />
        <Route path="/live" component={LiveFeed} />
        <Route path="/settings" component={Settings} />
        <Route path="/media-library" component={MediaLibrary} />
        <Route path="/notification-groups" component={NotificationGroups} />
        <Route path="/simulator" component={IngestSimulator} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
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
