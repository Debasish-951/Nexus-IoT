import { buildDocumentContent, type ContentItem, PLATFORM_NAME } from "./content";

export const PLATFORM_VERSION_V11 = "1.1";
export const DOC_DATE_V11 = "May 2026";

const h1 = (text: string): ContentItem => ({ type: "h1", text });
const h2 = (text: string): ContentItem => ({ type: "h2", text });
const h3 = (text: string): ContentItem => ({ type: "h3", text });
const p = (text: string): ContentItem => ({ type: "p", text });
const ul = (items: string[]): ContentItem => ({ type: "ul", items });
const ol = (items: string[]): ContentItem => ({ type: "ol", items });
const table = (headers: string[], rows: string[][]): ContentItem => ({ type: "table", headers, rows });
const code = (lang: string, text: string): ContentItem => ({ type: "code", lang, text });
const note = (text: string): ContentItem => ({ type: "note", text });
const pb = (): ContentItem => ({ type: "pagebreak" });
const divider = (): ContentItem => ({ type: "divider" });

function newChapter25(): ContentItem[] {
  return [
    pb(),

    h1("Chapter 25: What's New in v1.1"),
    h2("25.1 Overview of v1.1 Changes"),
    p("Version 1.1 of WS-Integrated Suite extends the Visualization Dashboard with four new capabilities: Statistical Process Control (SPC) reference lines, per-series labels and units of measure, drag-to-reorder widget layout, and single-corner widget resize. These changes deepen the platform's process-monitoring and data-presentation capabilities without altering existing API contracts, database schemas, or backend pipelines."),
    table(
      ["Area", "Change", "Affects"],
      [
        ["Visualization", "SPC reference lines (UCL / LCL / CL) per widget", "Chapter 10 — Widget dialog, WidgetCard render"],
        ["Visualization", "Custom label and UoM per primary and overlay series", "Chapter 10 — Widget dialog, chart legend/tooltip"],
        ["Visualization", "Drag-to-reorder widgets within a dashboard", "Chapter 10 — Dashboard canvas interaction"],
        ["Visualization", "Bottom-right corner drag to resize widgets", "Chapter 10 — Dashboard canvas interaction"],
        ["Widget Schema", "New fields: spcLines[], label, uom per series/overlay", "Chapter 16.6, Chapter 25.6"],
      ]
    ),
    pb(),

    h1("25.2 SPC Reference Lines"),
    h2("25.2.1 Purpose"),
    p("Statistical Process Control (SPC) reference lines let engineers overlay fixed horizontal markers on any Line, Area, or Bar chart widget. The three standard SPC markers are:"),
    table(
      ["Marker", "Full Name", "Typical Use"],
      [
        ["UCL", "Upper Control Limit", "Maximum acceptable value before a process is considered 'out of control'"],
        ["LCL", "Lower Control Limit", "Minimum acceptable value — violations indicate under-performance or sensor loss"],
        ["CL", "Center Line", "Process mean or target set-point — visual reference for expected operating level"],
      ]
    ),
    p("Any number of reference lines can be added to a single widget. Each line is independently configurable."),

    h2("25.2.2 Configuration"),
    p("SPC lines are configured in the Widget Dialog (click the pencil icon on any widget header). The 'Reference Lines' section appears below the metric selectors for supported chart types."),
    p("Per reference line, the following fields are available:"),
    table(
      ["Field", "Type", "Description"],
      [
        ["Type", "Select (UCL / LCL / CL / Custom)", "Selects the marker type; 'Custom' allows any label"],
        ["Value", "Number", "Y-axis value at which the line is drawn"],
        ["Color", "Color picker", "Line colour — defaults: UCL = red, LCL = blue, CL = green"],
        ["Style", "Select (solid / dashed / dotted)", "Stroke pattern of the reference line"],
        ["Label", "Text (optional)", "Short annotation displayed at the right end of the line"],
      ]
    ),
    note("SPC lines are stored in the widget's configuration inside the viz_dashboards.widgets JSONB column. They are rendered client-side using Recharts <ReferenceLine> components and are not used in server-side alarm evaluation."),

    h2("25.2.3 Rendered Appearance"),
    p("Reference lines render as full-width horizontal strokes spanning the chart plot area. Labels appear as small text anchored to the right side of the line. In dark-theme dashboards, line colors are slightly brightened to maintain contrast against the dark background."),
    ul([
      "UCL lines default to red (#ef4444) with a dashed stroke.",
      "LCL lines default to blue (#3b82f6) with a dashed stroke.",
      "CL lines default to green (#22c55e) with a solid stroke.",
      "Custom reference lines default to amber (#f59e0b).",
    ]),

    h2("25.2.4 Supported Widget Types"),
    table(
      ["Widget Type", "SPC Lines Supported", "Notes"],
      [
        ["Line", "Yes", "Full support — all SPC line types rendered"],
        ["Area", "Yes", "Full support"],
        ["Bar", "Yes", "Lines drawn at Y-axis value across bar chart"],
        ["StackedBar", "Yes", "Lines drawn at aggregate Y-axis value"],
        ["Gauge", "No", "Gauge uses min/max arcs — reference lines not applicable"],
        ["Pie / Donut", "No", "Radial charts — Y-axis concept not applicable"],
        ["KPI", "No", "Single-value display — no chart canvas"],
        ["Table", "No", "Tabular data — no chart canvas"],
        ["Heatmap", "No", "2D color grid — Y-axis varies per cell"],
        ["ScatterPlot", "Planned", "Not yet implemented — horizontal reference only"],
      ]
    ),
    pb(),

    h1("25.3 Per-Series Labels and Units of Measure"),
    h2("25.3.1 Overview"),
    p("Every metric series on a chart — both the primary metric and each of the up to four overlay series — can now carry an independent display label and unit of measure (UoM). Previously, the chart used the raw metric key (e.g., chiller.outlet_temp) as the series name. With v1.1, you can override this with a human-readable label (e.g., 'Outlet Temperature') and attach a UoM suffix (e.g., '°C')."),

    h2("25.3.2 Configuration Fields"),
    p("In the Widget Dialog, for the primary metric row and each overlay metric row, two new fields appear:"),
    table(
      ["Field", "Scope", "Description"],
      [
        ["Label", "Primary series and each overlay", "Overrides the raw metric key as the series name in legend and tooltip. Leave blank to use the metric key."],
        ["UoM", "Primary series and each overlay", "Appended to numeric values in the chart tooltip (e.g., '78.3 °C'). Replaces any UoM inherited from the asset attribute."],
      ]
    ),

    h2("25.3.3 Rendering Behaviour"),
    ul([
      "Chart legend — shows the Label value (or metric key if label is blank) for each series.",
      "Tooltip — shows 'Label: value UoM' on hover. If UoM is set, it is appended directly after the value.",
      "Multi-metric overlays — each overlay series has its own independent label and UoM, shown in the same tooltip.",
      "Export behaviour — the Label is used as the column header in any exported CSV, not the raw metric key.",
    ]),

    h2("25.3.4 Widget Schema (v1.1 additions)"),
    code("json", `{
  "id": "widget-uuid",
  "type": "line",
  "assetId": "asset-uuid",
  "metric": "chiller.outlet_temp",
  "label": "Outlet Temperature",
  "uom": "°C",
  "overlayMetrics": [
    {
      "metric": "chiller.inlet_temp",
      "label": "Inlet Temperature",
      "uom": "°C"
    },
    {
      "metric": "chiller.load_percent",
      "label": "Load",
      "uom": "%"
    }
  ],
  "spcLines": [
    { "type": "UCL", "value": 80, "color": "#ef4444", "style": "dashed", "label": "UCL 80°C" },
    { "type": "CL",  "value": 65, "color": "#22c55e", "style": "solid",  "label": "Target" }
  ]
}`),
    note("The label and uom fields are purely presentational. They do not affect how telemetry is queried, stored, or evaluated by alarm rules."),
    pb(),

    h1("25.4 Drag-to-Reorder Widgets"),
    h2("25.4.1 Overview"),
    p("Widgets in a dashboard can be reordered by dragging them to a new position. This allows operators to arrange their most important indicators at the top of the dashboard without recreating widgets."),

    h2("25.4.2 How to Use"),
    ol([
      "Open a dashboard in edit mode (click the pencil/edit icon in the dashboard toolbar, or use the widget's drag handle).",
      "Hover over a widget — a drag handle icon (⠿) appears in the widget title bar.",
      "Click and hold the drag handle, then drag the widget to the desired position in the grid.",
      "Release to drop the widget. The dashboard layout updates immediately.",
      "Click 'Save Layout' or navigate away — the new widget order is persisted automatically to the viz_dashboards record.",
    ]),
    note("Widget reordering changes the order of the widgets array in the viz_dashboards.widgets JSONB column. The new order is saved via PUT /api/viz-dashboards/:id immediately on drop."),

    h2("25.4.3 Interaction Constraints"),
    ul([
      "Dragging is available only when you have edit permission for the dashboard (Admin or the dashboard's creator).",
      "Drag-to-reorder does not change widget size — use the corner resize handle for that.",
      "Full-screen mode is not available during an active drag operation.",
    ]),
    pb(),

    h1("25.5 Single-Corner Widget Resize"),
    h2("25.5.1 Overview"),
    p("Each widget has a resize handle in its bottom-right corner. Dragging it increases or decreases the widget's grid span, allowing you to allocate more screen space to high-priority charts and condense secondary widgets."),

    h2("25.5.2 How to Use"),
    ol([
      "Hover over a widget — a small diagonal arrow icon appears in the bottom-right corner.",
      "Click and drag the corner handle. The widget expands or contracts as you drag.",
      "Widths snap to grid columns (minimum 1 column, maximum 4 columns).",
      "Heights snap to grid rows (minimum 1 row).",
      "Release to set the new size. The size is saved to the widget's configuration.",
    ]),

    h2("25.5.3 Grid System"),
    table(
      ["Columns", "Typical Use"],
      [
        ["1 column (25%)", "KPI card, status indicator, single metric"],
        ["2 columns (50%)", "Standard chart — default for most widget types"],
        ["3 columns (75%)", "Wide chart with multi-metric overlay"],
        ["4 columns (100%)", "Full-width trend chart or table widget"],
      ]
    ),
    note("Widget sizes are stored in the gridSpan field of each widget object in the viz_dashboards.widgets JSON array. Changes are auto-saved via PUT /api/viz-dashboards/:id."),
    pb(),

    h1("25.6 Updated Widget Configuration Schema (v1.1)"),
    h2("25.6.1 Complete Widget Object Reference"),
    p("The following table describes all fields in a widget configuration object as of v1.1:"),
    table(
      ["Field", "Type", "v1.0?", "v1.1?", "Description"],
      [
        ["id", "string (UUID)", "Yes", "Yes", "Unique widget identifier"],
        ["type", "string", "Yes", "Yes", "Widget type: line | area | bar | stackedbar | gauge | pie | donut | kpi | heatmap | table | scatterplot"],
        ["title", "string", "Yes", "Yes", "Widget display title"],
        ["assetId", "string (UUID)", "Yes", "Yes", "Asset to query for this widget"],
        ["metric", "string", "Yes", "Yes", "Primary metric key to display"],
        ["label", "string", "No", "NEW", "Display label for the primary series (overrides metric key in legend/tooltip)"],
        ["uom", "string", "No", "NEW", "Unit of measure for the primary series value in tooltip"],
        ["overlayMetrics", "OverlaySeries[]", "Yes (no label/uom)", "UPDATED", "Array of additional series. Each now has metric, label, uom fields."],
        ["spcLines", "SpcLine[]", "No", "NEW", "Array of SPC reference line objects: { type, value, color, style, label }"],
        ["timeRange", "string", "Yes", "Yes", "Time range preset: 15m | 1h | 6h | 24h | 7d | etc."],
        ["gridSpan", "number", "Yes", "Yes", "Column span in the dashboard grid (1–4)"],
        ["gridRowSpan", "number", "Yes", "Yes", "Row span in the dashboard grid"],
        ["refreshInterval", "number", "Yes", "Yes", "Per-widget refresh interval override in seconds (0 = use dashboard global)"],
      ]
    ),

    h2("25.6.2 OverlaySeries Object (v1.1)"),
    code("typescript", `interface OverlaySeries {
  metric: string;     // metric key to query
  label?: string;     // display name for legend/tooltip (v1.1 NEW)
  uom?: string;       // unit of measure suffix (v1.1 NEW)
  color?: string;     // override hex color for this series
}`),

    h2("25.6.3 SpcLine Object (v1.1)"),
    code("typescript", `interface SpcLine {
  type:   "UCL" | "LCL" | "CL" | "Custom";
  value:  number;                          // Y-axis position
  color?: string;                          // hex color (default by type)
  style?: "solid" | "dashed" | "dotted";  // stroke style
  label?: string;                          // annotation text
}`),

    h2("25.6.4 Backward Compatibility"),
    p("v1.1 widget objects are fully backward compatible. A widget saved with v1.0 (no label, uom, or spcLines fields) continues to render correctly — the platform treats absent optional fields as undefined/empty."),
    p("v1.1 widget objects can be read back by a v1.0 client — the unrecognised fields (label, uom, spcLines) are silently ignored."),

    divider(),
    p(`${PLATFORM_NAME} v${PLATFORM_VERSION_V11} — Platform Documentation`),
    p(`Generated: ${DOC_DATE_V11}`),
    p("This document covers all features available in the v1.1 release. For the latest updates, consult the Integration Guide within the platform."),
  ];
}

export function buildDocumentContent_v11(): ContentItem[] {
  const items: ContentItem[] = buildDocumentContent();

  // ── 1. Replace cover page version string ─────────────────────────────────
  const vIdx = items.findIndex(
    (i) => i.type === "p" && (i as { type: "p"; text: string }).text.includes("Version 1.0")
  );
  if (vIdx !== -1) {
    items[vIdx] = p(`Version ${PLATFORM_VERSION_V11}  |  ${DOC_DATE_V11}`);
  }

  // ── 2. Update TOC — extend PART II list with Chapter 25 ──────────────────
  const tocPart2Idx = items.findIndex(
    (i) =>
      i.type === "ul" &&
      (i as { type: "ul"; items: string[] }).items[0]?.includes("Chapter 15")
  );
  if (tocPart2Idx !== -1) {
    (items[tocPart2Idx] as { type: "ul"; items: string[] }).items.push(
      "Chapter 25: What's New in v1.1"
    );
  }

  // ── 3. Replace trailing footer lines (last 3 p items) ────────────────────
  const lastItems = items.slice(-4);
  lastItems.forEach((item, offset) => {
    if (
      item.type === "p" &&
      (item as { type: "p"; text: string }).text.includes("v1.0")
    ) {
      items[items.length - 4 + offset] = p(
        `${PLATFORM_NAME} v${PLATFORM_VERSION_V11} — Platform Documentation`
      );
    }
  });

  // ── 4. Inject Chapter 25 before Appendix A ───────────────────────────────
  const appendixAIdx = items.findIndex(
    (i) =>
      i.type === "h1" &&
      (i as { type: "h1"; text: string }).text.includes("Appendix A")
  );
  const ch25 = newChapter25();
  if (appendixAIdx !== -1) {
    // Remove the trailing footer lines that newChapter25() adds (last 4 items)
    // since the base document already has its own footer region
    const ch25WithoutTrailer = ch25.slice(0, ch25.length - 4);
    items.splice(appendixAIdx, 0, ...ch25WithoutTrailer);
  } else {
    items.push(...ch25);
  }

  return items;
}
