import { useRef, useState } from "react";
import { useT } from "@/i18n";
import { ReadingTrend } from "./ReadingTrend";
import { DataSourceCard } from "./DataSource";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ChevronRight, Copy, Link2, RotateCw, Trash2, Upload, X } from "lucide-react";
import { useMetricChoices } from "@/features/dashboards/useWidgetData";
import { fetchAssetMetrics } from "./api";
import { fmtReading, hex, type AreaStat, type PlantEngine, type Reading } from "./engine/engine";
import { FAM, GBEH, MODELS } from "./engine/models";
import { MED } from "./engine/packs";

const NONE = "__none";
const STATUS_TEXT: Record<string, string> = { ok: "text-foreground", warn: "text-amber-500", crit: "text-red-500", off: "text-muted-foreground", nolink: "text-muted-foreground" };
const DOT: Record<string, string> = { ok: "bg-green-500", warn: "bg-amber-500", crit: "bg-red-500 pt-blink", off: "bg-slate-500", nolink: "bg-slate-500" };
const Section = ({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) => {
  const t = useT();
  return (
    <div className={cn("space-y-2", className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t(title)}</h3>
      {children}
    </div>
  );
};

/* ---------- process bar ---------- */
export function FlowBar({ engine, stats, plantName }: { engine: PlantEngine; stats: AreaStat[]; plantName: string }) {
  const t = useT();
  const byId = new Map(stats.map((s) => [s.id, s]));
  const has = (id: string) => (byId.get(id)?.total ?? 0) > 0;
  const proc = engine.areas.filter((a) => a.enabled && !a.util && has(a.id));
  const util = engine.areas.filter((a) => a.enabled && a.util && has(a.id));
  const step = (id: string, name: string, sub: string, color?: number) => {
    const s = byId.get(id);
    const pressed = id === "*" ? !engine.focusId : engine.focusId === id;
    return (
      <button key={id} onClick={() => engine.focusArea(id === "*" ? null : id)} aria-pressed={pressed}
        className={cn("relative shrink-0 text-left rounded-md border px-3 py-1.5 pl-6 min-w-[120px] transition-colors",
          pressed ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50",
          s?.worst === "crit" && "border-red-500/70")}>
        <span className={cn("absolute left-2.5 top-3 w-2 h-2 rounded-full", DOT[s?.worst ?? "ok"])} />
        <div className="text-sm font-semibold whitespace-nowrap flex items-center gap-1.5">
          {color !== undefined && <span className="inline-block w-2 h-2 rounded-sm" style={{ background: hex(color) }} />}{t(name)}
        </div>
        <div className="text-[11px] text-muted-foreground whitespace-nowrap">{sub.startsWith("→ ") ? `→ ${t(sub.slice(2))}` : t(sub)}</div>
        <div className="text-[10.5px] font-mono text-muted-foreground whitespace-nowrap">
          {s ? `${s.linked}/${s.total} ${t("live")}${s.alarms ? ` · ${t("{n} alarm(s)", { n: s.alarms })}` : ""}` : ""}
        </div>
      </button>
    );
  };
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
      {step("*", "Whole plant", t(plantName))}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground px-2 shrink-0 whitespace-nowrap">
        <Switch checked={engine.iso} onCheckedChange={(b) => engine.setIso(b)} className="scale-75" /> {t("Only the chosen area")}
      </label>
      {proc.map((a, i) => (
        <div key={a.id} className="flex items-stretch gap-1 shrink-0">
          {i > 0 && <ChevronRight className="w-4 h-4 self-center text-muted-foreground" />}
          {step(a.id, a.name, a.out ? `→ ${a.out}` : "", a.color)}
        </div>
      ))}
      {util.length > 0 && <div className="w-px bg-border mx-1 shrink-0" />}
      {util.map((a) => step(a.id, a.name, "Serves the process areas", a.color))}
    </div>
  );
}

/* ---------- process tree ---------- */
export function ProcessTree({ engine, readOnly }: { engine: PlantEngine; readOnly: boolean }) {
  const t = useT();
  const sel = engine.selected;
  return (
    <Section title="Process stages">
      <p className="text-xs text-muted-foreground">{t("Click an area to go to it. Untick the stages this plant does not have; the layout is rebuilt and asset links are kept.")}</p>
      <div className="space-y-1.5">
        {engine.areas.map((A) => {
          const its = engine.items.filter((i) => i.area === A.id);
          return (
            <div key={A.id} className="rounded-md border border-border bg-muted/30">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Checkbox checked={A.enabled} disabled={readOnly} onCheckedChange={(b) => engine.setStage(A.id, null, !!b)} aria-label={`Include ${A.name}`} />
                <button className="flex-1 min-w-0 text-left text-sm font-semibold truncate hover:underline underline-offset-2 flex items-center gap-1.5" onClick={() => engine.focusArea(A.id)}>
                  <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: hex(A.color) }} />{A.name}
                </button>
                <span className="text-[11px] font-mono text-muted-foreground">{its.length}</span>
              </div>
              {A.subs.map((S, si) => {
                const subIts = its.filter((i) => i.sub === S.name);
                return (
                  <div key={S.name} className="border-t border-border/60 px-2 py-1 pl-3 space-y-1">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={S.enabled} disabled={readOnly || !A.enabled} onCheckedChange={(b) => engine.setStage(A.id, si, !!b)} />{S.name}
                    </label>
                    {subIts.length > 0 && (
                      <div className="flex flex-wrap gap-1 pl-6">
                        {subIts.map((i) => (
                          <button key={i.id} onClick={() => { engine.select(i.id); engine.fitItem(i.id); }}
                            className={cn("text-[11px] font-mono rounded border px-1.5 py-px bg-card",
                              i === sel ? "border-primary bg-primary/15" : "border-border",
                              i.status === "warn" && "text-amber-500 border-amber-500/50", i.status === "crit" && "text-red-500 border-red-500")}>
                            {i.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {engine.items.some((i) => !engine.areas.some((a) => a.id === i.area)) && (
          <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5 space-y-1">
            <div className="text-sm font-semibold">{t("No area")}</div>
            <div className="flex flex-wrap gap-1">
              {engine.items.filter((i) => !engine.areas.some((a) => a.id === i.area)).map((i) => (
                <button key={i.id} onClick={() => engine.select(i.id)} className="text-[11px] font-mono rounded border border-border px-1.5 py-px bg-card">{i.name}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

/* ---------- inspector ---------- */
function ReadingRow({ r, assetId, metrics, readOnly, onBind }: { r: Reading; assetId: string | null; metrics: { key: string; label: string }[]; readOnly: boolean; onBind: (m: string) => void }) {
  const t = useT();
  return (
    <div className="py-1 border-b border-border/60 space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground truncate">{t(r.n)}</span>
        <span className={cn("font-mono tabular-nums", STATUS_TEXT[r.status])}>
          {r.source === "none" ? t("not linked") : fmtReading(r)}
          {r.source === "demo" && <span className="ml-1 text-[10px] rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1">{t("demo")}</span>}
          {r.source === "live" && <span className="ml-1 text-[10px] rounded bg-green-500/15 text-green-600 dark:text-green-400 px-1">{t("live")}</span>}
        </span>
      </div>
      <ReadingTrend value={r.value} source={r.source} status={r.status} assetId={assetId} metric={r.metric} />
      {(
        <Select value={r.metric ?? NONE} onValueChange={(v) => onBind(v === NONE ? "" : v)} disabled={readOnly || !assetId}>
          <SelectTrigger className="h-7 text-xs" aria-label={t("Attribute for {name}", { name: t(r.n) })}><SelectValue placeholder={t("pick a data source first")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{assetId ? t("Not linked") : t("pick a data source first")}</SelectItem>
            {r.metric && !metrics.some((m) => m.key === r.metric) && <SelectItem value={r.metric}>{r.metric}</SelectItem>}
            {metrics.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export function Inspector({ engine, assets, readOnly }: { engine: PlantEngine; assets: { id: string; name: string }[]; readOnly: boolean }) {
  const t = useT();
  const it = engine.selected;
  const metrics = useMetricChoices(it?.assetId ?? undefined);
  if (!it) {
    return (
      <Section title="Selected machine">
        <p className="text-xs text-muted-foreground">{readOnly ? (engine.areas.length ? t("Click a machine in the 3D view or in the process stages below to see its readings.") : t("Click a machine in the 3D view to see its readings.")) : <>{engine.areas.length ? t("Click a machine in the 3D view or in the process stages below to connect its data source.") : t("Click a machine in the 3D view to connect its data source.")} {t("Drag a machine to move it.")} <kbd className="px-1 border rounded text-[10px]">R</kbd> {t("rotates")}, <kbd className="px-1 border rounded text-[10px]">Del</kbd> {t("removes")}.</>}</p>
      </Section>
    );
  }
  const m = MODELS[it.type];
  const area = engine.areas.find((a) => a.id === it.area);
  const readings = engine.readings(it.id);
  const binds = engine.bindList(it.id);
  const tagLabel = (k: string) => {
    if (k.endsWith("*")) { const ts = it.tags.filter((t) => t.k.startsWith(k.slice(0, -1)) && /\d$/.test(t.k)); return ts.length ? `${ts[0].n.replace(/ \d+$/, "")} 1–${ts.length}` : k; }
    return it.tags.find((t) => t.k === k)?.n ?? k;
  };
  const mine = engine.conns.filter((c) => c.a === it.id || c.b === it.id);
  return (
    <div className="space-y-4">
      <Section title="Selected machine">
        <Input value={it.name} disabled={readOnly} onChange={(e) => engine.setName(it.id, e.target.value)} className="h-8" aria-label={t("Machine name")} />
        <p className="text-xs text-muted-foreground">{t(m.name)} · {t(FAM[m.fam])}{area ? ` · ${area.name}${it.sub ? " › " + it.sub : ""}` : ""}</p>
      </Section>

      <Section title="Data source">
        <Label className="text-xs">{t("Data Source")}</Label>
        <Select value={it.assetId ?? NONE} disabled={readOnly} onValueChange={(v) => {
          const assetId = v === NONE ? null : v;
          if (!assetId) { engine.setAsset(it.id, null, []); return; }
          fetchAssetMetrics(assetId).then((ms) => engine.setAsset(it.id, assetId, ms));
        }}>
          <SelectTrigger className="h-8 text-sm" aria-label={t("Data Source")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("— none (sample data) —")}</SelectItem>
            {it.assetId && !assets.some((a) => a.id === it.assetId) && <SelectItem value={it.assetId}>{t("Asset outside this project")}</SelectItem>}
            {assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {it.assetId ? t("Each reading is matched to an attribute of the asset by name. Change any match below.") : t("Pick the asset this machine is (its data source), then the attribute for each reading, as in a Visualization widget. Until then it shows sample data.")}
        </p>
        <Label className="text-xs pt-1 block">{t("Attribute")}</Label>
        <div>
          {readings.map((r) => <ReadingRow key={r.k} r={r} assetId={it.assetId ?? null} metrics={metrics} readOnly={readOnly} onBind={(mm) => engine.setBinding(it.id, r.k, mm)} />)}
        </div>
        <DataSourceCard assetId={it.assetId} readings={readings.map((r) => ({ k: r.k, n: r.n, metric: r.metric }))} />
      </Section>

      <Section title="Moves with">
        <div className="text-xs space-y-0.5">
          {binds.map((b, i) => (
            <div key={i} className="flex justify-between gap-2 border-b border-border/60 py-0.5">
              <span className="text-muted-foreground truncate">{t(b[0])} · {t(b[1])}</span><span className="font-mono shrink-0">{tagLabel(b[2])}</span>
            </div>
          ))}
        </div>
      </Section>

      {!readOnly && (
        <Section title="Settings">
          <div className="space-y-1">
            <Label className="text-xs">{t("Process area")}</Label>
            <Select value={it.area || NONE} onValueChange={(v) => engine.setArea(it.id, v === NONE ? "" : v)}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("No area")}</SelectItem>
                {engine.areas.filter((a) => a.enabled).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {Object.entries(m.params).map(([k, d]) => d.opts ? (
            <div key={k} className="space-y-1">
              <Label className="text-xs">{d.l}</Label>
              <Select value={String(it.params[k])} onValueChange={(v) => engine.setParam(it.id, k, v, true)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{d.opts.map((op) => <SelectItem key={op} value={op}>{op}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : (
            <div key={k} className="space-y-1.5">
              <div className="flex justify-between text-xs"><Label className="text-xs">{d.l}</Label><span className="font-mono">{(d.step ?? 1) < 1 ? Number(it.params[k]).toFixed((d.step ?? 1) < 0.1 ? 2 : 1) : it.params[k]}</span></div>
              <Slider min={d.min} max={d.max} step={d.step} value={[Number(it.params[k])]}
                onValueChange={([v]) => engine.setParam(it.id, k, v, false)} onValueCommit={([v]) => engine.setParam(it.id, k, v, true)} />
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => engine.rotateItem(it.id)}><RotateCw className="w-3.5 h-3.5 mr-1" />{t("Rotate")}</Button>
            <Button size="sm" variant="outline" onClick={() => engine.duplicateItem(it.id)}><Copy className="w-3.5 h-3.5 mr-1" />{t("Duplicate")}</Button>
            <Button size="sm" variant={engine.connectingFrom === it ? "default" : "outline"} onClick={() => engine.startConnect(engine.connectingFrom === it ? null : it.id)}><Link2 className="w-3.5 h-3.5 mr-1" />{t("Connect to…")}</Button>
            <Button size="sm" variant="outline" className="text-red-500" onClick={() => engine.removeItem(it.id)}><Trash2 className="w-3.5 h-3.5 mr-1" />{t("Delete")}</Button>
          </div>
          {engine.demo && (
            <div className="flex flex-wrap gap-4 text-xs">
              <label className="flex items-center gap-2"><Switch checked={it.running} onCheckedChange={(b) => engine.setRunning(it.id, b)} className="scale-75" />{t("Running (demo)")}</label>
              <label className="flex items-center gap-2"><Checkbox checked={it.fault} onCheckedChange={(b) => engine.setFault(it.id, !!b)} />{t("Simulate fault (demo)")}</label>
            </div>
          )}
        </Section>
      )}

      {it.type === "glb" && !readOnly && (
        <Section title="Part behaviours">
          {(it.gb || []).map((b, i) => (
            <div key={i} className="grid grid-cols-3 gap-1">
              <Select value={b.mesh} onValueChange={(v) => engine.setGlbBehaviour(it.id, i, "mesh", v)}><SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger><SelectContent>{(it.glbNames || []).map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent></Select>
              <Select value={b.beh} onValueChange={(v) => engine.setGlbBehaviour(it.id, i, "beh", v)}><SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger><SelectContent>{GBEH.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent></Select>
              <Select value={b.k} onValueChange={(v) => engine.setGlbBehaviour(it.id, i, "k", v)}><SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger><SelectContent>{it.tags.map((t) => <SelectItem key={t.k} value={t.k}>{t.n}</SelectItem>)}</SelectContent></Select>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => engine.addGlbBehaviour(it.id)}>{t("Add part behaviour")}</Button>
        </Section>
      )}

      {mine.length > 0 && (
        <Section title="Connections">
          {mine.map((c) => {
            const other = engine.items.find((x) => x.id === (c.a === it.id ? c.b : c.a));
            return (
              <div key={c.id} className="flex items-center gap-1.5 text-xs">
                <span className="flex-1 min-w-0 truncate text-muted-foreground">{c.a === it.id ? "to" : "from"} {other?.name ?? "?"}</span>
                <Select value={c.medium} disabled={readOnly} onValueChange={(v) => engine.setConnMedium(c.id, v)}>
                  <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(MED).map(([k, v]) => <SelectItem key={k} value={k}>{v.n}</SelectItem>)}</SelectContent>
                </Select>
                {!readOnly && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => engine.removeConn(c.id)} aria-label={t("Remove connection")}><X className="w-3.5 h-3.5" /></Button>}
              </div>
            );
          })}
        </Section>
      )}
    </div>
  );
}

/* ---------- add machine ---------- */
export function AddMachine({ engine, onMessage }: { engine: PlantEngine; onMessage: (text: string, error?: boolean) => void }) {
  const t = useT();
  const [area, setArea] = useState<string>(engine.focusId ?? engine.areas.find((a) => a.enabled)?.id ?? NONE);
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaId = area === NONE ? "" : area;
  const fams = Object.entries(FAM).map(([f, label]) => ({ f, label, models: Object.entries(MODELS).filter(([, md]) => md.fam === f && !md.hidden) })).filter((x) => x.models.length);
  return (
    <Section title="Add machine">
      <div className="space-y-1">
        <Label className="text-xs">{t("Add to area")}</Label>
        <Select value={engine.areas.some((a) => a.id === area && a.enabled) ? area : NONE} onValueChange={setArea}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {engine.areas.filter((a) => a.enabled).map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            <SelectItem value={NONE}>{t("No area")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        {fams.map(({ f, label, models }) => (
          <div key={f} className="rounded-md border border-border">
            <button className="w-full flex items-center justify-between px-2 py-1.5 text-sm font-medium" onClick={() => setOpen(open === f ? null : f)} aria-expanded={open === f}>
              <span>{label} <span className="text-xs text-muted-foreground">({models.length})</span></span>
              <ChevronRight className={cn("w-4 h-4 transition-transform", open === f && "rotate-90")} />
            </button>
            {open === f && (
              <div className="flex flex-wrap gap-1 px-2 pb-2">
                {models.map(([k, md]) => (
                  <Button key={k} size="sm" variant="outline" className="h-7 text-xs" onClick={() => engine.addMachine(k, areaId)}>+ {md.name}</Button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <input ref={fileRef} type="file" accept=".glb,model/gltf-binary" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
        engine.addGlb(f, areaId).then((msg) => onMessage(`${msg} Uploaded models stay in this session only; saving them is not built yet.`))
          .catch((err) => onMessage(`This file could not be read as a .glb model: ${err?.message ?? err}`, true));
      }} />
      <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload className="w-3.5 h-3.5 mr-1" />{t("Upload your own 3D model (.glb)")}</Button>
      <p className="text-xs text-muted-foreground">{t("An uploaded model is shown for this session only. It is not saved with the twin yet.")}</p>
    </Section>
  );
}
