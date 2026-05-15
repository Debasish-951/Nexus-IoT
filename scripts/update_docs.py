#!/usr/bin/env python3
"""
Update the existing IS_1777740407843.docx with newly added platform functionality,
then export both DOCX and PDF outputs.
"""

import os, copy
from datetime import date
from docx import Document
from docx.shared import Pt, Cm, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether, ListFlowable, ListItem
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY

TODAY   = date.today().strftime("%B %d, %Y")
SRC     = "attached_assets/IS_1777740407843.docx"
OUT_DIR = "docs"
DOCX_OUT = os.path.join(OUT_DIR, "Platform_Documentation_v2.0.docx")
PDF_OUT  = os.path.join(OUT_DIR, "Platform_Documentation_v2.0.pdf")

os.makedirs(OUT_DIR, exist_ok=True)

# ── colour helpers ─────────────────────────────────────────────────────────────
NAVY   = RGBColor(0x1e, 0x3a, 0x5f)
CYAN   = RGBColor(0x06, 0xb6, 0xd4)
MUTED  = RGBColor(0x64, 0x74, 0x8b)
WHITE  = RGBColor(0xFF, 0xFF, 0xFF)

def _set_cell_bg(cell, hex_color):
    tc   = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd  = OxmlElement("w:shd")
    shd.set(qn("w:val"),   "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"),  hex_color)
    tcPr.append(shd)

def add_heading(doc, text, level=1, size_pt=13):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(size_pt)
    run.font.color.rgb = NAVY
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after  = Pt(4)
    return p

def add_subheading(doc, text, size_pt=11):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(size_pt)
    run.font.color.rgb = NAVY
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after  = Pt(3)
    return p

def add_body(doc, text, size_pt=10):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(size_pt)
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.left_indent = Cm(0.4)
    return p

def add_bullet(doc, text, size_pt=10):
    p = doc.add_paragraph(style="List Paragraph")
    run = p.add_run(f"• {text}")
    run.font.size = Pt(size_pt)
    p.paragraph_format.space_after = Pt(2)
    return p

def _apply_table_borders(tbl):
    """Apply thin borders to every cell via raw XML (works on any document)."""
    for row in tbl.rows:
        for cell in row.cells:
            tc   = cell._tc
            tcPr = tc.get_or_add_tcPr()
            tcBorders = OxmlElement("w:tcBorders")
            for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
                el = OxmlElement(f"w:{side}")
                el.set(qn("w:val"),  "single")
                el.set(qn("w:sz"),   "4")
                el.set(qn("w:space"),"0")
                el.set(qn("w:color"),"b0c4d8")
                tcBorders.append(el)
            tcPr.append(tcBorders)

def add_table(doc, headers, rows, col_widths_cm=None):
    tbl = doc.add_table(rows=1 + len(rows), cols=len(headers))
    tbl.style = "Normal Table"
    # Header row
    hrow = tbl.rows[0]
    for ci, h in enumerate(headers):
        cell = hrow.cells[ci]
        cell.text = h
        r = cell.paragraphs[0].runs[0]
        r.bold = True
        r.font.size = Pt(9)
        r.font.color.rgb = WHITE
        _set_cell_bg(cell, "1e3a5f")
        cell.paragraphs[0].paragraph_format.space_before = Pt(2)
        cell.paragraphs[0].paragraph_format.space_after  = Pt(2)
    # Data rows
    for ri, row_data in enumerate(rows):
        row = tbl.rows[ri + 1]
        for ci, val in enumerate(row_data):
            cell = row.cells[ci]
            cell.text = val
            r = cell.paragraphs[0].runs[0]
            r.font.size = Pt(9)
            if ri % 2 == 1:
                _set_cell_bg(cell, "e8f4fd")
            cell.paragraphs[0].paragraph_format.space_before = Pt(2)
            cell.paragraphs[0].paragraph_format.space_after  = Pt(2)
    _apply_table_borders(tbl)
    if col_widths_cm:
        for ci, w in enumerate(col_widths_cm):
            for row in tbl.rows:
                row.cells[ci].width = Cm(w)
    doc.add_paragraph()

def add_divider(doc):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after  = Pt(2)

# ══════════════════════════════════════════════════════════════════════════════
# OPEN EXISTING DOCUMENT
# ══════════════════════════════════════════════════════════════════════════════
doc = Document(SRC)

# Add a "last updated" line right after the title paragraph
title_para = doc.paragraphs[0]
# Insert update notice after title
p = OxmlElement("w:p")
r = OxmlElement("w:r")
rPr = OxmlElement("w:rPr")
sz = OxmlElement("w:sz"); sz.set(qn("w:val"), "18")
color = OxmlElement("w:color"); color.set(qn("w:val"), "647489")
rPr.append(sz); rPr.append(color)
t = OxmlElement("w:t"); t.text = f"Updated: {TODAY}  |  Version 2.0  |  Includes all platform enhancements"
r.append(rPr); r.append(t); p.append(r)
title_para._p.addnext(p)

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — Update: Data Management Module Overview
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "2. Data Management Module Overview — Updated Features", size_pt=12)
add_body(doc, "The following UI capabilities have been added or enhanced since v1.0:")
add_subheading(doc, "2.1 Asset Graphic User Interface — Enhancements", size_pt=11)
add_body(doc, "The asset hierarchy panel now supports unlimited nesting of Projects and child assets. "
    "A prominent '+ Add New' button creates root projects; child assets are added from within the "
    "selected asset context. The tree is persistent across navigation.")
add_subheading(doc, "2.4 User Profile / Role Switcher", size_pt=11)
add_body(doc, "Users can switch their active role profile at runtime using the top-right profile "
    "switcher. On every switch, setActorHeaders() injects X-Actor-Name, X-Actor-Role, and "
    "X-Actor-Username headers into all subsequent API calls, enabling accurate activity-log attribution.")

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — Data Management Entity: targeted updates
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "3. Data Management Entity — Updated Entity Definitions", size_pt=12)

add_subheading(doc, "3.4 Asset Attribute — New Attribute Types & Fields")
add_body(doc, "Attribute types now include: static, dynamic, metric, and runtime. "
    "Runtime attributes hold a mathematical expression (using the expr-eval library) that is "
    "automatically re-evaluated on every telemetry ingest cycle. All numeric sibling attributes "
    "on the same asset are available as expression variables.")
add_bullet(doc, "expression (TEXT) — safe math expression, e.g. (temp_c * 9/5) + 32")
add_bullet(doc, "sourceMetric (TEXT) — maps the attribute to a telemetry metric key")
add_bullet(doc, "uom (TEXT) — unit of measurement shown in charts and tooltips")
add_bullet(doc, "decimalPlaces (INTEGER) — display precision")
add_bullet(doc, "thousandSeparator (BOOLEAN) — comma-format large numbers")
add_bullet(doc, "quality (TEXT) — data quality indicator (good / bad / uncertain)")

add_subheading(doc, "3.7 Asset Template Entity — Expression Support")
add_body(doc, "Templates now carry an expression field on each template attribute. When "
    "POST /api/assets/:id/apply-template is called, the expression is stamped onto the "
    "created attribute as-is, enabling reusable computed-value blueprints across asset types.")

add_subheading(doc, "3.16 Broker Entity — MQTT Enhancements")
add_body(doc, "MQTT broker records now store the following additional fields:")
add_bullet(doc, "mqttUsername / mqttPassword — credentials for broker authentication")
add_bullet(doc, "mqttTopic — subscription topic pattern (supports wildcards)")
add_bullet(doc, "mqttClientId — unique MQTT client identifier")
add_bullet(doc, "mappingRules (JSONB) — array of field-rename rules applied to the incoming "
    "payload data object before normalisation, allowing flexible device payload formats")
add_body(doc, "A connection history timeline is shown on each broker card (expandable), sourced "
    "from the broker_events table (connected / disconnected / error, newest-first, up to 500 rows).")

add_subheading(doc, "3.17 Azure IoT Hub / 3.20 Broker REST API / 3.22 MQTT — Ingest Pipeline")
add_body(doc, "All broker types feed into the same two-step ingest pipeline:")
add_bullet(doc, "Step 1 — normalise(body): converts raw payload to NormalisedPayload "
    "{ deviceId, timestamp, metrics }")
add_bullet(doc, "Step 2 — processNormalised(n): writes telemetry, updates dynamic attributes, "
    "evaluates runtime expressions, evaluates alarm rules, fires webhooks")
add_body(doc, "The MQTT subscriber service starts non-blocking at server boot, reads all MQTT "
    "broker configs, subscribes to each topic, applies mappingRules, and broadcasts "
    "broker_status WebSocket events on state changes.")

add_subheading(doc, "3.27 Event Forwarding / Destinations Entity — Enhancements")
add_body(doc, "Destination (webhook forward) records now include:")
add_bullet(doc, "auth — authentication config (none / bearer token / basic auth)")
add_bullet(doc, "enabled (BOOLEAN) — global toggle without deleting the record")
add_bullet(doc, "eventTypes (ARRAY) — filter: only forward specific event categories")

add_subheading(doc, "3.33 API Client Entity — New Tracking Fields")
add_body(doc, "API client records now carry usage-tracking and security fields:")
add_bullet(doc, "secretRotatedAt (TIMESTAMP) — when the client secret was last rotated")
add_bullet(doc, "totalRequests (INTEGER) — cumulative authenticated request counter")
add_bullet(doc, "lastUsedAt (TIMESTAMP) — most recent successful authenticated call")
add_bullet(doc, "allowedIps (TEXT[]) — optional IP allowlist for request origin validation")
add_bullet(doc, "expiresAt (TIMESTAMP) — credential expiry date")

add_subheading(doc, "3.35 Activity Log Entity — Full Field Set")
add_body(doc, "The activity_logs table records every significant platform action:")
add_table(doc,
    ["Field", "Type", "Description"],
    [
        ["action",       "TEXT",      "Action performed, e.g. CREATE, DELETE, ACKNOWLEDGE"],
        ["category",     "TEXT",      "Module: asset / alarm / broker / user / security"],
        ["actorName",    "TEXT",      "Display name of the user performing the action"],
        ["actorRole",    "TEXT",      "Active role at time of action"],
        ["actorUsername","TEXT",      "Login username of the actor"],
        ["targetId",     "TEXT",      "UUID of the affected entity"],
        ["targetName",   "TEXT",      "Human-readable name of the affected entity"],
        ["detail",       "TEXT",      "Additional context (e.g. changed fields)"],
        ["timestamp",    "TIMESTAMP", "UTC time of the action"],
    ],
    col_widths_cm=[3.5, 3, 10]
)

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — Alarm Management: targeted updates
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "4. Alarm Management — Updated Features", size_pt=12)

add_subheading(doc, "4.3 Alarm Rule — New Rule Types & Webhook Fields")
add_body(doc, "The alarm_rules table now supports four rule evaluation types:")
add_bullet(doc, "threshold — trigger when value exceeds or falls below a set limit")
add_bullet(doc, "deviation — trigger when value deviates from a baseline by a percentage")
add_bullet(doc, "rate_of_change — trigger when |Δvalue/Δtime| exceeds a limit (units/second). "
    "Configurable evaluation window via rocWindow (INTEGER, default 60 seconds)")
add_bullet(doc, "heartbeat — trigger when no telemetry is received within a timeout window")
add_body(doc, "Webhook fields added per rule:")
add_bullet(doc, "webhookUrl (TEXT) — HTTP endpoint to POST when alarm triggers or clears")
add_bullet(doc, "webhookEnabled (BOOLEAN, default false) — enable/disable per rule")
add_body(doc, "Webhook delivery is non-blocking: a background fetch() POST with a 5-second "
    "AbortSignal timeout fires without delaying the ingest response. A 'Test Webhook' "
    "button (POST /api/alarm-rules/:id/test-webhook) is available in the UI.")

add_subheading(doc, "4.4 Alarm Notifications — Maintenance Mode Suppression")
add_body(doc, "Assets with maintenanceMode = true have alarm rule evaluation suppressed. "
    "Toggle via POST /api/assets/:id/maintenance with body { enabled, note }. "
    "maintenanceSince and maintenanceNote are recorded and shown in the asset detail panel.")

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 5 — Security: targeted updates
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "5. Security — Role-Based Access Control (RBAC)", size_pt=12)

add_subheading(doc, "5.1 Role-based Security — Permission Matrix")
add_body(doc, "Four built-in roles are enforced at both UI and API level:")
add_table(doc,
    ["Role", "View Data", "Assets & Templates", "Ack Alarms", "Brokers & Dest.", "Users & API Clients", "All Admin Actions"],
    [
        ["admin",    "Yes", "Yes", "Yes", "Yes", "Yes", "Yes"],
        ["engineer", "Yes", "Yes", "Yes", "Yes", "No",  "No"],
        ["operator", "Yes", "No",  "Yes", "No",  "No",  "No"],
        ["viewer",   "Yes", "No",  "No",  "No",  "No",  "No"],
    ],
    col_widths_cm=[2.5, 2.2, 3.2, 2.5, 3.0, 3.2, 3.2]
)

add_subheading(doc, "5.2 UI Enforcement — RoleGuard & ReadOnlyBanner")
add_body(doc, "RoleGuard component wraps any UI element. mode='hide' removes it from the DOM; "
    "mode='disable' renders it grayed-out and non-interactive. A ReadOnlyBanner (amber) is "
    "shown at the top of any page where the active role has no write permissions.")

add_subheading(doc, "5.3 API Client Credentials (OAuth-style)")
add_body(doc, "Machine-to-machine integrations authenticate via client credentials (client_id + "
    "client_secret) with configurable scopes, IP allowlists, and expiry dates. The "
    "/api/api-clients page shows real-time usage stats: totalRequests, lastUsedAt, secretRotatedAt.")

# ══════════════════════════════════════════════════════════════════════════════
# NEW SECTION 6 — Visualization Dashboard
# ══════════════════════════════════════════════════════════════════════════════
doc.add_page_break()
add_heading(doc, "6. Visualization Dashboard  ( /visualization )", size_pt=13)
add_body(doc, "A fully-featured industrial dark-theme dashboard builder persisted in the "
    "viz_dashboards PostgreSQL table. Key capabilities:")

add_subheading(doc, "6.1 Named Dashboards & Access Control")
add_body(doc, "Multiple named dashboards can be created, edited, cloned, and deleted. Each "
    "dashboard has a roleFilter (controls which roles can see it) and an assetFilter. "
    "A dropdown selector in the toolbar switches the active dashboard.")

add_subheading(doc, "6.2 Widget Types")
add_body(doc, "11 widget types are available:")
add_table(doc,
    ["Widget Type", "Description"],
    [
        ["line",      "Time-series line chart with multi-metric overlay"],
        ["area",      "Filled area chart with gradient fill per series"],
        ["bar",       "Grouped bar chart"],
        ["stackbar",  "Stacked bar chart"],
        ["gauge",     "Radial gauge with min/max range"],
        ["stat",      "Single large KPI card with trend indicator"],
        ["table",     "Tabular telemetry data with pagination"],
        ["heatmap",   "Hour × day heatmap of aggregated metric values"],
        ["scatter",   "X-Y scatter plot for correlation analysis"],
        ["pie",       "Pie / donut chart for proportional breakdown"],
        ["image",     "Embedded image (URL) with optional overlay modes"],
    ],
    col_widths_cm=[3.5, 13]
)

add_subheading(doc, "6.3 Multi-Metric Overlay")
add_body(doc, "Up to 4 additional series can be overlaid on any line/area/bar chart widget. "
    "Each overlay series is independently configured with:")
add_bullet(doc, "Asset source — any asset in the hierarchy")
add_bullet(doc, "Metric key — from live telemetry or named attributes")
add_bullet(doc, "Colour — selected from a neon palette")
add_bullet(doc, "Label — short user-defined display name shown in the legend")
add_bullet(doc, "UoM — unit of measurement string (informational)")

add_subheading(doc, "6.4 Primary Series Label & Unit of Measurement")
add_body(doc, "The primary metric of every widget also has dedicated Label and UoM input fields "
    "in the widget configuration dialog. The label overrides the raw metric key in the "
    "chart legend, tooltip, and any export.")

add_subheading(doc, "6.5 SPC Reference Lines (UCL / LCL / CL)")
add_body(doc, "Statistical Process Control reference lines can be added to any chart widget:")
add_table(doc,
    ["Field", "Description", "Default Style"],
    [
        ["UCL (Upper Control Limit)", "Numeric threshold — upper bound line",    "Dashed, amber"],
        ["LCL (Lower Control Limit)", "Numeric threshold — lower bound line",    "Dashed, amber"],
        ["CL  (Centre Line)",         "Numeric target / mean line",              "Solid, green"],
    ],
    col_widths_cm=[5, 8, 3.5]
)
add_body(doc, "Each line has an independent colour picker and solid/dashed style toggle. "
    "Lines are rendered as direct Recharts ReferenceLine children (not wrapped in React "
    "Fragments) to ensure they always appear in the chart. The Y-axis domain automatically "
    "expands to include all reference line values.")

add_subheading(doc, "6.6 Drag-to-Reorder & Corner Resize")
add_body(doc, "Widgets on the dashboard canvas can be reordered by dragging. A single resize "
    "handle at the bottom-right corner of each widget allows freeform height/width adjustment. "
    "Layout changes are persisted to the viz_dashboards table on Save.")

add_subheading(doc, "6.7 Time Range & Aggregation Controls")
add_body(doc, "A global time range dropdown (11 presets: Last 15 min → Last 30 days) sets the "
    "default range for all widgets. Each widget can override with a custom from/to "
    "date-time picker. Granularity (auto / 5 m / 15 m / 1 h / 1 d) and aggregation type "
    "(avg / min / max / sum) are configurable per widget.")

add_subheading(doc, "6.8 Real-Time WebSocket Updates")
add_body(doc, "The useWsEvents hook subscribes to the /ws WebSocket endpoint. Inbound "
    "telemetry events are routed to a per-asset wsSignals map. Each widget card watching "
    "that asset automatically refetches its data and displays an animated '● LIVE' badge.")

# ══════════════════════════════════════════════════════════════════════════════
# NEW SECTION 7 — Live Telemetry Feed
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "7. Live Telemetry Feed  ( /live )", size_pt=13)
add_body(doc, "A dedicated real-time monitoring page connected to the /ws WebSocket endpoint.")

add_subheading(doc, "7.1 Metric Tiles Panel (Left)")
add_body(doc, "Per-asset metric tiles auto-expand on first data arrival. Each tile:")
add_bullet(doc, "Flashes with a highlight animation on every new value")
add_bullet(doc, "Shows a stale indicator (grey badge) after 30 seconds without data")
add_bullet(doc, "Displays a trend arrow (up / down / flat) based on last two values")

add_subheading(doc, "7.2 Event Log Panel (Right)")
add_body(doc, "A scrollable event log maintains a 200-event rolling buffer. Each row shows "
    "timestamp, asset name, and primary metric value. Rows can be expanded to reveal all "
    "metric key-value pairs from the original payload. A 'Clear' button resets the buffer.")

add_subheading(doc, "7.3 Status Bar")
add_body(doc, "The top bar shows: WebSocket connection status, events/minute rate, number of "
    "live assets, total events received in session, total distinct metrics tracked, and "
    "an asset filter dropdown to focus on a single asset.")

# ══════════════════════════════════════════════════════════════════════════════
# NEW SECTION 8 — Data Management Page
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "8. Data Management  ( /data-management )", size_pt=13)

add_subheading(doc, "8.1 Storage Overview")
add_body(doc, "Displays database storage statistics sourced from "
    "GET /api/system/storage:")
add_bullet(doc, "Total telemetry row count")
add_bullet(doc, "Physical table size on disk")
add_bullet(doc, "Oldest and newest record timestamps")
add_bullet(doc, "Per-asset row count breakdown table")

add_subheading(doc, "8.2 Data Retention Policies")
add_body(doc, "Full CRUD for data retention rules managed via /api/system/retention. "
    "Each policy record:")
add_table(doc,
    ["Field", "Type", "Description"],
    [
        ["name",          "TEXT",      "Descriptive policy name"],
        ["assetId",       "UUID/null", "Target asset (null = all assets)"],
        ["metric",        "TEXT/null", "Target metric key (null = all metrics)"],
        ["retentionDays", "INTEGER",   "Rows older than this many days are deleted"],
        ["enabled",       "BOOLEAN",   "Toggle without deleting the policy"],
        ["lastPrunedAt",  "TIMESTAMP", "When the policy last ran"],
        ["rowsPruned",    "INTEGER",   "Cumulative deleted row count"],
    ],
    col_widths_cm=[3.5, 3, 10]
)

add_subheading(doc, "8.3 Pruning Schedule")
add_body(doc, "An hourly background job (setInterval registered at server startup) calls "
    "runPruning() across all enabled policies automatically. "
    "POST /api/system/retention/run provides a manual trigger from the UI.")

add_subheading(doc, "8.4 Time-Bucketed Aggregation")
add_body(doc, "GET /api/system/aggregate returns avg / min / max values per time bucket "
    "for a given asset and metric. Supported buckets: 5 m, 15 m, 30 m, 1 h, 6 h, 12 h, "
    "1 d, 1 w. Used by the Reports page and the Visualization widget aggregation controls.")

# ══════════════════════════════════════════════════════════════════════════════
# NEW SECTION 9 — Reports
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "9. Reports  ( /reports )", size_pt=13)
add_body(doc, "On-demand report generation with three report types, quick-range buttons, "
    "and download as CSV or JSON:")
add_table(doc,
    ["Report Type", "Description", "Output Fields"],
    [
        ["Telemetry Summary",    "Aggregated min/avg/max per time bucket for a selected asset+metric", "bucket, min, avg, max, count"],
        ["Alarm Report",         "Date-range filtered alarm records for a selected asset",             "timestamp, rule, severity, status, value"],
        ["Asset Status Snapshot","Point-in-time status of all assets",                                 "asset, health, lastSeen, activeAlarms, freshness%"],
    ],
    col_widths_cm=[4, 7.5, 5]
)

# ══════════════════════════════════════════════════════════════════════════════
# NEW SECTION 10 — Asset Health Score
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "10. Asset Health Score  ( GET /api/assets/:id/health )", size_pt=13)
add_body(doc, "Returns a computed health summary for a single asset:")
add_table(doc,
    ["Field", "Type", "Logic"],
    [
        ["health",       "STRING", "'alarm' if activeAlarms > 0; 'stale' if freshnessPct < 50; otherwise 'ok'"],
        ["freshnessPct", "NUMBER", "% of metric attributes with telemetry within the last hour"],
        ["activeAlarms", "NUMBER", "Count of unacknowledged active alarms for this asset"],
        ["lastSeen",     "STRING", "ISO timestamp of the most recent telemetry record"],
        ["keyMetrics",   "ARRAY",  "Latest value + timestamp for each primary metric attribute"],
    ],
    col_widths_cm=[3.5, 2, 11]
)
add_body(doc, "The Dashboard home page displays a health grid (auto-refresh every 30 s) "
    "showing colour-coded cards (green = ok, amber = stale, red = alarm) for every asset.")

# ══════════════════════════════════════════════════════════════════════════════
# NEW SECTION 11 — Ingest Pipeline & Expression Engine
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "11. Ingest Pipeline & Expression Engine", size_pt=13)

add_subheading(doc, "11.1 Ingest Endpoints")
add_table(doc,
    ["Endpoint", "Description"],
    [
        ["POST /api/ingest/payload",  "Single payload ingest — normalise + write + evaluate"],
        ["POST /api/ingest/batch",    "Batch ingest — array of payloads processed sequentially"],
        ["POST /api/ingest/validate", "Dry-run — resolves deviceId, checks asset match, returns preview (no DB write)"],
    ],
    col_widths_cm=[5.5, 11]
)

add_subheading(doc, "11.2 Pipeline Steps")
add_body(doc, "Every payload (HTTP or MQTT) passes through:")
add_bullet(doc, "1. normalise(body) — converts raw payload to NormalisedPayload { deviceId, timestamp, metrics }")
add_bullet(doc, "2. Write telemetry rows to the time-series table")
add_bullet(doc, "3. Update dynamic attribute values and quality timestamps")
add_bullet(doc, "4. Evaluate runtime expression attributes (expr-eval, safe math, no eval())")
add_bullet(doc, "5. Evaluate alarm rules — threshold checks + rate-of-change (|Δvalue/Δtime| vs rocWindow)")
add_bullet(doc, "6. Fire webhook deliveries for triggered / cleared alarms (non-blocking, 5 s timeout)")

add_subheading(doc, "11.3 Expression Engine")
add_body(doc, "Runtime attributes use the expr-eval library for safe mathematical expressions. "
    "All numeric sibling attributes on the same asset are automatically injected as variables. "
    "Expressions are evaluated on every processNormalised call.")
add_bullet(doc, "Example: (pressure_bar * 14.696) — bar to PSI conversion")
add_bullet(doc, "Example: (temp_c * 9/5) + 32 — Celsius to Fahrenheit")
add_bullet(doc, "Example: (kWh_total - kWh_baseline) / hours — derived efficiency metric")

# ══════════════════════════════════════════════════════════════════════════════
# NEW SECTION 12 — Payload Simulator
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "12. Payload Simulator  ( /payload-simulator )", size_pt=13)
add_body(doc, "An in-app tool for testing the ingest pipeline without physical hardware.")

add_subheading(doc, "12.1 Device Presets Tab")
add_body(doc, "Pre-configured one-click payloads for sample devices (Sensorgrow, RF-Dryer) "
    "with realistic metric values.")

add_subheading(doc, "12.2 Custom Asset Tab")
add_body(doc, "Select any asset from the dropdown. The simulator:")
add_bullet(doc, "Calls GET /api/assets/:id/attributes to discover all dynamic and measurement attributes")
add_bullet(doc, "Populates metric rows with configurable min/max ranges per attribute")
add_bullet(doc, "Provides value sliders with randomised jitter for realistic variation")
add_bullet(doc, "Supports single-send or continuous auto-send mode")
add_bullet(doc, "Shows a live trend chart and a scrollable request log inline")
add_body(doc, "Payloads are sent as: { deviceId: asset.identifier, timestamp: <ISO>, metrics: { ... } }")

# ══════════════════════════════════════════════════════════════════════════════
# NEW SECTION 13 — WebSocket Events
# ══════════════════════════════════════════════════════════════════════════════
add_heading(doc, "13. WebSocket Events  ( /ws )", size_pt=13)
add_table(doc,
    ["Event Type", "Trigger", "Payload Fields"],
    [
        ["telemetry",     "After every successful processNormalised call", "assetId, metric, value, timestamp"],
        ["broker_status", "MQTT subscriber on connect / disconnect / error", "brokerId, brokerName, status, message"],
    ],
    col_widths_cm=[3.5, 7, 6]
)
add_body(doc, "The frontend useWsEvents hook maintains a per-asset wsSignals map. Each "
    "widget and the Live Feed page subscribe to asset signals and auto-refetch/update "
    "when new data arrives.")

# ══════════════════════════════════════════════════════════════════════════════
# APPENDIX — API Quick Reference
# ══════════════════════════════════════════════════════════════════════════════
doc.add_page_break()
add_heading(doc, "Appendix A — Full API Endpoint Reference", size_pt=13)
add_table(doc,
    ["Method", "Endpoint", "Description"],
    [
        ["GET",    "/api/assets",                            "List all assets"],
        ["POST",   "/api/assets",                            "Create asset"],
        ["GET",    "/api/assets/:id",                        "Get single asset"],
        ["PUT",    "/api/assets/:id",                        "Update asset"],
        ["DELETE", "/api/assets/:id",                        "Delete asset"],
        ["POST",   "/api/assets/:id/maintenance",            "Toggle maintenance mode"],
        ["GET",    "/api/assets/:id/health",                 "Asset health score"],
        ["GET",    "/api/assets/:id/attributes",             "List attributes"],
        ["POST",   "/api/assets/:id/attributes",             "Add attribute"],
        ["POST",   "/api/assets/:id/attributes/bulk",        "Bulk import attributes"],
        ["POST",   "/api/assets/:id/apply-template",         "Apply template"],
        ["GET",    "/api/attributes/:id",                    "Get attribute"],
        ["PUT",    "/api/attributes/:id",                    "Update attribute"],
        ["DELETE", "/api/attributes/:id",                    "Delete attribute"],
        ["GET",    "/api/telemetry/:assetId",                "Query telemetry"],
        ["GET",    "/api/telemetry/:assetId/metrics",        "List metric keys"],
        ["GET",    "/api/telemetry/:assetId/export",         "Export telemetry CSV"],
        ["POST",   "/api/ingest/payload",                    "Single payload ingest"],
        ["POST",   "/api/ingest/validate",                   "Dry-run validate"],
        ["POST",   "/api/ingest/batch",                      "Batch ingest"],
        ["GET",    "/api/alarms",                            "List active alarms"],
        ["POST",   "/api/alarms/:id/acknowledge",            "Acknowledge alarm"],
        ["GET",    "/api/alarm-history",                     "Alarm history"],
        ["GET",    "/api/alarm-rules",                       "List alarm rules"],
        ["POST",   "/api/alarm-rules",                       "Create alarm rule"],
        ["PUT",    "/api/alarm-rules/:id",                   "Update alarm rule"],
        ["DELETE", "/api/alarm-rules/:id",                   "Delete alarm rule"],
        ["POST",   "/api/alarm-rules/:id/test-webhook",      "Test webhook"],
        ["GET",    "/api/asset-templates",                   "List templates"],
        ["POST",   "/api/asset-templates",                   "Create template"],
        ["GET",    "/api/brokers",                           "List brokers"],
        ["POST",   "/api/brokers",                           "Create broker"],
        ["GET",    "/api/brokers/:id/history",               "Broker event history"],
        ["GET",    "/api/api-clients",                       "List API clients"],
        ["POST",   "/api/api-clients",                       "Create API client"],
        ["GET",    "/api/users",                             "List users"],
        ["POST",   "/api/users",                             "Create user"],
        ["GET",    "/api/viz-dashboards",                    "List dashboards"],
        ["POST",   "/api/viz-dashboards",                    "Create dashboard"],
        ["PUT",    "/api/viz-dashboards/:id",                "Update dashboard"],
        ["DELETE", "/api/viz-dashboards/:id",                "Delete dashboard"],
        ["GET",    "/api/dashboard/summary",                 "Dashboard stat cards"],
        ["GET",    "/api/dashboard/recent-telemetry",        "Recent telemetry records"],
        ["GET",    "/api/dashboard/alarm-stats",             "Alarm counts by severity"],
        ["GET",    "/api/activity-log",                      "Paginated audit trail"],
        ["GET",    "/api/system/storage",                    "Storage statistics"],
        ["GET",    "/api/system/aggregate",                  "Time-bucketed aggregation"],
        ["GET",    "/api/system/retention",                  "List retention policies"],
        ["POST",   "/api/system/retention",                  "Create retention policy"],
        ["PUT",    "/api/system/retention/:id",              "Update retention policy"],
        ["DELETE", "/api/system/retention/:id",              "Delete retention policy"],
        ["POST",   "/api/system/retention/run",              "Manual pruning trigger"],
    ],
    col_widths_cm=[2, 7, 7.5]
)

# ── Save DOCX ─────────────────────────────────────────────────────────────────
doc.save(DOCX_OUT)
print(f"  DOCX saved → {DOCX_OUT}")

# ══════════════════════════════════════════════════════════════════════════════
# PDF GENERATION (mirrors the Word update)
# ══════════════════════════════════════════════════════════════════════════════
RL_NAVY  = colors.HexColor("#1e3a5f")
RL_CYAN  = colors.HexColor("#06b6d4")
RL_LIGHT = colors.HexColor("#f0f9ff")
RL_STRIPE= colors.HexColor("#e8f4fd")
RL_MUTED = colors.HexColor("#94a3b8")
RL_WHITE = colors.white

pdf_doc = SimpleDocTemplate(
    PDF_OUT, pagesize=A4,
    leftMargin=2.2*cm, rightMargin=2.2*cm,
    topMargin=2.2*cm, bottomMargin=2.2*cm,
)

ss = getSampleStyleSheet()

S_TITLE  = ParagraphStyle("T",  fontName="Helvetica-Bold", fontSize=24,
    textColor=RL_NAVY, alignment=TA_CENTER, spaceAfter=6)
S_SUB    = ParagraphStyle("S",  fontName="Helvetica", fontSize=12,
    textColor=RL_MUTED, alignment=TA_CENTER, spaceAfter=4)
S_META   = ParagraphStyle("M",  fontName="Helvetica", fontSize=9,
    textColor=RL_MUTED, alignment=TA_CENTER, spaceAfter=30)
S_H1     = ParagraphStyle("H1", fontName="Helvetica-Bold", fontSize=13,
    textColor=RL_NAVY, spaceBefore=18, spaceAfter=5, leading=18)
S_H2     = ParagraphStyle("H2", fontName="Helvetica-Bold", fontSize=10.5,
    textColor=RL_NAVY, spaceBefore=10, spaceAfter=3)
S_BODY   = ParagraphStyle("B",  fontName="Helvetica", fontSize=9.5,
    textColor=colors.HexColor("#1e293b"), leading=14, spaceAfter=6,
    leftIndent=8, alignment=TA_JUSTIFY)
S_BULLET = ParagraphStyle("BU", fontName="Helvetica", fontSize=9.5,
    textColor=colors.HexColor("#1e293b"), leading=14, spaceAfter=3,
    leftIndent=20, bulletIndent=8, bulletFontName="Helvetica")

def rl_table(headers, rows, col_widths):
    tdata = []
    for ri, row in enumerate([headers] + rows):
        trow = []
        for cell in row:
            st = ParagraphStyle("tc",
                fontName="Helvetica-Bold" if ri == 0 else "Helvetica",
                fontSize=8,
                textColor=RL_WHITE if ri == 0 else colors.HexColor("#1e293b"),
                leading=11)
            trow.append(Paragraph(cell, st))
        tdata.append(trow)
    ts = TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), RL_NAVY),
        ("GRID",          (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), [RL_WHITE, RL_STRIPE]),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING",   (0, 0), (-1, -1), 5),
    ])
    t = Table(tdata, colWidths=[w*cm for w in col_widths], repeatRows=1)
    t.setStyle(ts)
    return t

def rl_div():
    return HRFlowable(width="100%", thickness=0.4, color=RL_CYAN, spaceAfter=3)

story = []

# Cover
story += [
    Spacer(1, 2.5*cm),
    Paragraph("Platform Documentation", S_TITLE),
    Paragraph("WS-Integrated Suite — Industrial IoT Platform", S_SUB),
    Paragraph(f"Version 2.0  (Updated from v1.0)  |  {TODAY}", S_META),
    HRFlowable(width="100%", thickness=2, color=RL_CYAN),
    PageBreak(),
]

def sec(title):
    story.append(Paragraph(title, S_H1))
    story.append(rl_div())

def subsec(title):
    story.append(Paragraph(title, S_H2))

def body(text):
    for part in text.split("\n\n"):
        story.append(Paragraph(part.replace("\n", " "), S_BODY))

def bullet(text):
    story.append(Paragraph(f"• {text}", S_BULLET))

def tbl(headers, rows, widths):
    story.append(rl_table(headers, rows, widths))
    story.append(Spacer(1, 0.2*cm))

# ── Original sections (brief summary + context for where new content goes) ───
sec("1. Introduction")
body("WS-Integrated Suite is a full-stack Industrial IoT data-acquisition and analytics platform. "
    "It connects field devices and sensors to a centralised PostgreSQL data store, delivers "
    "real-time telemetry over WebSocket, evaluates alarm rules, and exposes rich visualisation "
    "and reporting tools. Built on React 18 + Vite (frontend) and Express 5 + Drizzle ORM (API).")

sec("2. Data Management Module Overview — Updated Features")
subsec("2.1 Asset Graphic User Interface — Enhancements")
body("The asset hierarchy panel now supports unlimited nesting. A prominent '+ Add New' button "
    "creates root projects; child assets are added contextually. The tree is persistent across navigation.")
subsec("2.4 User Profile / Role Switcher")
body("Active role can be switched at runtime. setActorHeaders() injects X-Actor-Name, "
    "X-Actor-Role, and X-Actor-Username headers into all subsequent API calls for "
    "accurate activity-log attribution.")

sec("3. Data Management Entity — Updated Entity Definitions")
subsec("3.4 Asset Attribute — New Attribute Types & Fields")
body("Attribute types now include: static, dynamic, metric, and runtime. Runtime attributes hold "
    "a mathematical expression (expr-eval) that is re-evaluated on every telemetry ingest cycle.")
for t_item in ["expression (TEXT) — math expression e.g. (temp_c * 9/5) + 32",
               "sourceMetric (TEXT) — maps attribute to a telemetry metric key",
               "uom (TEXT) — unit of measurement shown in charts",
               "decimalPlaces (INTEGER) — display precision",
               "quality (TEXT) — data quality: good / bad / uncertain"]:
    bullet(t_item)

subsec("3.7 Asset Template Entity — Expression Support")
body("Templates carry an expression field per attribute. On apply-template, the expression "
    "is stamped onto the created attribute enabling reusable computed-value blueprints.")

subsec("3.16 Broker Entity — MQTT Enhancements")
body("MQTT broker records now include: mqttUsername, mqttPassword, mqttTopic, mqttClientId, "
    "and mappingRules (JSONB array of field-rename rules applied before normalisation). "
    "A connection history timeline (broker_events) is shown on each broker card.")

subsec("3.22 MQTT / 3.20 REST API / 3.17 Azure IoT — Ingest Pipeline")
body("All broker types feed into the same two-step pipeline: normalise(body) → "
    "processNormalised(n). Steps: write telemetry, update dynamic attributes, evaluate "
    "runtime expressions, evaluate alarm rules, fire webhooks.")

subsec("3.27 Event Forwarding — Enhancements")
body("Destinations now include: auth config (none/bearer/basic), enabled toggle (without deleting), "
    "and eventTypes filter array.")

subsec("3.33 API Client Entity — New Tracking Fields")
for f in ["secretRotatedAt — when secret was last rotated",
          "totalRequests — cumulative authenticated request counter",
          "lastUsedAt — most recent successful authenticated call",
          "allowedIps — optional IP allowlist",
          "expiresAt — credential expiry date"]:
    bullet(f)

subsec("3.35 Activity Log Entity — Full Field Set")
tbl(["Field", "Type", "Description"],
    [["action","TEXT","Action: CREATE, DELETE, ACKNOWLEDGE, …"],
     ["category","TEXT","Module: asset / alarm / broker / user / security"],
     ["actorName","TEXT","Display name of the acting user"],
     ["actorRole","TEXT","Active role at time of action"],
     ["actorUsername","TEXT","Login username"],
     ["targetId","TEXT","UUID of affected entity"],
     ["targetName","TEXT","Human-readable entity name"],
     ["detail","TEXT","Additional context (changed fields, etc.)"],
     ["timestamp","TIMESTAMP","UTC time of action"]],
    [3.5, 3, 10])

sec("4. Alarm Management — Updated Features")
subsec("4.3 Alarm Rule — New Rule Types & Webhook Fields")
body("Four rule evaluation types: threshold, deviation, rate_of_change, heartbeat.")
for f in ["rate_of_change — |Δvalue/Δtime| vs limit; rocWindow (INTEGER, default 60 s)",
          "webhookUrl (TEXT) — HTTP endpoint called on trigger/clear",
          "webhookEnabled (BOOLEAN) — per-rule toggle",
          "Test Webhook button — POST /api/alarm-rules/:id/test-webhook"]:
    bullet(f)

subsec("4.4 Alarm Notifications — Maintenance Mode Suppression")
body("Assets with maintenanceMode=true have alarm evaluation suppressed. Toggle via "
    "POST /api/assets/:id/maintenance. maintenanceSince and maintenanceNote are recorded.")

sec("5. Security — Role-Based Access Control")
subsec("5.1 Permission Matrix")
tbl(["Role","View","Assets+Templates","Ack Alarms","Brokers","Users/Clients","Admin"],
    [["admin","Yes","Yes","Yes","Yes","Yes","Yes"],
     ["engineer","Yes","Yes","Yes","Yes","No","No"],
     ["operator","Yes","No","Yes","No","No","No"],
     ["viewer","Yes","No","No","No","No","No"]],
    [2.5, 2, 3.2, 2.5, 2.5, 2.8, 2])

subsec("5.2 UI Enforcement")
body("RoleGuard component: mode='hide' removes element from DOM, mode='disable' grays it out. "
    "ReadOnlyBanner (amber) shown on pages where active role has no write permissions.")

story.append(PageBreak())
sec("6. Visualization Dashboard  ( /visualization )")
body("Industrial dark-theme dashboard builder. All dashboards persisted in viz_dashboards table.")

subsec("6.1 Named Dashboards & Access Control")
body("Create, edit, clone, delete multiple named dashboards. Each has a roleFilter and assetFilter. "
    "Dashboard selector dropdown in toolbar. Dashboards are auto-loaded on page open.")

subsec("6.2 Widget Types (11 types)")
tbl(["Widget Type","Description"],
    [["line","Time-series line chart with multi-metric overlay"],
     ["area","Filled area chart with gradient fill per series"],
     ["bar","Grouped bar chart"],
     ["stackbar","Stacked bar chart"],
     ["gauge","Radial gauge with min/max range"],
     ["stat","Single large KPI card with trend indicator"],
     ["table","Tabular telemetry data"],
     ["heatmap","Hour × day heatmap of aggregated values"],
     ["scatter","X-Y scatter for correlation analysis"],
     ["pie","Pie/donut for proportional breakdown"],
     ["image","Embedded image with overlay modes"]],
    [3.5, 13])

subsec("6.3 Multi-Metric Overlay")
body("Up to 4 additional series per chart widget, each with: asset source, metric key, colour, "
    "user-defined label, and unit of measurement.")

subsec("6.4 Primary Series Label & Unit of Measurement")
body("Every widget primary series has Label and UoM input fields. The label overrides the raw "
    "metric key in the chart legend, tooltip, and exports.")

subsec("6.5 SPC Reference Lines (UCL / LCL / CL)")
tbl(["Line","Description","Default Style"],
    [["UCL (Upper Control Limit)","Upper bound reference line","Dashed, amber"],
     ["LCL (Lower Control Limit)","Lower bound reference line","Dashed, amber"],
     ["CL (Centre Line)","Target / mean reference line","Solid, green"]],
    [5, 8, 3.5])
body("Each line has an independent colour picker and solid/dashed toggle. Lines are rendered "
    "as direct Recharts children (not Fragments) so they always appear in the chart. "
    "Y-axis domain auto-expands to include all reference line values.")

subsec("6.6 Drag-to-Reorder & Corner Resize")
body("Widgets can be dragged into any order. A single bottom-right resize handle allows "
    "freeform sizing. Layout persisted to viz_dashboards on Save.")

subsec("6.7 Time Range & Aggregation Controls")
body("Global time range: 11 presets (Last 15 min → Last 30 days) plus per-widget custom "
    "from/to override. Granularity (auto/5 m/15 m/1 h/1 d) and aggregation "
    "(avg/min/max/sum) configurable per widget.")

subsec("6.8 Real-Time WebSocket Updates")
body("useWsEvents hook wires telemetry events to per-asset wsSignals map. Widget cards "
    "auto-refetch on signal change and show an animated '● LIVE' badge.")

sec("7. Live Telemetry Feed  ( /live )")
subsec("7.1 Metric Tiles Panel (Left)")
body("Per-asset metric tiles auto-expand on first data. Flash animation on update. "
    "Stale badge after 30 s without data. Trend arrows (up/down/flat) per metric.")
subsec("7.2 Event Log Panel (Right)")
body("200-event rolling buffer. Rows expand to show all metric key-value pairs. Clear button resets buffer.")
subsec("7.3 Status Bar")
body("WebSocket status, events/min, live assets, total events, metrics tracked, and asset filter dropdown.")

sec("8. Data Management  ( /data-management )")
subsec("8.1 Storage Overview")
body("Total rows, table size on disk, oldest/newest timestamps, per-asset row breakdown. Source: GET /api/system/storage.")
subsec("8.2 Data Retention Policies — Key Fields")
tbl(["Field","Type","Description"],
    [["name","TEXT","Policy name"],
     ["assetId","UUID/null","Target asset (null=all)"],
     ["metric","TEXT/null","Target metric (null=all)"],
     ["retentionDays","INTEGER","Rows older than N days are deleted"],
     ["enabled","BOOLEAN","Toggle without deleting"],
     ["rowsPruned","INTEGER","Cumulative deleted rows"]],
    [3.5, 3, 10])
subsec("8.3 Pruning")
body("Hourly background job auto-runs. POST /api/system/retention/run for manual trigger.")

sec("9. Reports  ( /reports )")
tbl(["Report Type","Description","Output Fields"],
    [["Telemetry Summary","Aggregated min/avg/max per bucket","bucket, min, avg, max, count"],
     ["Alarm Report","Date-range filtered alarm records","timestamp, rule, severity, status"],
     ["Asset Status Snapshot","Point-in-time status of all assets","asset, health, lastSeen, alarms"]],
    [4, 7.5, 5])

sec("10. Asset Health Score  ( GET /api/assets/:id/health )")
tbl(["Field","Logic"],
    [["health","'alarm' if alarms>0; 'stale' if freshnessPct<50; else 'ok'"],
     ["freshnessPct","% of metric attributes with telemetry in last hour"],
     ["activeAlarms","Count of unacknowledged active alarms"],
     ["lastSeen","ISO timestamp of most recent telemetry"],
     ["keyMetrics","Latest value+timestamp for each primary metric attribute"]],
    [4, 12.5])

sec("11. Ingest Pipeline & Expression Engine")
subsec("11.1 Endpoints")
tbl(["Endpoint","Description"],
    [["POST /api/ingest/payload","Single payload — normalise + write + evaluate"],
     ["POST /api/ingest/batch","Array of payloads processed sequentially"],
     ["POST /api/ingest/validate","Dry-run — preview without DB write"]],
    [5.5, 11])
subsec("11.2 Pipeline Steps")
for step in [
    "1. normalise(body) → NormalisedPayload { deviceId, timestamp, metrics }",
    "2. Write telemetry rows (time-series table)",
    "3. Update dynamic attribute values and quality timestamps",
    "4. Evaluate runtime expression attributes (expr-eval, no eval())",
    "5. Evaluate alarm rules (threshold + |Δvalue/Δtime| for rate-of-change)",
    "6. Fire webhook deliveries (non-blocking fetch, 5 s AbortSignal timeout)"]:
    bullet(step)
subsec("11.3 Expression Examples")
for ex in ["(pressure_bar * 14.696)  — bar to PSI",
           "(temp_c * 9/5) + 32  — Celsius to Fahrenheit",
           "(kWh_total - kWh_baseline) / hours  — efficiency metric"]:
    bullet(ex)

sec("12. Payload Simulator  ( /payload-simulator )")
subsec("12.1 Device Presets Tab")
body("Pre-configured one-click payloads for sample devices (Sensorgrow, RF-Dryer).")
subsec("12.2 Custom Asset Tab")
body("Select any asset. Auto-discovers attributes. Value sliders with jitter. "
    "Single-send or continuous auto-send. Live trend chart + request log.")

sec("13. WebSocket Events  ( /ws )")
tbl(["Event","Trigger","Payload"],
    [["telemetry","After every processNormalised call","assetId, metric, value, timestamp"],
     ["broker_status","MQTT on connect/disconnect/error","brokerId, brokerName, status, message"]],
    [3.5, 7, 6])

story.append(PageBreak())
sec("Appendix A — Full API Endpoint Reference")
tbl(["Method","Endpoint","Description"],
    [
        ["GET",    "/api/assets",                           "List all assets"],
        ["POST",   "/api/assets",                           "Create asset"],
        ["GET",    "/api/assets/:id",                       "Get asset"],
        ["PUT",    "/api/assets/:id",                       "Update asset"],
        ["DELETE", "/api/assets/:id",                       "Delete asset"],
        ["POST",   "/api/assets/:id/maintenance",           "Toggle maintenance mode"],
        ["GET",    "/api/assets/:id/health",                "Asset health score"],
        ["GET",    "/api/assets/:id/attributes",            "List attributes"],
        ["POST",   "/api/assets/:id/attributes",            "Add attribute"],
        ["POST",   "/api/assets/:id/attributes/bulk",       "Bulk import (CSV/JSON)"],
        ["POST",   "/api/assets/:id/apply-template",        "Apply template"],
        ["GET",    "/api/telemetry/:assetId",               "Query telemetry"],
        ["GET",    "/api/telemetry/:assetId/metrics",       "List metric keys"],
        ["GET",    "/api/telemetry/:assetId/export",        "Export CSV"],
        ["POST",   "/api/ingest/payload",                   "Single payload ingest"],
        ["POST",   "/api/ingest/validate",                  "Dry-run validate"],
        ["POST",   "/api/ingest/batch",                     "Batch ingest"],
        ["GET",    "/api/alarms",                           "List active alarms"],
        ["POST",   "/api/alarms/:id/acknowledge",           "Acknowledge alarm"],
        ["GET",    "/api/alarm-history",                    "Alarm history"],
        ["GET",    "/api/alarm-rules",                      "List alarm rules"],
        ["POST",   "/api/alarm-rules",                      "Create alarm rule"],
        ["PUT",    "/api/alarm-rules/:id",                  "Update alarm rule"],
        ["DELETE", "/api/alarm-rules/:id",                  "Delete alarm rule"],
        ["POST",   "/api/alarm-rules/:id/test-webhook",     "Test webhook"],
        ["GET",    "/api/asset-templates",                  "List templates"],
        ["POST",   "/api/asset-templates",                  "Create template"],
        ["GET",    "/api/brokers",                          "List brokers"],
        ["POST",   "/api/brokers",                          "Create broker"],
        ["GET",    "/api/brokers/:id/history",              "Broker event history"],
        ["GET",    "/api/api-clients",                      "List API clients"],
        ["POST",   "/api/api-clients",                      "Create API client"],
        ["GET",    "/api/users",                            "List users"],
        ["POST",   "/api/users",                            "Create user"],
        ["GET",    "/api/viz-dashboards",                   "List dashboards"],
        ["POST",   "/api/viz-dashboards",                   "Create dashboard"],
        ["PUT",    "/api/viz-dashboards/:id",               "Update dashboard"],
        ["DELETE", "/api/viz-dashboards/:id",               "Delete dashboard"],
        ["GET",    "/api/dashboard/summary",                "Stat cards"],
        ["GET",    "/api/dashboard/recent-telemetry",       "Recent telemetry"],
        ["GET",    "/api/dashboard/alarm-stats",            "Alarm counts by severity"],
        ["GET",    "/api/activity-log",                     "Paginated audit trail"],
        ["GET",    "/api/system/storage",                   "Storage statistics"],
        ["GET",    "/api/system/aggregate",                 "Time-bucketed aggregation"],
        ["GET",    "/api/system/retention",                 "List retention policies"],
        ["POST",   "/api/system/retention",                 "Create retention policy"],
        ["PUT",    "/api/system/retention/:id",             "Update retention policy"],
        ["DELETE", "/api/system/retention/:id",             "Delete retention policy"],
        ["POST",   "/api/system/retention/run",             "Manual pruning trigger"],
    ],
    [2, 6.5, 8])

pdf_doc.build(story)
print(f"  PDF  saved → {PDF_OUT}")
print("Done.")
