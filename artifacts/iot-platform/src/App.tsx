import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
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
import IngestSimulator from "@/pages/IngestSimulator";

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
        <Route path="/settings" component={Settings} />
        <Route path="/simulator" component={IngestSimulator} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
