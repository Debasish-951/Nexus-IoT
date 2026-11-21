import type { AuditEntry } from "./shared";

// The built-in PDF fonts cover Latin-1 only.
const latin1 = (s: string) => s
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/→/g, "->")
  .replace(/[  -​  　]/g, " ").replace(/[^\x00-\xFF]/g, "?");

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "-" : typeof v === "string" ? v : JSON.stringify(v));

/** The filtered audit entries as a landscape PDF, with the filters and a page count. */
export async function downloadAuditPdf(entries: AuditEntry[], filtersText: string, total: number): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const W = 297, M = 12, CW = W - 2 * M, BOTTOM = 198;
  let y = 14;
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(30, 58, 95);
  doc.text("Audit log", M, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(90, 100, 115);
  doc.text(latin1(`Exported ${new Date().toLocaleString()}  |  ${entries.length} of ${total} entries  |  ${filtersText || "no filters"}`), M, y, { maxWidth: CW }); y += 7;

  const cols: [string, number][] = [["Time", 32], ["Action", 42], ["Result", 15], ["By", 34], ["Target", 42], ["Detail / changes", 88], ["IP", 20]];
  const header = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(40, 48, 60);
    let x = M; for (const [h, w] of cols) { doc.text(h, x, y); x += w; }
    doc.setDrawColor(200, 205, 212); doc.line(M, y + 1.2, M + CW, y + 1.2); y += 4.5;
  };
  header();
  doc.setFont("helvetica", "normal");
  for (const e of entries) {
    const changes = (e.changes ?? []).map((c) => `${c.field}: ${show(c.from)} -> ${show(c.to)}`).join("; ");
    const cells = [
      new Date(e.timestamp).toLocaleString(), e.action, e.outcome, `${e.actorName}${e.actorUsername ? ` (${e.actorUsername})` : ""}`,
      e.targetName ?? e.targetId ?? "-", [e.detail, changes].filter(Boolean).join(" | ") || "-", e.ip ?? "-",
    ].map((c) => latin1(String(c)));
    doc.setFontSize(7.5);
    const wrapped = cells.map((c, i) => (doc.splitTextToSize(c, cols[i]![1] - 2) as string[]).slice(0, 4));
    const h = Math.max(...wrapped.map((w) => w.length)) * 3.2 + 1.5;
    if (y + h > BOTTOM) { doc.addPage(); y = 14; header(); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); }
    let x = M;
    wrapped.forEach((lines, i) => {
      if (i === 2) doc.setTextColor(...(e.outcome === "success" ? [22, 130, 74] : e.outcome === "denied" ? [180, 110, 0] : [200, 38, 38]) as [number, number, number]);
      else doc.setTextColor(40, 48, 60);
      doc.text(lines, x, y); x += cols[i]![1];
    });
    y += h;
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(7); doc.setTextColor(120, 128, 140);
    doc.text(`Page ${p} of ${pages}`, W - M, 205, { align: "right" });
  }
  doc.save(`audit-log-${new Date().toISOString().slice(0, 10)}.pdf`);
}
