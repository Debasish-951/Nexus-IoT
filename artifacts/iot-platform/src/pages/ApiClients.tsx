import { useState } from "react";
import {
  useListApiClients,
  useCreateApiClient,
  useUpdateApiClient,
  useDeleteApiClient,
  getListApiClientsQueryKey,
  useCreateAsset,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useForm, Controller } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  KeyRound, Plus, Trash2, Copy, Eye, EyeOff, ChevronDown,
  CheckCircle2, XCircle, BookOpen, Shield, Zap, Bell, Clock,
  Terminal, AlertTriangle, RefreshCw, Ban, RotateCcw, Calendar, FolderOpen,
  Globe, Activity, FileDown, Heart, Info,
} from "lucide-react";
import { format, formatDistanceToNow, differenceInDays, isPast } from "date-fns";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/contexts/UserContext";
import { ReadOnlyBanner } from "@/components/RoleGuard";
import { apiGet, apiFetch } from "@/lib/auth-api";
import { describeApiError, formatApiError } from "@/lib/validation";

// ── Scope definitions ─────────────────────────────────────────────────────────
const SCOPES = [
  {
    id: "ingest:write",
    label: "Write Telemetry",
    description: "Post telemetry data to the ingest endpoint",
    icon: <Activity className="w-3.5 h-3.5" />,
    color: "text-green-600 dark:text-green-400",
    endpoint: "POST /api/ingest/payload",
  },
  {
    id: "read:assets",
    label: "Read Assets",
    description: "List assets and their current attribute values",
    icon: <Shield className="w-3.5 h-3.5" />,
    color: "text-blue-600 dark:text-blue-400",
    endpoint: "GET /api/export/assets",
  },
  {
    id: "read:telemetry",
    label: "Read Telemetry",
    description: "Query time-series sensor/metric data",
    icon: <Zap className="w-3.5 h-3.5" />,
    color: "text-purple-600 dark:text-purple-400",
    endpoint: "GET /api/export/telemetry",
  },
  {
    id: "read:alarms",
    label: "Read Alarms",
    description: "Read active alarm list",
    icon: <Bell className="w-3.5 h-3.5" />,
    color: "text-orange-600 dark:text-orange-400",
    endpoint: "GET /api/export/alarms",
  },
  {
    id: "read:alarm-history",
    label: "Read Alarm History",
    description: "Access full alarm event history",
    icon: <BookOpen className="w-3.5 h-3.5" />,
    color: "text-red-600 dark:text-red-400",
    endpoint: "GET /api/export/alarm-history",
  },
];

const ALL_SCOPES_ID = "*";
const WRITE_SCOPE_ID = "ingest:write";
/** Sentinel for the "create a new project" option in the Project select. */
const NEW_PROJECT = "__new__";

/**
 * Scopes the signed-in user may grant, resolved from the session.
 *
 * Read scopes expose asset, telemetry and alarm data through a credential that
 * outlives any session, so they belong to administrators; a normal user gets
 * write-only. An administrator can widen this per user under
 * Users → Access Control → API Clients.
 *
 * The server enforces the same ceiling on POST /api/api-clients — this only
 * decides what the form offers. A session from before `apiScopes` existed falls
 * back to write-only rather than to nothing, so nobody is locked out by a stale
 * payload.
 */
function grantableApiScopes(sessionScopes: string[] | undefined): string[] {
  if (!sessionScopes) return [WRITE_SCOPE_ID];
  if (sessionScopes.includes(ALL_SCOPES_ID)) {
    return [ALL_SCOPES_ID, ...SCOPES.map((s) => s.id)];
  }
  return sessionScopes;
}

// ── Expiry badge ───────────────────────────────────────────────────────────────
function ExpiryBadge({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  const expired = isPast(d);
  const daysLeft = differenceInDays(d, new Date());
  if (expired) return (
    <span className="inline-flex items-center gap-1 text-[9px] font-semibold bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-800 px-1.5 py-0.5 rounded-full">
      <XCircle className="w-2.5 h-2.5" /> Expired
    </span>
  );
  if (daysLeft <= 7) return (
    <span className="inline-flex items-center gap-1 text-[9px] font-semibold bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400 border border-orange-200 dark:border-orange-800 px-1.5 py-0.5 rounded-full">
      <AlertTriangle className="w-2.5 h-2.5" /> Expires {daysLeft === 0 ? "today" : `in ${daysLeft}d`}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground border border-border px-1.5 py-0.5 rounded-full">
      <Calendar className="w-2.5 h-2.5" /> {format(d, "MMM d, yyyy")}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
    active: {
      icon: <CheckCircle2 className="w-2.5 h-2.5" />, label: "Active",
      cls: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800",
    },
    inactive: {
      icon: <XCircle className="w-2.5 h-2.5" />, label: "Inactive",
      cls: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400",
    },
    revoked: {
      icon: <Ban className="w-2.5 h-2.5" />, label: "Revoked",
      cls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
    },
  };
  const s = map[status] ?? map.inactive;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border", s.cls)}>
      {s.icon}{s.label}
    </span>
  );
}

// ── Secret field ──────────────────────────────────────────────────────────────
function SecretField({ secret }: { secret: string }) {
  const [visible, setVisible] = useState(false);
  const { toast } = useToast();
  return (
    <div className="flex items-center gap-1.5">
      <code className="font-mono text-[11px] text-foreground/80 bg-muted px-1.5 py-0.5 rounded max-w-[200px] truncate">
        {visible ? secret : "••••••••••••••••••••••••"}
      </code>
      <button onClick={() => setVisible((v) => !v)} className="text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100 transition-opacity" title={visible ? "Hide" : "Reveal"}>
        {visible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
      </button>
      <button
        onClick={() => { navigator.clipboard.writeText(secret); toast({ title: "Bearer token copied" }); }}
        className="text-muted-foreground hover:text-primary opacity-60 hover:opacity-100 transition-opacity"
        title="Copy bearer token"
      >
        <Copy className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Integration guide ─────────────────────────────────────────────────────────
function IntegrationGuide({ client }: { client: Record<string, unknown> }) {
  const { toast } = useToast();
  const origin = window.location.origin;
  const secret = (client.clientSecret as string) ?? "<clientSecret>";
  const scopes = (client.scopes as string[]) ?? [];
  const allScopes = scopes.includes("*") || scopes.length === 0;

  function copy(text: string) { navigator.clipboard.writeText(text); toast({ title: "Copied" }); }

  const examples = [
    { label: "Post telemetry (ingest)", scope: "ingest:write", format: "json", cmd: `curl -s -X POST ${origin}/api/ingest/payload \\\n  -H "Authorization: Bearer ${secret}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"deviceId":"my-device-01","chiller":{"energy_kWh":15.2,"load_percent":82}}'` },
    { label: "List assets (JSON)", scope: "read:assets", format: "json", cmd: `curl -H "Authorization: Bearer ${secret}" \\\n  ${origin}/api/export/assets` },
    { label: "List assets (CSV)", scope: "read:assets", format: "csv", cmd: `curl -H "Authorization: Bearer ${secret}" \\\n  "${origin}/api/export/assets?format=csv" -o assets.csv` },
    { label: "Telemetry (last 100)", scope: "read:telemetry", format: "json", cmd: `curl -H "X-API-Key: ${secret}" \\\n  "${origin}/api/export/telemetry?limit=100"` },
    { label: "Telemetry (CSV export)", scope: "read:telemetry", format: "csv", cmd: `curl -H "X-API-Key: ${secret}" \\\n  "${origin}/api/export/telemetry?limit=500&format=csv" -o telemetry.csv` },
    { label: "Active alarms", scope: "read:alarms", format: "json", cmd: `curl -H "Authorization: Bearer ${secret}" \\\n  "${origin}/api/export/alarms?status=active"` },
    { label: "Alarm history (date range)", scope: "read:alarm-history", format: "json", cmd: `curl -H "Authorization: Bearer ${secret}" \\\n  "${origin}/api/export/alarm-history?from=2024-01-01T00:00:00Z&limit=500"` },
  ];

  return (
    <div className="space-y-4">
      {/* Auth */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Authentication</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Bearer Token", value: `Authorization: Bearer ${secret}` },
            { label: "API Key Header", value: `X-API-Key: ${secret}` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-md border bg-muted/40 px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
              <div className="flex items-center gap-1.5">
                <code className="text-[10px] font-mono text-foreground/80 flex-1 truncate">{value}</code>
                <button onClick={() => copy(value)} className="text-muted-foreground hover:text-foreground shrink-0"><Copy className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rate limit info */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2">
        <Activity className="w-3 h-3 shrink-0" />
        Rate limit: <strong className="text-foreground">120 requests / minute</strong> per client. Returns HTTP 429 with <code className="font-mono">Retry-After: 60</code> when exceeded.
      </div>

      {/* Curl examples */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">curl Examples</p>
        <div className="space-y-1.5">
          {examples.map((ex) => {
            const allowed = allScopes || scopes.includes(ex.scope);
            return (
              <div key={`${ex.scope}-${ex.format}`} className={cn("rounded-md border bg-slate-950 dark:bg-black/40", !allowed && "opacity-40")}>
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3 h-3 text-green-400" />
                    <span className="text-[10px] text-slate-300">{ex.label}</span>
                    <span className="text-[9px] font-mono text-slate-500">{ex.scope}</span>
                    {ex.format === "csv" && (
                      <span className="text-[8px] bg-yellow-900/60 text-yellow-300 px-1 rounded">CSV</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!allowed && <span className="text-[9px] text-orange-400 flex items-center gap-0.5"><AlertTriangle className="w-2.5 h-2.5" />no scope</span>}
                    <button onClick={() => copy(ex.cmd.replace(/\\\n\s+/g, " "))} className="text-slate-500 hover:text-slate-300"><Copy className="w-3 h-3" /></button>
                  </div>
                </div>
                <pre className="text-[10px] font-mono text-green-300 px-3 py-2 overflow-x-auto whitespace-pre">{ex.cmd}</pre>
              </div>
            );
          })}
        </div>
      </div>

      {/* Links */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-blue-200 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-950/20 px-3 py-2 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-blue-800 dark:text-blue-300">API Schema</p>
            <code className="text-[10px] font-mono text-blue-600 dark:text-blue-400">/api/export/schema</code>
          </div>
          <button onClick={() => copy(`${origin}/api/export/schema`)} className="text-blue-400 hover:text-blue-600"><Copy className="w-3.5 h-3.5" /></button>
        </div>
        <div className="rounded-md border border-green-200 dark:border-green-800/40 bg-green-50/50 dark:bg-green-950/20 px-3 py-2 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-green-800 dark:text-green-300">Health Check</p>
            <code className="text-[10px] font-mono text-green-600 dark:text-green-400">/api/export/health</code>
          </div>
          <button onClick={() => copy(`${origin}/api/export/health`)} className="text-green-400 hover:text-green-600"><Copy className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

// ── Rotate secret dialog ──────────────────────────────────────────────────────
function RotateDialog({
  client, open, onClose, onRefresh, issuedSecret = null,
}: {
  client: Record<string, unknown> | null; open: boolean; onClose: () => void; onRefresh: () => void;
  /**
   * A secret the server has just issued elsewhere (on create). When set, the
   * dialog opens straight on the reveal pane — the same one used after a
   * rotation — because the server returns a new secret exactly once.
   */
  issuedSecret?: string | null;
}) {
  const { toast } = useToast();
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const newSecret = issuedSecret ?? rotatedSecret;

  async function handleRotate() {
    if (!client) return;
    setLoading(true);
    try {
      const r = await apiFetch(`/api/api-clients/${client.id}/rotate-secret`, { method: "POST" });
      if (!r.ok) {
        toast({ title: "Rotation failed", description: formatApiError(await describeApiError(r)), variant: "destructive" });
        return;
      }
      const data = (await r.json()) as Record<string, unknown>;
      setRotatedSecret(data.clientSecret as string);
      onRefresh();
      toast({ title: "Secret rotated", description: "Copy and store the new token — it won't be shown again." });
    } catch (err) {
      toast({ title: "Rotation failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setRotatedSecret(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-orange-500" /> {issuedSecret ? "API Secret" : "Rotate API Secret"}
          </DialogTitle>
          <DialogDescription>
            {issuedSecret
              ? <>The secret for <strong>{client?.name as string}</strong>.</>
              : <>Generate a new secret for <strong>{client?.name as string}</strong>. The old secret will stop working immediately.</>}
          </DialogDescription>
        </DialogHeader>

        {!newSecret ? (
          <div className="space-y-4">
            <div className="rounded-md bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 px-4 py-3 text-sm text-orange-800 dark:text-orange-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold mb-1">This action is irreversible</p>
                <p className="text-xs">Any applications, scripts, or dashboards using the current secret will break immediately. Update them before rotating in production.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button variant="destructive" onClick={handleRotate} disabled={loading}>
                {loading ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                Rotate Secret
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-800 dark:text-green-300">
              <p className="font-semibold mb-2 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> {issuedSecret ? "Endpoint created" : "Secret rotated successfully"}</p>
              <p className="text-xs mb-3">Copy this now — it will <strong>not be shown again</strong> after closing this dialog.</p>
              <div className="flex items-center gap-2 bg-white dark:bg-black/40 rounded border px-3 py-2">
                <code className="font-mono text-xs text-foreground flex-1 break-all">{newSecret}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(newSecret); }}
                  className="text-green-600 hover:text-green-800 shrink-0"
                  title="Copy new secret"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────
interface CreateForm {
  name: string;
  description: string;
  /**
   * Root-level asset this client belongs to. "" = platform-wide,
   * NEW_PROJECT = create one from `newProjectName` on submit.
   */
  projectId: string;
  /** Only read when projectId === NEW_PROJECT. */
  newProjectName: string;
  scopes: string[];
  allScopes: boolean;
  expiresAt: string;
  allowedIps: string;
}

function CreateDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (client: Record<string, unknown>) => void }) {
  const { toast } = useToast();
  const { session } = useCurrentUser();
  const createClient = useCreateApiClient();
  const createAsset = useCreateAsset();
  const qc = useQueryClient();

  const grantable = grantableApiScopes(session?.apiScopes);
  const canGrantAll = grantable.includes(ALL_SCOPES_ID);
  const grantableScopes = SCOPES.filter((s) => canGrantAll || grantable.includes(s.id));
  /** Write-only user: nothing to choose, so don't render a chooser. */
  const writeOnly = grantableScopes.length === 1 && grantableScopes[0]?.id === WRITE_SCOPE_ID;
  /**
   * A project-restricted user can neither hold a platform-wide client nor create
   * a root asset, and the API refuses both. So they must pick one of their projects.
   */
  const restricted = !!session?.restrictProjects;

  const form = useForm<CreateForm>({
    // `ingest:write` is pre-selected because posting telemetry is what this
    // dialog is for — and because an empty scopes array is treated as "all
    // scopes" by apiKeyAuth, so shipping the form with none ticked would make
    // the easiest path also the most privileged one.
    defaultValues: { name: "", description: "", projectId: "", newProjectName: "", scopes: ["ingest:write"], allScopes: false, expiresAt: "", allowedIps: "" },
  });
  const watchAllScopes = form.watch("allScopes");
  const watchProjectId = form.watch("projectId");
  const watchNewProject = form.watch("newProjectName");
  const creatingProject = watchProjectId === NEW_PROJECT;

  // Projects the caller may attach a client to. The API applies the same scope
  // check on write, so this select is convenience, not the control.
  const { data: projects = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["api-client-projects"],
    queryFn: async () => {
      const res = await apiGet("/api/api-clients/projects");
      return res.ok ? res.json() : [];
    },
    staleTime: 60_000,
  });

  /**
   * What the endpoint is called when the user leaves Client Name blank.
   *
   * Naming a credential is bookkeeping, not a decision — the project is the
   * thing anyone actually looks for. So the project supplies the name, and the
   * field becomes an override rather than a required step. Shown live as the
   * input's placeholder so the derived value is never a surprise.
   */
  const derivedName = (() => {
    if (creatingProject) {
      const typed = watchNewProject.trim();
      return typed ? `${typed} Ingest` : "Ingest Endpoint";
    }
    const project = projects.find((p) => p.id === watchProjectId);
    return project ? `${project.name} Ingest` : "Ingest Endpoint";
  })();

  async function onSubmit(data: CreateForm) {
    const finalScopes = data.allScopes ? [ALL_SCOPES_ID] : data.scopes;

    // An empty scopes array is a super-key server-side (apiKeyAuth skips the
    // scope check entirely when the list is empty), so it must never be the
    // result of the user simply not choosing.
    if (!data.allScopes && finalScopes.length === 0) {
      toast({
        title: "Select at least one scope",
        description: "An endpoint saved with no scopes would be granted full access.",
        variant: "destructive",
      });
      return;
    }

    const allowedIps = data.allowedIps
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    /**
     * Resolve the project, creating it first if the user typed a new name.
     *
     * A "project" in this platform IS a root-level asset — that is what
     * api_clients.project_id points at, and what allowedProjects holds. So
     * creating one here is a real asset create, not a label: it will appear under
     * Asset Management, which is correct and is what makes the endpoint bindable.
     */
    let projectId: string | null = data.projectId || null;
    if (restricted && (!projectId || creatingProject)) {
      toast({ title: "Select a project", description: "Endpoints you create must belong to one of your projects.", variant: "destructive" });
      return;
    }
    if (creatingProject) {
      const projectName = data.newProjectName.trim();
      if (!projectName) {
        toast({ title: "Enter a project name", variant: "destructive" });
        return;
      }
      if (projects.some((p) => p.name.toLowerCase() === projectName.toLowerCase())) {
        toast({
          title: "That project already exists",
          description: "Pick it from the list instead of creating a duplicate.",
          variant: "destructive",
        });
        return;
      }
      try {
        // parentId null = root level, which is what makes it a project.
        // Empty identifier: a project groups devices, it is not itself a device —
        // the route stores `devId || null`, so this lands as a NULL device id.
        const created = await createAsset.mutateAsync({
          data: { name: projectName, identifier: "", parentId: null },
        });
        projectId = (created as unknown as { id?: string })?.id ?? null;
        if (!projectId) throw new Error("The server did not return the new project's id.");
        await qc.invalidateQueries({ queryKey: ["api-client-projects"] });
      } catch (err) {
        toast({
          title: "Could not create the project",
          description: err instanceof Error ? err.message : "The server rejected it.",
          variant: "destructive",
        });
        return;
      }
    }

    createClient.mutate(
      {
        data: {
          name: data.name.trim() || derivedName,
          scopes: finalScopes,
          description: data.description || undefined,
          // "" means unassigned — send null so the server clears it explicitly.
          projectId,
          expiresAt: data.expiresAt || undefined,
          allowedIps,
        } as Parameters<typeof createClient.mutate>[0]["data"],
      },
      {
        onSuccess: (created) => {
          toast({ title: "API endpoint created" });
          onCreated(created as unknown as Record<string, unknown>);
          form.reset();
        },
        onError: (err) => toast({ title: "Failed to create client", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="add-client-dialog">
        <DialogHeader>
          <DialogTitle>Create API End Point</DialogTitle>
          <DialogDescription>
            Pick a project and press Create. The key and its ingest URL are generated
            for you and appear under Integration Hub, ready to copy.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Name — optional. Defaults to "<Project> Ingest"; see derivedName. */}
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Client Name <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                </FormLabel>
                <FormControl>
                  <Input placeholder={derivedName} {...field} data-testid="client-name-input" />
                </FormControl>
                <FormDescription className="text-xs">
                  Leave blank to name it <span className="text-foreground">{derivedName}</span>.
                </FormDescription>
              </FormItem>
            )} />

            {/* Project — the unit a team shares. Assigning a client to a project
                means everyone mapped to that project sees and uses this one
                credential, instead of each person holding a personal key. */}
            <FormField control={form.control} name="projectId" render={({ field }) => (
              <FormItem>
                <FormLabel>Project</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {restricted
                      ? <option value="" disabled>Select a project…</option>
                      : <option value="">No project — platform-wide (admins only)</option>}
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                    {!restricted && <option value={NEW_PROJECT}>＋ Create a new project…</option>}
                  </select>
                </FormControl>
                <FormDescription>
                  {creatingProject
                    ? "The project is created as a top-level asset, then this endpoint is bound to it."
                    : projects.length === 0
                      ? restricted
                        ? "No projects are assigned to you, so you cannot create an endpoint."
                        : "No projects yet — choose “Create a new project” to make one here."
                      : "Everyone assigned to this project shares this endpoint."}
                </FormDescription>
              </FormItem>
            )} />

            {/* New project name — only when the sentinel option is selected. */}
            {creatingProject && (
              <FormField control={form.control} name="newProjectName" render={({ field }) => (
                <FormItem>
                  <FormLabel>New Project Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Plant 2 — Coimbatore" autoFocus {...field} />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Creates a top-level asset with this name. Add the devices under it in
                    Asset Hub — telemetry is only stored once a device below this
                    project carries a matching Device ID.
                  </FormDescription>
                </FormItem>
              )} />
            )}

            {/* Description */}
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea placeholder="What is this token used for?" rows={2} className="resize-none" {...field} />
                </FormControl>
              </FormItem>
            )} />

            {/* Scopes.
                A write-only user has no decision to make here, so the section
                collapses to a statement of what the key will do. Read scopes are
                an administrator's grant — see grantableApiScopes(). */}
            {writeOnly ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Access</p>
                <div className="flex items-start gap-3 p-3 rounded-lg border border-primary/50 bg-primary/5">
                  <Activity className="w-3.5 h-3.5 mt-0.5 text-green-600 dark:text-green-400 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold">Write Telemetry</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      This endpoint can post telemetry and nothing else. Read access is
                      granted by an administrator under Users → Access Control.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">Scopes</p>
              <p className="text-xs text-muted-foreground">Control what this endpoint can do.</p>

              {canGrantAll && (
              <Controller control={form.control} name="allScopes" render={({ field }) => (
                <label className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  field.value ? "border-purple-400 bg-purple-50/50 dark:bg-purple-950/20" : "border-border hover:border-muted-foreground/40"
                )}>
                  <input type="checkbox" className="mt-0.5 accent-purple-600" checked={field.value}
                    onChange={(e) => { field.onChange(e.target.checked); if (e.target.checked) form.setValue("scopes", []); }} />
                  <div>
                    <p className="text-xs font-semibold flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-purple-600" /> All Scopes (*)
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Super-key — grants full read access. Use for trusted internal integrations only.</p>
                  </div>
                </label>
              )} />
              )}

              {!watchAllScopes && (
                <Controller control={form.control} name="scopes" render={({ field }) => (
                  <div className="space-y-1.5">
                    {grantableScopes.map((s) => {
                      const checked = (field.value as string[]).includes(s.id);
                      return (
                        <label key={s.id} className={cn(
                          "flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors",
                          checked ? "border-primary/50 bg-primary/5" : "border-border hover:border-muted-foreground/30"
                        )}>
                          <input type="checkbox" className="mt-0.5 accent-blue-600" checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...(field.value as string[]), s.id]
                                : (field.value as string[]).filter((x) => x !== s.id);
                              field.onChange(next);
                            }} />
                          <div>
                            <p className={cn("text-xs font-medium flex items-center gap-1.5", s.color)}>{s.icon}{s.label}</p>
                            <p className="text-[10px] text-muted-foreground">{s.description}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )} />
              )}
            </div>
            )}

            {/* Expiry */}
            <FormField control={form.control} name="expiresAt" render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Token Expiry <span className="text-muted-foreground font-normal text-xs">(optional)</span></FormLabel>
                <FormControl>
                  <Input type="date" {...field} min={new Date().toISOString().split("T")[0]} />
                </FormControl>
                <FormDescription className="text-xs">Token will be rejected after this date. Leave blank for no expiry.</FormDescription>
              </FormItem>
            )} />

            {/* IP Allowlist */}
            <FormField control={form.control} name="allowedIps" render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> IP Allowlist <span className="text-muted-foreground font-normal text-xs">(optional)</span></FormLabel>
                <FormControl>
                  <Textarea
                    placeholder={"192.168.1.10\n10.0.0.0\n203.0.113.5"}
                    rows={3}
                    className="resize-none font-mono text-xs"
                    {...field}
                  />
                </FormControl>
                <FormDescription className="text-xs">One IP per line (or comma-separated). Leave blank to allow all IPs.</FormDescription>
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createClient.isPending}>
                {createClient.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ApiClients() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rotateClient, setRotateClient] = useState<Record<string, unknown> | null>(null);
  // The just-created client and its one-time secret, revealed through RotateDialog.
  const [createdClient, setCreatedClient] = useState<Record<string, unknown> | null>(null);
  const { canAction } = useCurrentUser();

  const { data: clients } = useListApiClients();
  const deleteClient = useDeleteApiClient();
  const updateClient = useUpdateApiClient();

  function invalidate() { qc.invalidateQueries({ queryKey: getListApiClientsQueryKey() }); }

  /** POST an action; toast success only when the server accepted it. */
  async function postAction(path: string, okTitle: string, failTitle: string) {
    try {
      const r = await apiFetch(path, { method: "POST" });
      if (!r.ok) {
        toast({ title: failTitle, description: formatApiError(await describeApiError(r)), variant: "destructive" });
        return;
      }
      toast({ title: okTitle });
      invalidate();
    } catch (err) {
      toast({ title: failTitle, description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  function handleRevoke(client: Record<string, unknown>) {
    void postAction(`/api/api-clients/${client.id}/revoke`, `"${client.name}" revoked`, "Revoke failed");
  }

  function handleRestore(client: Record<string, unknown>) {
    void postAction(`/api/api-clients/${client.id}/restore`, `"${client.name}" restored`, "Restore failed");
  }

  const clientList = (clients as unknown as Record<string, unknown>[] | undefined) ?? [];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" /> API Clients
          </h1>
          <p className="text-sm text-muted-foreground">
            Issue bearer tokens for external applications to securely ingest data and export analytics
          </p>
        </div>
        {canAction("manage_api_clients", "api_clients") && (
          <Button onClick={() => setCreateOpen(true)} size="sm" data-testid="add-client-btn">
            <Plus className="w-4 h-4 mr-1.5" /> Create API End Point
          </Button>
        )}
      </div>
      <ReadOnlyBanner permission="manage_api_clients" message="cannot create or delete API clients." />

      {/* Capability cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: <Shield className="w-4 h-4 text-blue-500" />, label: "Scoped Access", desc: "Per-client read scopes" },
          { icon: <Clock className="w-4 h-4 text-orange-500" />, label: "Token Expiry", desc: "Auto-expire credentials" },
          { icon: <Globe className="w-4 h-4 text-green-500" />, label: "IP Allowlist", desc: "Restrict by source IP" },
          { icon: <FileDown className="w-4 h-4 text-purple-500" />, label: "Ingest & Export", desc: "Write and read via API" },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-card p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">{c.icon}</div>
            <div>
              <p className="text-xs font-semibold">{c.label}</p>
              <p className="text-[10px] text-muted-foreground">{c.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Health check callout */}
      <div className="rounded-lg border border-green-200 dark:border-green-800/40 bg-green-50/50 dark:bg-green-950/10 px-4 py-2.5 flex items-center gap-3 text-xs">
        <Heart className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
        <span className="text-green-800 dark:text-green-300">
          <strong>Health endpoint:</strong> <code className="font-mono">/api/export/health</code> — no authentication required. Use it in uptime monitors (Grafana, Datadog, Zabbix).
        </span>
        <button
          onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/api/export/health`); toast({ title: "Copied" }); }}
          className="text-green-600 hover:text-green-800 shrink-0 ml-auto"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scope reference */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {SCOPES.map((s) => (
          <div key={s.id} className="rounded-lg border border-border bg-card p-3 space-y-1">
            <div className={cn("flex items-center gap-1.5 font-medium text-xs", s.color)}>{s.icon}{s.label}</div>
            <p className="text-[10px] text-muted-foreground">{s.description}</p>
            <code className="text-[9px] font-mono text-muted-foreground/80">{s.endpoint}</code>
          </div>
        ))}
      </div>

      {/* Clients table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Project</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Bearer Token</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Scopes</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Requests</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Last Used</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {!clients ? (
              Array.from({ length: 2 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : clientList.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center text-muted-foreground">
                  <KeyRound className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">No API clients yet</p>
                  <p className="text-xs mt-1 opacity-60">Create one to start exporting data securely</p>
                </td>
              </tr>
            ) : (
              clientList.flatMap((client) => {
                const isExpanded = expandedId === client.id;
                const scopes = (client.scopes as string[]) ?? [];
                const isAllScopes = scopes.includes("*") || scopes.length === 0;
                const isRevoked = client.status === "revoked";

                return [
                  <tr
                    key={client.id as string}
                    className={cn(
                      "border-b border-border/50 hover:bg-muted/20 transition-colors",
                      isExpanded && "bg-muted/10",
                      isRevoked && "opacity-60"
                    )}
                  >
                    {/* Name + description */}
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-sm leading-tight">{client.name as string}</p>
                        {Boolean(client.description) && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[180px] truncate">{client.description as string}</p>
                        )}
                        {/* Expiry + IP badges */}
                        <div className="flex flex-wrap gap-1 mt-1">
                          <ExpiryBadge expiresAt={(client.expiresAt as string | null) ?? null} />
                          {(client.allowedIps as string[])?.length > 0 && (
                            <span className="text-[9px] text-muted-foreground border border-border px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                              <Globe className="w-2 h-2" /> {(client.allowedIps as string[]).length} IP{(client.allowedIps as string[]).length !== 1 ? "s" : ""}
                            </span>
                          )}
                          {Boolean(client.secretRotatedAt) && (
                            <span className="text-[9px] text-muted-foreground border border-border px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                              <RefreshCw className="w-2 h-2" /> rotated
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Owning project — the team that shares this credential */}
                    <td className="px-4 py-3">
                      {client.projectName ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <FolderOpen className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span className="truncate max-w-[140px]">{client.projectName as string}</span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground italic">platform-wide</span>
                      )}
                    </td>

                    {/* Bearer token */}
                    <td className="px-4 py-3">
                      {/* Only credentials issued before secrets were hashed can
                          still be revealed. Everything since stores a hash, so
                          the plaintext exists exactly once — in the response to
                          the request that created or rotated it. */}
                      {client.clientSecret
                        ? <SecretField secret={client.clientSecret as string} />
                        : (
                          <span className="text-xs text-muted-foreground italic" title="Secrets are stored hashed and cannot be shown again. Use Rotate Secret to issue a new one.">
                            not retrievable
                          </span>
                        )}
                    </td>

                    {/* Scopes */}
                    <td className="px-4 py-3">
                      {isAllScopes ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 px-2 py-0.5 rounded border border-purple-200 dark:border-purple-800">
                          <Shield className="w-2.5 h-2.5" /> All
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {scopes.map((s: string) => (
                            <span key={s} className="text-[9px] font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">{s}</span>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Requests */}
                    <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground">
                      {Number(client.totalRequests ?? 0).toLocaleString()}
                    </td>

                    {/* Last used */}
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {client.lastUsedAt
                        ? <span title={format(new Date(client.lastUsedAt as string), "yyyy-MM-dd HH:mm:ss")}>
                            {formatDistanceToNow(new Date(client.lastUsedAt as string), { addSuffix: true })}
                          </span>
                        : <span className="opacity-40">Never</span>}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <StatusBadge status={client.status as string} />
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {/* Integration guide */}
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : client.id as string)}
                          className={cn(
                            "flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors",
                            isExpanded ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          )}
                          title="Integration guide"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <ChevronDown className={cn("w-3 h-3 transition-transform", isExpanded && "rotate-180")} />
                        </button>

                        {canAction("manage_api_clients", "api_clients") && (
                          <>
                            {/* Rotate */}
                            <button
                              onClick={() => setRotateClient(client)}
                              className="text-muted-foreground hover:text-orange-500 transition-colors"
                              title="Rotate secret"
                              disabled={isRevoked}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>

                            {/* Revoke / Restore */}
                            {isRevoked ? (
                              <button
                                onClick={() => handleRestore(client)}
                                className="text-muted-foreground hover:text-green-600 transition-colors"
                                title="Restore (un-revoke)"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleRevoke(client)}
                                className="text-muted-foreground hover:text-destructive transition-colors"
                                title="Revoke token"
                              >
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Delete */}
                            <button
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              onClick={() => deleteClient.mutate({ id: client.id as string }, {
                                onSuccess: () => {
                                  toast({ title: "Client deleted" });
                                  invalidate();
                                  if (expandedId === client.id) setExpandedId(null);
                                },
                                onError: (err) => toast({ title: "Delete failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
                              })}
                              title="Permanently delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>,

                  isExpanded && (
                    <tr key={`${client.id as string}-guide`} className="border-b border-border/50 bg-muted/5">
                      <td colSpan={8} className="px-6 py-5">
                        <div className="flex items-center gap-2 mb-4">
                          <BookOpen className="w-4 h-4 text-primary" />
                          <h3 className="text-sm font-semibold">Integration Guide — {client.name as string}</h3>
                          <div className="flex gap-1.5 ml-2">
                            {(client.allowedIps as string[])?.length > 0 && (
                              <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full border">
                                IPs: {(client.allowedIps as string[]).join(", ")}
                              </span>
                            )}
                          </div>
                        </div>
                        <IntegrationGuide client={client} />
                      </td>
                    </tr>
                  ),
                ].filter(Boolean);
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Dialogs */}
      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => {
          invalidate();
          setCreateOpen(false);
          setExpandedId(created.id as string);
          // The server returns the secret exactly once; show it now or it is lost.
          if (typeof created.clientSecret === "string" && created.clientSecret) setCreatedClient(created);
        }}
      />

      <RotateDialog
        client={rotateClient}
        open={rotateClient !== null}
        onClose={() => setRotateClient(null)}
        onRefresh={invalidate}
      />

      <RotateDialog
        client={createdClient}
        open={createdClient !== null}
        onClose={() => setCreatedClient(null)}
        onRefresh={invalidate}
        issuedSecret={(createdClient?.clientSecret as string | undefined) ?? null}
      />
    </div>
  );
}
