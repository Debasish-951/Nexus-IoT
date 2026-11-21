import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/contexts/UserContext";
import { CheckCircle2, XCircle, AlertTriangle, HardDrive, Archive, Download, RotateCcw, ShieldCheck, CloudUpload } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorLine, Section, StatCard, Table, ago, download, fmtBytes, getJson, send, td, tdr, th, thr, whole } from "./shared";

interface BackupRun { id: string; startedAt: string; finishedAt: string | null; status: string; sizeBytes: number | null; location: string | null; includesUploads: boolean; verified: boolean; offsite: boolean; host: string | null; message: string | null }
interface Backups { runs: BackupRun[]; lastGood: BackupRun | null; lastGoodAgeHours: number | null; maxAgeHours: number; ok: boolean }
interface ArchiveFile { id: string; day: string; rows: number; bytes: number; sha256: string; createdAt: string; restoredAt: string | null; restoredBy: string | null; restoredRows: number | null }
interface Archives { enabled: boolean; path: string; archivedUntil: string | null; error: string | null; files: ArchiveFile[] }

export function ArchivesBackupsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { canAction } = useCurrentUser();
  const canManage = canAction("manage_assets", "data_management");
  const backups = useQuery({ queryKey: ["system/backups"], queryFn: () => getJson<Backups>("/api/system/backups"), refetchInterval: 5 * 60_000, retry: 1 });
  const archives = useQuery({ queryKey: ["system/archives"], queryFn: () => getJson<Archives>("/api/system/archives"), retry: 1 });
  const [restore, setRestore] = useState<ArchiveFile | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  const months = useMemo(() => {
    const m = new Map<string, ArchiveFile[]>();
    for (const f of archives.data?.files ?? []) { const k = f.day.slice(0, 7); m.set(k, [...(m.get(k) ?? []), f]); }
    return [...m.entries()];
  }, [archives.data]);

  async function doRestore(f: ArchiveFile) {
    try {
      const r = await send<{ inserted: number }>("POST", `/api/system/archives/${f.id}/restore`);
      toast({ title: `Restored ${f.day}`, description: `${whole.format(r.data.inserted)} readings put back. A legal hold keeps them until you release it (Retention tab).` });
      qc.invalidateQueries({ queryKey: ["system/archives"] }); qc.invalidateQueries({ queryKey: ["system/holds"] }); qc.invalidateQueries({ queryKey: ["system/storage"] });
    } catch (err) {
      toast({ title: "Restore failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }

  const b = backups.data;
  const a = archives.data;
  return (
    <div className="space-y-6">
      <Section title="Backups" hint="Reported by the backup script on the server (scripts/ops/nexus-backup.sh) after every run. The app cannot see backups that do not report.">
        {backups.isError ? <ErrorLine error={backups.error} onRetry={() => backups.refetch()} /> : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <StatCard icon={b?.ok ? CheckCircle2 : AlertTriangle} tone={b ? (b.ok ? "good" : "bad") : undefined} label="Backup status"
                value={backups.isLoading ? "…" : !b?.runs.length ? "No backup reported" : b.ok ? "Up to date" : b.runs[0]?.status !== "ok" ? "Last backup failed" : "Out of date"}
                sub={b?.maxAgeHours ? `Alert after ${b.maxAgeHours} h without a good backup` : "Age alert is off"} />
              <StatCard icon={HardDrive} label="Last good backup" value={backups.isLoading ? "…" : b?.lastGood ? ago(b.lastGood.finishedAt ?? b.lastGood.startedAt) : "—"} sub={b?.lastGood ? format(new Date(b.lastGood.startedAt), "PPp") : undefined} />
              <StatCard icon={Archive} label="Last backup size" value={backups.isLoading ? "…" : fmtBytes(b?.lastGood?.sizeBytes ?? null)} sub={b?.lastGood?.location ?? undefined} />
              <StatCard icon={CloudUpload} label="Copied off the server" value={backups.isLoading ? "…" : b?.lastGood ? (b.lastGood.offsite ? "Yes" : "No") : "—"} tone={b?.lastGood && !b.lastGood.offsite ? "warn" : undefined} sub="A backup on the same server is lost with it" />
            </div>
            {!backups.isLoading && !b?.runs.length && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1 mb-3">
                <p className="font-medium text-sm">No backup has reported yet</p>
                <p>Install <code className="font-mono">scripts/ops/nexus-backup.sh</code> as the nightly backup (see docs/operations/backup-restore.md) and allow it to report once with <code className="font-mono">GRANT INSERT ON backup_runs TO nexus_backup;</code>. Back up <code className="font-mono">SECRETS_ENC_KEY</code> separately in your password manager: without it, a restored database cannot read its stored secrets.</p>
              </div>
            )}
            <Table empty={(b?.runs.length ?? 0) === 0 && false} head={
              <tr><th className={th}>Started</th><th className={th}>Result</th><th className={thr}>Size</th><th className={th}>Checks</th><th className={th}>Server</th><th className={th}>Message</th></tr>
            }>
              {(b?.runs ?? []).slice(0, 20).map((r) => (
                <tr key={r.id}>
                  <td className={td} title={format(new Date(r.startedAt), "PPpp")}>{ago(r.startedAt)}</td>
                  <td className={td}>{r.status === "ok" ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="w-3 h-3" /> OK</span> : <span className="inline-flex items-center gap-1 text-red-500"><XCircle className="w-3 h-3" /> Failed</span>}</td>
                  <td className={tdr}>{fmtBytes(r.sizeBytes)}</td>
                  <td className={td}>{[r.includesUploads && "uploads", r.verified && "read back", r.offsite && "off-site"].filter(Boolean).join(", ") || "—"}</td>
                  <td className={td}>{r.host ?? "—"}</td>
                  <td className={cn(td, "text-muted-foreground")}>{r.message ?? ""}</td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Section>

      <Section title="Archive before delete" hint="With archiving on (Settings tab), each day of raw readings is written to a compressed file before pruning may delete it. Download a day for your records or put it back into the database.">
        {archives.isError ? <ErrorLine error={archives.error} onRetry={() => archives.refetch()} /> : (
          <>
            <div className="rounded-lg border border-border p-3 text-xs mb-3 flex flex-wrap gap-x-6 gap-y-1">
              <span className="font-medium">{a?.enabled ? <span className="text-emerald-600 dark:text-emerald-400">Archiving is on</span> : <span className="text-muted-foreground">Archiving is off: pruning deletes without keeping a file</span>}</span>
              <span>Folder: <code className="font-mono">{a?.path ?? "—"}</code></span>
              <span>Archived up to: {a?.archivedUntil ? format(new Date(a.archivedUntil), "PP") : "nothing yet"}</span>
              <span>{whole.format(a?.files.length ?? 0)} day file(s), {fmtBytes((a?.files ?? []).reduce((n, f) => n + f.bytes, 0))}</span>
              {a?.error && <span className="text-red-500 w-full">Last archiving run failed: {a.error}. Pruning waits until it works.</span>}
            </div>
            <Table empty={months.length === 0 && (archives.isLoading ? "Loading…" : a?.enabled ? "No days archived yet. Days are archived just before pruning would delete them." : "No archive files.")} head={
              <tr><th className={th}>Month</th><th className={thr}>Days</th><th className={thr}>Readings</th><th className={thr}>Size</th><th className={th}></th></tr>
            }>
              {months.map(([m, files]) => (
                <Fragment key={m}>
                  <tr className="cursor-pointer" onClick={() => setOpenMonth(openMonth === m ? null : m)}>
                    <td className={cn(td, "font-medium")}>{format(new Date(`${m}-01T00:00:00Z`), "MMMM yyyy")}</td>
                    <td className={tdr}>{files.length}</td>
                    <td className={tdr}>{whole.format(files.reduce((n, f) => n + f.rows, 0))}</td>
                    <td className={tdr}>{fmtBytes(files.reduce((n, f) => n + f.bytes, 0))}</td>
                    <td className={cn(td, "text-primary")}>{openMonth === m ? "Hide days" : "Show days"}</td>
                  </tr>
                  {openMonth === m && files.map((f) => (
                    <tr key={f.id} className="bg-muted/10">
                      <td className={cn(td, "pl-6")}>{f.day}{f.restoredAt && <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><ShieldCheck className="w-3 h-3" /> restored {ago(f.restoredAt)}</span>}</td>
                      <td className={tdr}></td>
                      <td className={tdr}>{whole.format(f.rows)}</td>
                      <td className={tdr}>{fmtBytes(f.bytes)}</td>
                      <td className={td}>
                        {canManage && <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => download(`/api/system/archives/${f.id}/download`, `telemetry-${f.day}.jsonl.gz`).catch((e) => toast({ title: "Download failed", description: String(e), variant: "destructive" }))}><Download className="w-3.5 h-3.5" /> Download</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setRestore(f)}><RotateCcw className="w-3.5 h-3.5" /> Restore</Button>
                        </div>}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </Table>
          </>
        )}
      </Section>

      <AlertDialog open={!!restore} onOpenChange={(v) => { if (!v) setRestore(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {restore?.day}?</AlertDialogTitle>
            <AlertDialogDescription>
              Puts {whole.format(restore?.rows ?? 0)} readings back into the database; readings still there are skipped. A legal hold is placed on the day so the next pruning run does not delete them again. Release the hold when you are done.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const f = restore; setRestore(null); if (f) void doRestore(f); }}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
