import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { RetentionPolicy } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/UserContext";
import { RoleGuard } from "@/components/RoleGuard";
import { FEATURES } from "@/lib/features";
import { cn } from "@/lib/utils";
import { Database, Play, RefreshCw, Info } from "lucide-react";
import DataManagementClassic from "./DataManagementClassic";
import { OverviewTab, type Storage, type SystemAlert } from "@/features/dataManagement/OverviewTab";
import { RetentionTab, type ChangeRequest } from "@/features/dataManagement/RetentionTab";
import { HealthTab } from "@/features/dataManagement/HealthTab";
import { ArchivesBackupsTab } from "@/features/dataManagement/ArchivesBackupsTab";
import { DatabaseTab } from "@/features/dataManagement/DatabaseTab";
import { SettingsTab } from "@/features/dataManagement/SettingsTab";
import { PolicyDialog, PreviewBox, postPreview } from "@/features/dataManagement/policy";
import { getJson, send, whole } from "@/features/dataManagement/shared";

/** Kept for reference; the developer note is no longer shown on the page. */
const SHOW_ARCHITECTURE_NOTE = false;
const TABS = ["overview", "retention", "health", "archives", "database", "settings"] as const;
type Tab = typeof TABS[number];

function initialTab(): Tab {
  const h = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
  return (TABS as readonly string[]).includes(h) ? (h as Tab) : "overview";
}

export default function DataManagement() {
  if (FEATURES.dataManagementClassic) return <DataManagementClassic />;
  return <DataManagementPage />;
}

function DataManagementPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { session } = useCurrentUser();
  // Storage and retention cover every project, so the server refuses them to
  // project-restricted users; nothing is requested for them.
  const restricted = !!session?.restrictProjects;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [confirmRun, setConfirmRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [addPolicy, setAddPolicy] = useState(false);

  useEffect(() => { try { window.history.replaceState(null, "", `#${tab}`); } catch { /* ignore */ } }, [tab]);

  const stats = useQuery<Storage>({ queryKey: ["system/storage"], queryFn: () => getJson<Storage>("/api/system/storage"), refetchInterval: 60_000, retry: 1, enabled: !restricted });
  const alerts = useQuery({ queryKey: ["system/alerts"], queryFn: () => getJson<SystemAlert[]>("/api/system/alerts"), refetchInterval: 60_000, retry: 1, enabled: !restricted });
  const changes = useQuery({ queryKey: ["system/changes"], queryFn: () => getJson<ChangeRequest[]>("/api/system/changes"), refetchInterval: 30_000, retry: 1, enabled: !restricted });
  const policies = useQuery({ queryKey: ["system/retention"], queryFn: () => getJson<RetentionPolicy[]>("/api/system/retention"), retry: 1, enabled: !restricted });
  const runPreview = useQuery({ queryKey: ["system/retention/preview", "current"], queryFn: () => postPreview({}), enabled: confirmRun, retry: false });

  function refreshAll() {
    qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("system/") });
  }

  async function runNow() {
    setRunning(true);
    try {
      const r = await send<{ pendingApproval?: boolean; totalRowsDeleted?: number }>("POST", "/api/system/retention/run");
      if (r.status === 202) toast({ title: "Waiting for approval", description: "This run deletes more than the approval limit; a second administrator must approve it on the Retention tab." });
      else toast({ title: "Pruning finished", description: `${whole.format(r.data.totalRowsDeleted ?? 0)} readings deleted.` });
      refreshAll();
    } catch (err) {
      toast({ title: "Pruning failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  async function savePolicy(data: Partial<RetentionPolicy>): Promise<boolean> {
    try {
      const r = await send<{ pendingApproval?: boolean }>("POST", "/api/system/retention", data);
      toast({ title: r.status === 202 ? "Waiting for approval" : "Policy created", description: r.status === 202 ? "A second administrator must approve it on the Retention tab." : "It applies from the next pruning run (every hour), or press Run pruning now." });
      refreshAll();
      return true;
    } catch (err) {
      toast({ title: "Could not create the policy", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      return false;
    }
  }

  if (restricted) {
    return (
      <div className="p-6 max-w-xl space-y-2">
        <h1 className="text-xl font-semibold">Data Management</h1>
        <p className="text-sm text-muted-foreground">Storage and data retention cover every project, so they are managed by administrators whose accounts are not limited to specific projects.</p>
      </div>
    );
  }

  const openAlerts = (alerts.data ?? []).filter((a) => a.status !== "cleared");
  const pending = (changes.data ?? []).filter((c) => c.status === "pending").length;
  const badge = (n: number, tone: "warn" | "info" = "warn") => n > 0 ? <span className={cn("ml-1.5 rounded-full px-1.5 text-[10px] leading-4 tabular-nums", tone === "warn" ? "bg-amber-500/20 text-amber-700 dark:text-amber-300" : "bg-primary/15 text-primary")}>{n}</span> : null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-card flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-base font-semibold flex items-center gap-2"><Database className="w-4 h-4 text-primary" /> Data Management</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Storage, growth, data health, retention, archives, backups and database health</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={refreshAll}>
            <RefreshCw className={cn("w-3.5 h-3.5", stats.isFetching && "animate-spin")} /> Refresh
          </Button>
          <RoleGuard permission="manage_assets" module="reports">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setConfirmRun(true)} disabled={running || (policies.data ?? []).length === 0}
              title={(policies.data ?? []).length === 0 ? "Add a retention policy first" : "Delete readings older than the policies allow, now"}>
              <Play className="w-3.5 h-3.5" /> {running ? "Pruning…" : "Run pruning now"}
            </Button>
          </RoleGuard>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-5 pt-3 border-b border-border bg-card overflow-x-auto">
          <TabsList className="h-9">
            <TabsTrigger value="overview" className="text-xs">Overview{badge(openAlerts.length)}</TabsTrigger>
            <TabsTrigger value="retention" className="text-xs">Retention{badge(pending)}</TabsTrigger>
            <TabsTrigger value="health" className="text-xs">Data health</TabsTrigger>
            <TabsTrigger value="archives" className="text-xs">Archives &amp; backups</TabsTrigger>
            <TabsTrigger value="database" className="text-xs">Database</TabsTrigger>
            <TabsTrigger value="settings" className="text-xs">Settings</TabsTrigger>
          </TabsList>
        </div>
        <div className="flex-1 overflow-auto p-5">
          <TabsContent value="overview" className="mt-0"><OverviewTab stats={stats} onAddPolicy={() => setAddPolicy(true)} /></TabsContent>
          <TabsContent value="retention" className="mt-0"><RetentionTab operational={stats.data?.retention.operational ?? []} pruneWindow={stats.data?.retention.pruneWindow} onChanged={refreshAll} /></TabsContent>
          <TabsContent value="health" className="mt-0"><HealthTab /></TabsContent>
          <TabsContent value="archives" className="mt-0"><ArchivesBackupsTab /></TabsContent>
          <TabsContent value="database" className="mt-0"><DatabaseTab /></TabsContent>
          <TabsContent value="settings" className="mt-0"><SettingsTab /></TabsContent>
          {SHOW_ARCHITECTURE_NOTE && (
            <section className="rounded-lg border border-border bg-muted/30 p-4 mt-6">
              <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Info className="w-3.5 h-3.5 text-primary" /> Storage Architecture</h3>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Telemetry is stored in PostgreSQL with three composite indexes optimized for time-series queries: (asset_id, metric, timestamp), (asset_id, timestamp), and (timestamp).</li>
                <li>• Retention pruning runs automatically in the background every hour; you can also trigger it manually above.</li>
                <li>• Policies are evaluated most-specific-first: a policy with both Asset ID and Metric overrides one with only Asset ID or only Metric.</li>
                <li>• The aggregation endpoint (GET /api/system/aggregate) buckets raw rows into time-averaged summaries (min/avg/max) for charting at any granularity.</li>
              </ul>
            </section>
          )}
        </div>
      </Tabs>

      <PolicyDialog open={addPolicy} onOpenChange={setAddPolicy} initial={null} onSave={savePolicy} />

      <AlertDialog open={confirmRun} onOpenChange={setConfirmRun}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run pruning now?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Readings older than the retention policies allow are deleted permanently. This cannot be undone. Summaries and readings under a legal hold are kept.</p>
                <PreviewBox mode="run" preview={runPreview.data && { ...runPreview.data, needsApproval: runPreview.data.needsApproval || undefined }} loading={runPreview.isFetching} error={runPreview.error ? (runPreview.error as Error).message : undefined} />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={runNow}>Delete old readings</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
