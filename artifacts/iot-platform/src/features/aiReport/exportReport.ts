import { toCsv, downloadCsvText } from "@/lib/csv";
import { INVESTIGATION_MODE_LABEL, LEVEL_LABEL, STATUS_LABEL, TOOL_LABEL, URGENCY_LABEL, incompleteMessages, type AiReport, type KpiCard, type ReportNarrative } from "./types";

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : "-");
const num = (v: number | null | undefined, d = 2) => (v == null ? "" : Number.isInteger(v) ? String(v) : v.toFixed(d));
export const fileBase = (r: AiReport) => `ai-report-${r.level}-${r.facts.scope.name.replace(/[^\w-]+/g, "_").slice(0, 40)}-${r.generatedAt.slice(0, 10)}`;
export const cardValue = (c: KpiCard, v: number | null) => (v == null ? "-" : `${Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 1 })}${c.unit === "%" || c.unit === "/100" ? c.unit : c.unit ? ` ${c.unit}` : ""}`);

/** Every computed figure as one CSV (sections separated by a blank line). */
export function downloadFactsCsv(r: AiReport): void {
  const f = r.facts;
  const parts: string[] = [];
  parts.push(toCsv(["Report", "Value"], [
    ["Level", LEVEL_LABEL[r.level]], ["Scope", f.scope.name], ["From", f.range.from], ["To", f.range.to],
    ["Previous from", f.previous.from], ["Previous to", f.previous.to], ["Generated", r.generatedAt],
    ["Assets", f.kpis.assets], ["Assets reporting", f.kpis.assetsReporting], ["Stale assets", f.kpis.staleAssets],
    ["In maintenance", f.kpis.inMaintenance], ["Metrics", f.kpis.metricsTracked], ["Readings", f.kpis.readings],
    ["Data coverage %", f.kpis.dataCoveragePct ?? ""], ["Energy used kWh", f.kpis.energyUsedKwh ?? ""],
    ["Plant health score", f.healthScore.score ?? ""], ["Previous health score", f.healthScore.prevScore ?? ""],
    ["Health score formula", f.healthScore.formula],
    ...incompleteMessages(f).map((m) => ["Incomplete", m]),
    ...(r.alarmsIncluded ? [
      ["Alarms", f.kpis.alarms], ...Object.entries(f.kpis.alarmsBySeverity).map(([k, v]) => [`Alarms ${k}`, v]),
      ["Still open", f.kpis.stillOpen], ["MTTA minutes", f.kpis.mttaMinutes ?? ""], ["MTTR minutes", f.kpis.mttrMinutes ?? ""],
      ["Previous alarms", f.previousKpis.alarms], ["Previous MTTA minutes", f.previousKpis.mttaMinutes ?? ""], ["Previous MTTR minutes", f.previousKpis.mttrMinutes ?? ""],
    ] : []),
  ]));
  parts.push(toCsv(["KPI", "Value", "Previous", "Unit", "Change %", "Trend"], f.kpiCards.map((c) => [c.label, c.value ?? "", c.prev ?? "", c.unit, c.changePct ?? "", c.trend ?? ""])));
  parts.push(toCsv(["Asset", "Status", "Alarms", "Open alarms", "Coverage %", "Last data"], f.assetHealth.map((h) => [h.assetName, STATUS_LABEL[h.status], h.alarms, h.openAlarms, h.coveragePct ?? "", h.lastSeen ?? ""])));
  parts.push(toCsv(["Asset", "Metric", "Readings", "Min", "Avg", "Max", "Previous avg", "Change %"],
    f.metrics.map((m) => [m.assetName, m.metric, m.readings, m.min ?? "", m.avg ?? "", m.max ?? "", m.prevAvg ?? "", m.changePct ?? ""])));
  if (f.correlations.length) parts.push(toCsv(["Asset", "Metric A", "Metric B", "Correlation r", "Points"], f.correlations.map((c) => [c.assetName, c.metricA, c.metricB, c.r, c.points])));
  if (f.leadingSignals.length) parts.push(toCsv(["Asset", "Alarm", "Metric before alarm", "Direction", "Before alarm avg", "Normal avg", "z-score", "Alarms"], f.leadingSignals.map((s) => [s.assetName, s.alarm, s.metric, s.direction, s.beforeAvg, s.normalAvg, s.zScore, s.alarms])));
  if (r.alarmsIncluded && f.alarmAssets.length) parts.push(toCsv(["Asset", "Alarms", "Critical", "High"], f.alarmAssets.map((a) => [a.assetName, a.total, a.critical, a.high])));
  if (r.alarmsIncluded && f.repeatAlarms.length) parts.push(toCsv(["Repeat alarm", "Asset", "Severity", "Count", "First", "Last", "Median gap minutes"], f.repeatAlarms.map((a) => [a.name, a.assetName, a.severity, a.count, a.firstAt, a.lastAt, a.medianGapMinutes ?? ""])));
  if (r.alarmsIncluded && f.kpis.alarms) parts.push(toCsv(["Hour of day", "Alarms"], f.alarmTiming.byHour.map((v, h) => [h, v])));
  if (f.maintenance.length) parts.push(toCsv(["Asset in maintenance", "Since", "Hours in period"], f.maintenance.map((m) => [m.assetName, m.since ?? "", m.hoursInPeriod ?? ""])));
  if (f.dataQuality.stale.length) parts.push(toCsv(["Stale asset", "Last data"], f.dataQuality.stale.map((s) => [s.assetName, s.lastSeen ?? "never"])));
  if (f.dataQuality.lowCoverage.length) parts.push(toCsv(["Asset", "Data coverage %"], f.dataQuality.lowCoverage.map((c) => [c.assetName, c.coveragePct])));
  if (f.dataQuality.stuck.length) parts.push(toCsv(["Possibly stuck sensor", "Metric", "Value", "Readings"], f.dataQuality.stuck.map((s) => [s.assetName, s.metric, s.value, s.readings])));
  downloadCsvText(parts.join("\n\n"), `${fileBase(r)}.csv`);
}

// The standard PDF fonts cover Latin-1 only: typographic punctuation is mapped to
// plain characters and anything else outside Latin-1 is replaced by "?".
const latin1 = (s: string) => s
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
  .replace(/…/g, "...").replace(/•/g, "-").replace(/→/g, "->").replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ").replace(/\u2212/g, "-")
  .replace(/[^\x00-\xFF]/g, "?");

/**
 * PDF of the report as shown, with the narrative as edited. The PDF is in
 * English (the AI writes English and the built-in PDF fonts are Latin-1). The
 * executive report is limited to 5 pages; the rest is in the CSV.
 */
export async function downloadReportPdf(r: AiReport, narrative: ReportNarrative | null): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 16, CW = W - 2 * M, BOTTOM = 282;
  const maxPages = r.level === "executive" ? 5 : 40;
  let y = 18, cut = false;
  const need = (h: number) => {
    if (cut) return false;
    if (y + h <= BOTTOM) return true;
    if (doc.getNumberOfPages() >= maxPages) { cut = true; return false; }
    doc.addPage(); y = 18; return true;
  };
  const text = (s: string, size = 10, style: "normal" | "bold" | "italic" = "normal", color: [number, number, number] = [40, 48, 60], indent = 0) => {
    if (!s) return;
    doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(latin1(s), CW - indent) as string[];
    for (const ln of lines) { if (!need(size * 0.45)) return; doc.text(ln, M + indent, y); y += size * 0.45; }
    y += 1.2;
  };
  const heading = (s: string) => { y += 2; if (!need(14)) return; text(s, 12.5, "bold", [29, 78, 216]); };
  const bullets = (items: string[]) => items.filter(Boolean).forEach((s) => text(`- ${s}`, 10, "normal", [40, 48, 60], 2));
  const table = (head: string[], rows: (string | number)[][], widths: number[]) => {
    const row = (cells: (string | number)[], bold: boolean) => {
      if (!need(6)) return;
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(8.5); doc.setTextColor(40, 48, 60);
      let x = M;
      cells.forEach((c, i) => { doc.text(latin1(String(c)).slice(0, Math.floor(widths[i]! * 0.55)), x, y); x += widths[i]!; });
      y += 4.6;
    };
    row(head, true);
    if (!cut) { doc.setDrawColor(209, 213, 219); doc.line(M, y - 3.4, M + CW, y - 3.4); }
    rows.forEach((rw) => row(rw, false));
    y += 2;
  };
  const cards = (list: KpiCard[]) => {
    if (!list.length) return;
    const cols = 3, w = (CW - (cols - 1) * 4) / cols, h = 19;
    for (let i = 0; i < list.length; i += cols) {
      if (!need(h + 3)) return;
      list.slice(i, i + cols).forEach((c, j) => {
        const x = M + j * (w + 4);
        doc.setDrawColor(209, 213, 219); doc.setFillColor(248, 250, 252); doc.roundedRect(x, y, w, h, 2, 2, "FD");
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(107, 114, 128); doc.text(latin1(c.label), x + 3, y + 5);
        doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(30, 41, 59); doc.text(latin1(cardValue(c, c.value)), x + 3, y + 11.5);
        const col: [number, number, number] = c.trend === "better" ? [22, 163, 74] : c.trend === "worse" ? [220, 38, 38] : [107, 114, 128];
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...col);
        const ch = c.changePct == null ? "" : ` (${c.changePct > 0 ? "+" : ""}${c.changePct}%)`;
        doc.text(latin1(c.prev == null ? "no previous value" : `previous ${cardValue(c, c.prev)}${ch}${c.trend ? `, ${c.trend}` : ""}`), x + 3, y + 16.5);
      });
      y += h + 3;
    }
  };

  const f = r.facts;
  type RGB = [number, number, number];
  const legend = (items: [string, RGB][]) => {
    if (!need(6)) return;
    let x = M;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    for (const [label, c] of items) {
      const w = doc.getTextWidth(latin1(label)) + 9;
      if (x + w > M + CW) { y += 5; x = M; if (!need(6)) return; }
      doc.setFillColor(...c); doc.rect(x, y - 2.6, 3, 3, "F");
      doc.setTextColor(40, 48, 60); doc.text(latin1(label), x + 4.5, y);
      x += w;
    }
    y += 6;
  };
  /** Asset status bar, as on screen. */
  const statusBar = () => {
    const order = ["ok", "alarm", "stale", "silent", "maintenance"] as const;
    const colors: Record<string, RGB> = { ok: [34, 197, 94], alarm: [220, 38, 38], stale: [234, 179, 8], silent: [148, 163, 184], maintenance: [59, 130, 246] };
    const total = order.reduce((n, k) => n + (f.statusCounts[k] ?? 0), 0);
    heading("Asset status at the end of the period");
    if (!need(12)) return;
    let x = M;
    if (total) for (const k of order) { const w = ((f.statusCounts[k] ?? 0) / total) * CW; if (w > 0) { doc.setFillColor(...colors[k]!); doc.rect(x, y, w, 4.5, "F"); x += w; } }
    else { doc.setFillColor(229, 231, 235); doc.rect(M, y, CW, 4.5, "F"); }
    y += 9;
    legend(order.map((k) => [`${STATUS_LABEL[k]} ${f.statusCounts[k] ?? 0}`, colors[k]!] as [string, RGB]));
  };
  /** Grouped vertical bars with value labels. */
  const bars = (title: string, cats: string[], series: { name: string; color: RGB; values: number[] }[], h = 42) => {
    heading(title);
    if (!need(h + 14)) return;
    const max = Math.max(1, ...series.flatMap((sr) => sr.values));
    const top = y, base = y + h, slot = CW / cats.length, bw = Math.min(9, (slot * 0.7) / series.length);
    doc.setDrawColor(209, 213, 219); doc.line(M, base, M + CW, base);
    doc.setFontSize(7); doc.setFont("helvetica", "normal");
    cats.forEach((c, i) => {
      const x0 = M + i * slot + (slot - bw * series.length) / 2;
      series.forEach((sr, j) => {
        const v = sr.values[i] ?? 0, bh = (v / max) * (h - 6);
        if (bh > 0) { doc.setFillColor(...sr.color); doc.rect(x0 + j * bw, base - bh, bw - 0.6, bh, "F"); }
        if (v) { doc.setTextColor(75, 85, 99); doc.text(String(v), x0 + j * bw + bw / 2 - 0.3, base - bh - 1, { align: "center" }); }
      });
      doc.setTextColor(107, 114, 128); doc.text(latin1(c), M + i * slot + slot / 2, base + 4, { align: "center" });
    });
    y = top + h + 9;
    legend(series.map((sr) => [sr.name, sr.color] as [string, RGB]));
  };
  const SEV = ["critical", "high", "medium", "low", "info"] as const;
  const severityChart = () => bars("Alarms by severity, against the previous period", [...SEV],
    [{ name: "Previous period", color: [148, 163, 184], values: SEV.map((k) => f.previousKpis.alarmsBySeverity[k] ?? 0) },
     { name: "This period", color: [37, 99, 235], values: SEV.map((k) => f.kpis.alarmsBySeverity[k] ?? 0) }]);
  const healthNote = () => {
    const hs = f.healthScore;
    if (hs.score == null) return;
    text(`Plant health score: availability ${num(hs.parts.availabilityPct, 1)}%, data coverage ${num(hs.parts.coveragePct, 1)}%${hs.parts.alarmBurdenPerAssetDay != null ? `, alarm load ${num(hs.parts.alarmBurdenPerAssetDay)} per asset per day` : ""}. Formula: ${hs.formula}`, 7.5, "normal", [107, 114, 128]);
  };
  text(`AI Report - ${LEVEL_LABEL[r.level]}`, 17, "bold", [30, 58, 95]);
  text(`${f.scope.name}  |  ${fmtDate(f.range.from)} - ${fmtDate(f.range.to)}  |  compared with ${fmtDate(f.previous.from)} - ${fmtDate(f.previous.to)}`, 9.5);
  text(`Generated ${fmtDate(r.generatedAt)}${r.model ? `  |  written sections are AI-generated (${r.model}) from the computed figures` : ""}`, 8, "normal", [107, 114, 128]);
  if (!narrative && r.narrativeError) text(r.narrativeError, 9, "italic", [146, 64, 14]);
  if (narrative && r.unverifiedNumbers.length) {
    text(`Check before sharing: these numbers in the AI text were not found in the computed figures or the database lookups: ${r.unverifiedNumbers.join(", ")}`, 8.5, "italic", [146, 64, 14]);
  }
  for (const m of incompleteMessages(f)) text(m, 8.5, "italic", [146, 64, 14]);

  if (r.level === "executive") {
    const n = narrative?.level === "executive" ? narrative : null;
    if (n) { y += 2; text(n.headline, 13, "bold", [30, 41, 59]); text(n.summary); }
    heading("Key figures against the previous period");
    cards(f.kpiCards);
    healthNote();
    if (n?.risks.length) {
      heading("Top risks");
      n.risks.forEach((rk, i) => {
        text(`${i + 1}. ${rk.title}`, 10.5, "bold");
        if (rk.what) text(`What: ${rk.what}`, 9.5, "normal", [40, 48, 60], 4);
        if (rk.impact) text(`Why it matters: ${rk.impact}`, 9.5, "normal", [40, 48, 60], 4);
        if (rk.cause) text(`Likely cause: ${rk.cause}`, 9.5, "normal", [40, 48, 60], 4);
        if (rk.decision) text(`Recommended decision: ${rk.decision}`, 9.5, "bold", [40, 48, 60], 4);
      });
    }
    if (n?.decisions.length) { heading("Decisions needed"); bullets(n.decisions); }
    if (n) { heading("What improved"); if (n.improvements.length) bullets(n.improvements); else text("Nothing noted.", 10, "normal", [107, 114, 128]); }
    if (n?.outlook) { heading("Outlook for the next period"); text(n.outlook); }
    statusBar();
    if (r.alarmsIncluded) severityChart();
    const attention = f.assetHealth.filter((h) => h.status !== "ok").slice(0, 8);
    heading("Assets needing attention");
    if (!attention.length) text("Every reporting asset is healthy.", 10, "normal", [107, 114, 128]);
    else {
      table(["Asset", "Status", "Alarms", "Open", "Coverage"], attention.map((h) => [h.assetName, STATUS_LABEL[h.status], h.alarms, h.openAlarms, h.coveragePct == null ? "-" : `${h.coveragePct}%`]), [70, 40, 22, 22, 24]);
    }
  } else if (r.level === "manager") {
    const n = narrative?.level === "manager" ? narrative : null;
    if (n) { heading("Summary"); text(n.summary); }
    heading("Key figures against the previous period");
    cards(f.kpiCards);
    if (n?.problemAreas.length) {
      heading("Problem areas, highest impact first");
      n.problemAreas.forEach((p, i) => {
        text(`${i + 1}. ${p.area}: ${p.issue}`, 10, "bold");
        if (p.impact) text(`Impact: ${p.impact}`, 9.5, "normal", [40, 48, 60], 4);
        if (p.cause) text(`Likely cause: ${p.cause}`, 9.5, "normal", [40, 48, 60], 4);
      });
    }
    if (r.alarmsIncluded) {
      heading("Response performance");
      if (n?.response) text(n.response);
      table(["", "This period", "Previous period"], [
        ["Alarms", f.kpis.alarms, f.previousKpis.alarms],
        ["Mean time to acknowledge (min)", num(f.kpis.mttaMinutes, 1) || "-", num(f.previousKpis.mttaMinutes, 1) || "-"],
        ["Mean time to clear (min)", num(f.kpis.mttrMinutes, 1) || "-", num(f.previousKpis.mttrMinutes, 1) || "-"],
      ], [80, 49, 49]);
    }
    if (n?.patterns.length) { heading("Patterns"); bullets(n.patterns); }
    if (r.alarmsIncluded && f.repeatAlarms.length) {
      table(["Repeat alarm", "Asset", "Count", "Median gap (min)"], f.repeatAlarms.map((a) => [a.name, a.assetName, a.count, num(a.medianGapMinutes, 1) || "-"]), [60, 60, 24, 34]);
    }
    if (n?.priorities.length) {
      heading("Team priorities");
      n.priorities.forEach((p, i) => text(`${i + 1}. ${p.action}${p.owner ? `  (owner: ${p.owner})` : ""}`, 10));
    }
    if (r.alarmsIncluded && f.kpis.alarms) {
      severityChart();
      bars(`Alarms by hour of day (${f.alarmTiming.timeZone})`, f.alarmTiming.byHour.map((_, h) => (h % 3 === 0 ? String(h) : "")),
        [{ name: "Alarms", color: [37, 99, 235], values: f.alarmTiming.byHour }], 36);
    }
    if (r.alarmsIncluded && f.alarmAssets.length) {
      heading("Assets with most alarms");
      table(["Asset", "Alarms", "Critical", "High"], f.alarmAssets.map((a) => [a.assetName, a.total, a.critical, a.high]), [90, 30, 30, 28]);
    }
  } else {
    const n = narrative?.level === "engineer" ? narrative : null;
    if (n) { heading("Summary"); text(n.summary); }
    heading("Key figures");
    cards(f.kpiCards);
    if (n?.diagnoses.length) {
      heading("Diagnosis per asset");
      n.diagnoses.forEach((d) => {
        text(`${d.asset}  (confidence: ${d.confidence})`, 10, "bold");
        if (d.observation) text(`Observed: ${d.observation}`, 9.5, "normal", [40, 48, 60], 4);
        if (d.correlated) text(`Related signals: ${d.correlated}`, 9.5, "normal", [40, 48, 60], 4);
        if (d.rootCause) text(`Likely root cause: ${d.rootCause}`, 9.5, "normal", [40, 48, 60], 4);
      });
    }
    if (f.leadingSignals.length) {
      heading("Signals that changed before alarms");
      table(["Asset", "Alarm", "Metric", "Before alarm", "Normal", "z"], f.leadingSignals.map((s) => [s.assetName, s.alarm, `${s.metric} (${s.direction})`, num(s.beforeAvg), num(s.normalAvg), s.zScore]), [36, 38, 40, 24, 22, 18]);
    }
    if (f.correlations.length) {
      heading("Metrics that moved together");
      table(["Asset", "Metric A", "Metric B", "r", "Points"], f.correlations.map((c) => [c.assetName, c.metricA, c.metricB, c.r, c.points]), [50, 44, 44, 20, 20]);
    }
    if (n?.alarmSequence.length) { heading("Alarm sequence"); bullets(n.alarmSequence); }
    if (n?.dataIssues.length) { heading("Sensor and data issues"); bullets(n.dataIssues); }
    if (n?.actions.length) {
      heading("Maintenance actions");
      n.actions.forEach((a, i) => text(`${i + 1}. [${URGENCY_LABEL[a.urgency]}] ${a.action}`, 10));
    }
    if (f.trends.length) {
      heading("Trends of the biggest changes");
      const cw = (CW - 6) / 2, ch = 26;
      for (let i = 0; i < f.trends.length; i += 2) {
        if (!need(ch + 9)) break;
        f.trends.slice(i, i + 2).forEach((tr, j) => {
          const x = M + j * (cw + 6), pts = tr.points.filter((p) => p.v != null).map((p) => ({ t: new Date(p.t).getTime(), v: p.v }));
          doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(107, 114, 128);
          doc.text(latin1(`${tr.assetName} - ${tr.metric}`).slice(0, 70), x, y);
          doc.setDrawColor(229, 231, 235); doc.rect(x, y + 1.5, cw, ch);
          if (pts.length > 1) {
            const vs = pts.map((p) => p.v as number), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
            const t0 = pts[0]!.t, t1 = pts[pts.length - 1]!.t, ts = t1 - t0 || 1;
            const px = (p: { t: number }) => x + 1 + ((p.t - t0) / ts) * (cw - 2), py = (v: number) => y + 1.5 + ch - 1 - ((v - lo) / span) * (ch - 2);
            doc.setDrawColor(37, 99, 235); doc.setLineWidth(0.4);
            for (let k = 1; k < pts.length; k++) doc.line(px(pts[k - 1]!), py(vs[k - 1]!), px(pts[k]!), py(vs[k]!));
            doc.setLineWidth(0.2); doc.setFontSize(6.5); doc.setTextColor(107, 114, 128);
            doc.text(num(hi), x + cw - 1, y + 4.5, { align: "right" }); doc.text(num(lo), x + cw - 1, y + ch, { align: "right" });
          }
        });
        y += ch + 7;
      }
    }
    if (f.topMovers.length) {
      heading("Biggest changes against the previous period");
      table(["Asset", "Metric", "Average", "Previous", "Change"], f.topMovers.map((m) => [m.assetName, m.metric, num(m.avg), num(m.prevAvg), m.changePct == null ? "" : `${m.changePct}%`]), [50, 50, 26, 26, 26]);
    }
    if (f.dataQuality.stale.length || f.dataQuality.lowCoverage.length || f.dataQuality.stuck.length) {
      heading("Data quality");
      if (f.dataQuality.stale.length) table(["Stale asset", "Last data"], f.dataQuality.stale.map((s) => [s.assetName, s.lastSeen ? fmtDate(s.lastSeen) : "never"]), [90, 88]);
      if (f.dataQuality.lowCoverage.length) table(["Asset", "Data coverage"], f.dataQuality.lowCoverage.map((c) => [c.assetName, `${c.coveragePct}%`]), [90, 88]);
      if (f.dataQuality.stuck.length) table(["Possibly stuck sensor", "Metric", "Value", "Readings"], f.dataQuality.stuck.map((s) => [s.assetName, s.metric, num(s.value), s.readings]), [60, 60, 30, 28]);
    }
  }

  // Appendix: how the AI text was written, so a reader can judge it.
  const inv = r.investigation;
  if (narrative && inv && inv.mode !== "none") {
    heading("Investigation");
    text(`${INVESTIGATION_MODE_LABEL[inv.mode]}. ${inv.toolCalls} read-only database lookup(s), limited to this scope and period, in ${Math.round(inv.durationMs / 1000)} s.`, 9);
    inv.steps.forEach((st, i) => text(`${i + 1}. ${TOOL_LABEL[st.tool] ?? st.tool}${st.summary ? ` - ${st.summary}` : ""}`, 8.5, "normal", [40, 48, 60], 2));
  }

  const foot = "Figures are computed from the platform database. The written sections are AI-generated from those figures and should be checked before decisions are made.";
  if (cut) {
    // Shortened to the page limit: note it at the foot of the last page.
    doc.setFont("helvetica", "italic"); doc.setFontSize(8); doc.setTextColor(107, 114, 128);
    doc.text(latin1(`Shortened to ${maxPages} pages; every figure is in the CSV export. ${foot}`).slice(0, 190), M, 290, { maxWidth: CW });
  } else {
    y += 2;
    text(foot, 8, "italic", [107, 114, 128]);
  }
  doc.save(`${fileBase(r)}.pdf`);
}
