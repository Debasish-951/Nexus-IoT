#!/usr/bin/env python3
"""Generate WS-Integrated Suite platform documentation as DOCX and PDF."""

import os
from datetime import date
from docx import Document
from docx.shared import Pt, Cm, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY

TODAY = date.today().strftime("%B %d, %Y")
VERSION = "2.0"

# ─── Colour palette ───────────────────────────────────────────────────────────
BRAND_DARK  = RGBColor(0x0f, 0x17, 0x2a)   # near-black navy
BRAND_BLUE  = RGBColor(0x06, 0xb6, 0xd4)   # cyan accent
BRAND_HEAD  = RGBColor(0x1e, 0x3a, 0x5f)   # dark blue for headings
BRAND_MUTED = RGBColor(0x64, 0x74, 0x8b)   # slate-500

RL_NAVY  = colors.HexColor("#1e3a5f")
RL_CYAN  = colors.HexColor("#06b6d4")
RL_LIGHT = colors.HexColor("#f0f9ff")
RL_STRIPE= colors.HexColor("#e8f4fd")
RL_MUTED = colors.HexColor("#94a3b8")
RL_WHITE = colors.white

# ─── Section content ──────────────────────────────────────────────────────────

SECTIONS = [
    {
        "heading": "1. Introduction",
        "body": (
            "WS-Integrated Suite is a full-stack Industrial Internet-of-Things (IIoT) "
            "data-acquisition and analytics platform. It connects field devices and sensors "
            "to a centralised data store, delivers real-time telemetry, evaluates alarm rules, "
            "and exposes rich visualisation and reporting tools for operations engineers and "
            "plant administrators.\n\n"
            "The platform is built on a React + Vite frontend served at the root path and an "
            "Express 5 REST API running under /api, backed by a PostgreSQL database managed "
            "with the Drizzle ORM. All services are deployed inside a pnpm monorepo.\n\n"
            f"Document version: {VERSION}    |    Generated: {TODAY}"
        ),
    },
    {
        "heading": "2. Architecture Overview",
        "body": (
            "The system is composed of the following layers:\n\n"
            "Frontend  —  artifacts/iot-platform  (React 18 + Vite, Tailwind CSS, shadcn/ui, "
            "Recharts, TanStack Query)\n\n"
            "API Server  —  artifacts/api-server  (Express 5, Drizzle ORM, Zod validation, "
            "Pino logging, WebSocket)\n\n"
            "Shared libraries:\n"
            "  lib/api-spec       OpenAPI 3.1 specification + Orval code-generation config\n"
            "  lib/api-client-react  Generated TanStack Query hooks and typed fetch client\n"
            "  lib/api-zod        Generated Zod schemas (auto-updated by Orval)\n"
            "  lib/db             Drizzle ORM schema and PostgreSQL migrations\n\n"
            "All traffic is routed through a shared reverse proxy (path-based routing). "
            "MQTT telemetry is consumed by a background subscriber service that starts "
            "non-blocking at server boot."
        ),
    },
    {
        "heading": "3. Database Schema",
        "subsections": [
            {
                "title": "3.1 Core Tables",
                "body": (
                    "assets  —  Hierarchical asset tree with self-referencing parentId. Supports "
                    "maintenanceMode, maintenanceSince, and maintenanceNote to suppress alarm "
                    "evaluation while a device is under maintenance.\n\n"
                    "attributes  —  Per-asset attributes of types: static, dynamic, metric, or "
                    "runtime. Key fields: tagName, sourceMetric, uom, decimalPlaces, "
                    "thousandSeparator, quality, timestamp, expression (for runtime computed values).\n\n"
                    "asset_templates  —  Reusable attribute blueprints with optional expression "
                    "support. Applied to assets via POST /api/assets/:id/apply-template.\n\n"
                    "telemetry  —  Time-series sensor readings (assetId, deviceId, metric, value, "
                    "quality, timestamp). Indexed by (asset_id, metric, timestamp), (timestamp), "
                    "and (asset_id, timestamp) for query performance."
                ),
            },
            {
                "title": "3.2 Alarm & Rule Tables",
                "body": (
                    "alarms  —  Active alarm instances with severity (critical/major/minor/warning), "
                    "status (active/acknowledged), and class.\n\n"
                    "alarm_history  —  Immutable historical alarm records.\n\n"
                    "alarm_rules  —  Threshold, deviation, rate_of_change, and heartbeat rule "
                    "definitions. Additional fields: webhookUrl, webhookEnabled, rocWindow "
                    "(rate-of-change evaluation window in seconds)."
                ),
            },
            {
                "title": "3.3 Integration & Security Tables",
                "body": (
                    "brokers  —  MQTT / REST API / Azure IoT Hub broker configurations. Fields: "
                    "mqttUsername, mqttPassword, mqttTopic, mqttClientId, mappingRules (JSONB).\n\n"
                    "broker_events  —  Immutable connection history (connected / disconnected / "
                    "error) with timestamp and message.\n\n"
                    "api_clients  —  OAuth client credentials with scopes, expiresAt, allowedIps, "
                    "secretRotatedAt, totalRequests, lastUsedAt.\n\n"
                    "destinations  —  Webhook / HTTP forward destinations with auth config, "
                    "enabled toggle, and eventTypes filter.\n\n"
                    "users  —  Platform users with roles: admin, engineer, operator, viewer.\n\n"
                    "activity_logs  —  Audit trail: action, category, actorName, actorRole, "
                    "actorUsername, targetId, targetName, detail, timestamp."
                ),
            },
            {
                "title": "3.4 Visualisation & Data Management Tables",
                "body": (
                    "viz_dashboards  —  Persisted visualisation dashboards. Columns: id, name, "
                    "roleFilter, assetFilter, widgets (JSONB), createdAt, updatedAt. Each widget "
                    "record stores: id, title, chartType, assetId, metric, color, label, uom, "
                    "UCL/LCL/CL values and styles, overlay metrics, time-range config, "
                    "granularity, aggregation type, interpolation flag, and refresh settings.\n\n"
                    "data_retention_policies  —  id, name, assetId (null = all assets), metric "
                    "(null = all metrics), retentionDays, enabled, lastPrunedAt, rowsPruned."
                ),
            },
        ],
    },
    {
        "heading": "4. API Reference",
        "subsections": [
            {
                "title": "4.1 Asset Management",
                "table": [
                    ["Method", "Endpoint", "Description"],
                    ["GET", "/api/assets", "List all assets (tree)"],
                    ["POST", "/api/assets", "Create a new asset"],
                    ["GET", "/api/assets/:id", "Get a single asset"],
                    ["PUT", "/api/assets/:id", "Update asset properties"],
                    ["DELETE", "/api/assets/:id", "Delete asset"],
                    ["POST", "/api/assets/:id/maintenance", "Toggle maintenance mode"],
                    ["GET", "/api/assets/:id/health", "Asset health score (freshness, alarms, keyMetrics)"],
                    ["GET", "/api/assets/:id/attributes", "List asset attributes"],
                    ["POST", "/api/assets/:id/attributes", "Add attribute to asset"],
                    ["POST", "/api/assets/:id/attributes/bulk", "Bulk import attributes (CSV/JSON)"],
                    ["POST", "/api/assets/:id/apply-template", "Apply template to asset"],
                ],
            },
            {
                "title": "4.2 Telemetry & Ingest",
                "table": [
                    ["Method", "Endpoint", "Description"],
                    ["GET", "/api/telemetry/:assetId", "Query telemetry (metric, from, to, limit)"],
                    ["GET", "/api/telemetry/:assetId/metrics", "Distinct metric keys for an asset"],
                    ["GET", "/api/telemetry/:assetId/export", "Download telemetry as CSV"],
                    ["POST", "/api/ingest/payload", "Single payload ingest"],
                    ["POST", "/api/ingest/validate", "Dry-run validation (no DB write)"],
                    ["POST", "/api/ingest/batch", "Batch ingest array of payloads"],
                ],
            },
            {
                "title": "4.3 Alarms & Rules",
                "table": [
                    ["Method", "Endpoint", "Description"],
                    ["GET", "/api/alarms", "List active alarms (severity/status filter)"],
                    ["POST", "/api/alarms/:id/acknowledge", "Acknowledge alarm"],
                    ["GET", "/api/alarm-history", "Paginated alarm history"],
                    ["GET", "/api/alarm-rules", "List alarm rules"],
                    ["POST", "/api/alarm-rules", "Create alarm rule"],
                    ["PUT", "/api/alarm-rules/:id", "Update alarm rule"],
                    ["DELETE", "/api/alarm-rules/:id", "Delete alarm rule"],
                    ["POST", "/api/alarm-rules/:id/test-webhook", "Fire test webhook POST"],
                ],
            },
            {
                "title": "4.4 Brokers & Connectivity",
                "table": [
                    ["Method", "Endpoint", "Description"],
                    ["GET", "/api/brokers", "List brokers"],
                    ["POST", "/api/brokers", "Create broker"],
                    ["GET", "/api/brokers/:id/history", "Broker connection event history"],
                    ["GET", "/api/api-clients", "List API clients"],
                    ["POST", "/api/api-clients", "Create API client"],
                ],
            },
            {
                "title": "4.5 Visualisation Dashboards",
                "table": [
                    ["Method", "Endpoint", "Description"],
                    ["GET", "/api/viz-dashboards", "List all saved dashboards"],
                    ["POST", "/api/viz-dashboards", "Create new dashboard"],
                    ["PUT", "/api/viz-dashboards/:id", "Update dashboard (name, access, widgets)"],
                    ["DELETE", "/api/viz-dashboards/:id", "Delete dashboard"],
                ],
            },
            {
                "title": "4.6 System & Data Management",
                "table": [
                    ["Method", "Endpoint", "Description"],
                    ["GET", "/api/system/storage", "Storage stats (total rows, table size, per-asset)"],
                    ["GET", "/api/system/aggregate", "Time-bucketed aggregation (5m–1w buckets)"],
                    ["GET", "/api/system/retention", "List data retention policies"],
                    ["POST", "/api/system/retention", "Create retention policy"],
                    ["PUT", "/api/system/retention/:id", "Update retention policy"],
                    ["DELETE", "/api/system/retention/:id", "Delete retention policy"],
                    ["POST", "/api/system/retention/run", "Manually trigger pruning"],
                ],
            },
            {
                "title": "4.7 Dashboard & Reporting",
                "table": [
                    ["Method", "Endpoint", "Description"],
                    ["GET", "/api/dashboard/summary", "Stat cards (assets, alarms, telemetry counts)"],
                    ["GET", "/api/dashboard/recent-telemetry", "Latest telemetry records"],
                    ["GET", "/api/dashboard/alarm-stats", "Alarm counts by severity"],
                    ["GET", "/api/activity-log", "Paginated audit trail (category, actor filters)"],
                    ["GET", "/api/users", "List users"],
                    ["POST", "/api/users", "Create user"],
                    ["GET", "/api/asset-templates", "List asset templates"],
                    ["POST", "/api/asset-templates", "Create asset template"],
                ],
            },
        ],
    },
    {
        "heading": "5. Frontend Pages",
        "subsections": [
            {
                "title": "5.1 Dashboard  /",
                "body": (
                    "The home dashboard displays live stat cards (total assets, active alarms, "
                    "telemetry records, connected brokers), an asset health grid that auto-refreshes "
                    "every 30 seconds, a recent telemetry table, and an alarm severity bar chart. "
                    "Each health card shows a colour-coded status (ok / alarm / stale), freshness "
                    "percentage, active alarm count, and the last-seen timestamp."
                ),
            },
            {
                "title": "5.2 Asset Management  /assets",
                "body": (
                    "A full asset hierarchy tree panel sits on the left; selecting any node opens "
                    "a detail panel on the right with three tabs:\n\n"
                    "Attributes  —  CRUD table for all asset attributes. Supports static, dynamic, "
                    "metric, and runtime (expression-evaluated) types. Inline editing with UoM, "
                    "decimal places, quality, and timestamp fields.\n\n"
                    "Trends  —  Recharts LineChart with selectable time ranges (1 h, 6 h, 24 h, "
                    "7 d), multi-metric overlay, and an Export CSV button.\n\n"
                    "Templates  —  Manage and apply asset templates to stamp attributes with "
                    "pre-configured expressions.\n\n"
                    "A persistent '+ Add New' button at the top and a 'New Root Project' button "
                    "at the bottom allow unlimited nesting of assets."
                ),
            },
            {
                "title": "5.3 Alarm Management  /alarms  /alarm-history  /alarm-rules",
                "body": (
                    "Alarms page  —  Lists all active alarms filterable by severity and status, "
                    "with an Acknowledge action available to engineers and admins.\n\n"
                    "Alarm History  —  Paginated table of all past alarm records.\n\n"
                    "Alarm Rules  —  Configure threshold, rate-of-change, and heartbeat rules. "
                    "Each rule can have a webhook URL (with test-fire button), an enable/disable "
                    "toggle, and a rate-of-change evaluation window (in seconds)."
                ),
            },
            {
                "title": "5.4 Visualisation  /visualization",
                "body": (
                    "An industrial dark-theme dashboard builder with the following capabilities:\n\n"
                    "Named dashboards  —  Create, edit, clone, and delete dashboards. Each "
                    "dashboard has per-role access control and a dropdown selector.\n\n"
                    "Widget types  —  11 types including Line, Area, Bar, Stacked Bar, Gauge, "
                    "Stat Card, Table, Heatmap, Scatter, Pie, and Image.\n\n"
                    "Multi-metric overlay  —  Up to 4 additional series per chart widget, each "
                    "with its own asset source, colour, label, and unit of measurement.\n\n"
                    "Label and UoM fields  —  Every primary series and every overlay series can "
                    "have a user-defined short label (shown in the legend and tooltip) and a "
                    "unit-of-measurement string for display purposes.\n\n"
                    "SPC Reference Lines (UCL / LCL / CL)  —  Each chart widget supports an "
                    "Upper Control Limit, Lower Control Limit, and Centre Line. Each reference "
                    "line has an independent colour picker and solid / dashed style selector. "
                    "Lines are rendered directly as Recharts ReferenceLine children to ensure "
                    "they are always visible.\n\n"
                    "Drag-to-reorder  —  Widgets can be dragged and dropped into any order on "
                    "the canvas.\n\n"
                    "Corner resize  —  Each widget has a single resize handle at the bottom-right "
                    "corner for freeform resizing.\n\n"
                    "Time range presets  —  11 global presets (Last 15 min through Last 30 days) "
                    "plus a custom from / to date-time picker per widget.\n\n"
                    "Auto-refresh  —  Per-widget refresh toggle and a global dashboard refresh "
                    "interval (1 s – 5 min).\n\n"
                    "Real-time WebSocket updates  —  The useWsEvents hook wires inbound telemetry "
                    "events to per-asset signal maps; each widget card auto-refetches on signal "
                    "change and shows an animated LIVE badge."
                ),
            },
            {
                "title": "5.5 Live Telemetry Feed  /live",
                "body": (
                    "A real-time WebSocket monitoring page split into two panels:\n\n"
                    "Left panel  —  Per-asset metric tiles. Tiles auto-expand on first data "
                    "arrival, flash on each update, and show a stale indicator after 30 seconds "
                    "of inactivity. Trend direction arrows are shown per metric.\n\n"
                    "Right panel  —  Scrollable event log with a 200-event buffer. Each row can "
                    "be expanded to show all metric values. A clear button resets the buffer.\n\n"
                    "Top bar  —  WS connection status badge, events/min counter, live asset "
                    "count, total events received, metrics tracked, and an asset filter."
                ),
            },
            {
                "title": "5.6 Broker Management  /brokers",
                "body": (
                    "Lists all configured data ingestion brokers. Supported types: MQTT, REST "
                    "API, and Azure IoT Hub. Each broker card shows connection status and can "
                    "be expanded to reveal a connection history timeline (newest-first).\n\n"
                    "MQTT brokers support: host, port, username, password, topic, client ID, "
                    "and JSON payload mapping rules that rename fields before normalisation.\n\n"
                    "The MQTT subscriber service starts non-blocking at server boot, reads all "
                    "MQTT broker configs, subscribes to each topic, applies mapping rules, "
                    "calls processNormalised, and broadcasts broker_status WebSocket events."
                ),
            },
            {
                "title": "5.7 Security  /users  /api-clients",
                "body": (
                    "Users page  —  Create and manage platform users with role assignments "
                    "(admin, engineer, operator, viewer).\n\n"
                    "API Clients page  —  Manage OAuth-style client credentials. Each client "
                    "has a set of scopes, optional IP allowlist, expiry date, and usage "
                    "statistics (totalRequests, lastUsedAt). Secret rotation is tracked via "
                    "secretRotatedAt."
                ),
            },
            {
                "title": "5.8 Activity Log  /activity-log",
                "body": (
                    "A paginated audit trail showing every significant action taken in the "
                    "system. Columns: timestamp, action, category, actor (name, role, username), "
                    "target (id, name), and detail. Filters: category dropdown and a free-text "
                    "search across actor and target fields. Auto-refreshes every 30 seconds. "
                    "25 records per page."
                ),
            },
            {
                "title": "5.9 Data Management  /data-management",
                "body": (
                    "Storage Overview  —  Total row count, table size on disk, oldest and newest "
                    "records, and a per-asset breakdown table.\n\n"
                    "Retention Policies  —  Full CRUD for data retention rules. Each policy "
                    "targets an optional asset and an optional metric (null = all). The "
                    "retentionDays field controls how far back data is kept. An enabled toggle "
                    "and last-pruned / rows-pruned statistics are shown.\n\n"
                    "Manual Pruning  —  A 'Run Now' button immediately triggers pruning across "
                    "all enabled policies outside of the scheduled hourly background job.\n\n"
                    "An hourly background job (setInterval at server start) calls runPruning() "
                    "automatically."
                ),
            },
            {
                "title": "5.10 Reports  /reports",
                "body": (
                    "On-demand report generation with three report types:\n\n"
                    "Telemetry Summary  —  Aggregated min / avg / max values per time bucket "
                    "for a selected asset and metric.\n\n"
                    "Alarm Report  —  Date-range filtered alarm records.\n\n"
                    "Asset Status Snapshot  —  Point-in-time status of all assets.\n\n"
                    "Quick-range buttons (Last 1 h, 6 h, 24 h, 7 d) and download as CSV or "
                    "JSON are available for all report types."
                ),
            },
        ],
    },
    {
        "heading": "6. Ingest Pipeline",
        "body": (
            "All inbound telemetry passes through a two-step pipeline:\n\n"
            "Step 1  normalise(body)  —  Converts a raw HTTP or MQTT payload into a "
            "NormalisedPayload structure ({deviceId, timestamp, metrics}).\n\n"
            "Step 2  processNormalised(n)  —  Performs the following in sequence:\n"
            "  1. Write telemetry rows to the time-series table.\n"
            "  2. Update dynamic attribute values and timestamps.\n"
            "  3. Evaluate runtime expression attributes using the expr-eval parser.\n"
            "  4. Evaluate alarm rules (threshold + rate-of-change).\n"
            "  5. Fire webhook deliveries for triggered/cleared alarms.\n\n"
            "Rate-of-change evaluation fetches the previous telemetry value and computes "
            "|Δvalue / Δtime| in units per second, compared against the rule threshold.\n\n"
            "Webhook delivery is non-blocking: a fetch() POST with a 5-second AbortSignal "
            "timeout fires in the background and does not block the ingest response."
        ),
    },
    {
        "heading": "7. Expression Engine (Runtime Attributes)",
        "body": (
            "Runtime attributes are evaluated on every processNormalised call using the "
            "expr-eval library, which provides safe mathematical expression parsing without "
            "eval().\n\n"
            "Variables  —  All numeric attributes on the same asset are automatically "
            "injected as variables. For example, an attribute tagged 'temperature' can be "
            "referenced as temperature in an expression.\n\n"
            "Example expressions:\n"
            "  (pressure_bar * 14.696)               — unit conversion\n"
            "  (temp_c * 9 / 5) + 32                 — Celsius to Fahrenheit\n"
            "  (kWh_total - kWh_baseline) / hours    — derived efficiency metric\n\n"
            "When a template is applied via POST /api/assets/:id/apply-template, the "
            "expression field is stamped as-is onto each attribute, ready to evaluate."
        ),
    },
    {
        "heading": "8. Role-Based Access Control (RBAC)",
        "subsections": [
            {
                "title": "8.1 Roles and Permissions",
                "table": [
                    ["Role", "View", "Assets / Templates", "Alarms Ack", "Brokers / Dest.", "Users / Clients", "All Actions"],
                    ["admin", "Yes", "Yes", "Yes", "Yes", "Yes", "Yes"],
                    ["engineer", "Yes", "Yes", "Yes", "Yes", "No", "No"],
                    ["operator", "Yes", "No", "Yes", "No", "No", "No"],
                    ["viewer", "Yes", "No", "No", "No", "No", "No"],
                ],
            },
            {
                "title": "8.2 Implementation",
                "body": (
                    "UserContext.tsx  —  Provides a can(permission) helper that checks the active "
                    "role against the ROLE_PERMISSIONS map. setActorHeaders() is called "
                    "automatically on profile switch and injects X-Actor-Name, X-Actor-Role, and "
                    "X-Actor-Username headers into every API request so the server can attribute "
                    "activity-log entries to the correct user.\n\n"
                    "RoleGuard component  —  mode='hide' removes an element from the DOM; "
                    "mode='disable' grays it out and blocks interaction.\n\n"
                    "ReadOnlyBanner  —  An amber banner is shown at the top of any page where "
                    "the active role cannot make changes, providing clear feedback."
                ),
            },
        ],
    },
    {
        "heading": "9. WebSocket Events",
        "body": (
            "The API server maintains a WebSocket server at /ws. The following event types "
            "are broadcast to all connected clients:\n\n"
            "telemetry  —  Emitted after each successful processNormalised call. Payload: "
            "{assetId, metric, value, timestamp}.\n\n"
            "broker_status  —  Emitted by the MQTT subscriber service on connect, disconnect, "
            "or error. Payload: {brokerId, brokerName, status, message}.\n\n"
            "The frontend useWsEvents hook maintains a per-asset wsSignals map. Each widget "
            "card subscribes to signals for its configured asset and auto-refetches when new "
            "data arrives, showing an animated LIVE badge."
        ),
    },
    {
        "heading": "10. Payload Simulator",
        "body": (
            "An in-app simulator (Payload Simulator page) assists in testing the ingest "
            "pipeline without physical hardware:\n\n"
            "Device Presets tab  —  Pre-configured payloads for sample devices "
            "(Sensorgrow, RF-Dryer) that can be sent with one click.\n\n"
            "Custom Asset tab  —  Select any asset from a dropdown. The simulator "
            "auto-discovers all dynamic and measurement attributes via "
            "GET /api/assets/:id/attributes, populates metric rows with configurable "
            "min/max ranges, provides sliders to adjust values, and supports single-send "
            "or auto-send with randomised jitter. A live trend chart and request log are "
            "shown inline. Payloads are sent as "
            "{deviceId: asset.identifier, timestamp, metrics}."
        ),
    },
    {
        "heading": "11. Asset Health Score",
        "body": (
            "GET /api/assets/:id/health returns a computed health summary:\n\n"
            "health  —  'alarm' if activeAlarms > 0; 'stale' if freshnessPct < 50; "
            "'ok' otherwise.\n\n"
            "freshnessPct  —  Percentage of the asset's metric attributes that have "
            "received telemetry within the last hour.\n\n"
            "activeAlarms  —  Count of unacknowledged active alarms for the asset.\n\n"
            "lastSeen  —  ISO timestamp of the most recent telemetry record.\n\n"
            "keyMetrics  —  Array of the most recent values for the asset's primary metrics."
        ),
    },
    {
        "heading": "12. Data Retention & Pruning",
        "body": (
            "Data retention policies are configured in the data_retention_policies table "
            "and managed via the /api/system/retention endpoints.\n\n"
            "Policy matching  —  A policy with a null assetId matches all assets; a null "
            "metric matches all metrics. Specific asset and metric values take precedence.\n\n"
            "Pruning logic  —  Deletes telemetry rows older than retentionDays from today. "
            "The rowsPruned counter accumulates across all runs.\n\n"
            "Scheduled job  —  An hourly setInterval registered at server startup calls "
            "runPruning() automatically.\n\n"
            "Manual trigger  —  POST /api/system/retention/run executes pruning "
            "immediately on demand."
        ),
    },
    {
        "heading": "13. Seeded Demo Data",
        "body": (
            "The database is pre-seeded with the following fixed-UUID reference data for "
            "development and demonstration:\n\n"
            "Plant 1 asset  —  UUID bbbb0001-0000-0000-0000-000000000001\n"
            "Fan asset      —  UUID bbbb0002-0000-0000-0000-000000000001\n\n"
            "6 alarm rules for the Fan (vibration, temperature, battery thresholds)\n"
            "3 users: admin (Admin), jsmith (engineer), mwilson (operator)\n"
            "1 MQTT broker (status: connected)\n"
            "2 API clients: Daimler_Truck, NodeRED_Client\n"
            "1 visualisation dashboard: 'Energy matrix' with 6 chart widgets"
        ),
    },
    {
        "heading": "14. Planned Features",
        "body": (
            "The following features are planned for future releases:\n\n"
            "Device Management  —  A dedicated device registry, firmware version tracking, "
            "and over-the-air (OTA) firmware update workflows.\n\n"
            "Scheduled PDF Reports  —  Automated report generation on a schedule with "
            "email delivery.\n\n"
            "Broker Mapping Rule UI Editor  —  A visual drag-and-drop editor for MQTT "
            "payload field mapping rules, replacing the current JSON editor.\n\n"
            "Alarm Escalation Chains  —  Multi-step escalation sequences when alarms remain "
            "unacknowledged beyond configurable time windows."
        ),
    },
]


# ══════════════════════════════════════════════════════════════════════════════
# WORD DOCUMENT GENERATOR
# ══════════════════════════════════════════════════════════════════════════════

def _set_cell_bg(cell, hex_color: str):
    """Set background colour for a table cell."""
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)


def build_docx(path: str):
    doc = Document()

    # Page margins
    for section in doc.sections:
        section.top_margin    = Cm(2.0)
        section.bottom_margin = Cm(2.0)
        section.left_margin   = Cm(2.5)
        section.right_margin  = Cm(2.5)

    # Default body font
    doc.styles["Normal"].font.name = "Calibri"
    doc.styles["Normal"].font.size = Pt(10)

    # ── Cover page ─────────────────────────────────────────────────────────
    cover = doc.add_paragraph()
    cover.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = cover.add_run("\n\n\n")

    title_p = doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    tr = title_p.add_run("WS-Integrated Suite")
    tr.font.size = Pt(32)
    tr.font.bold = True
    tr.font.color.rgb = BRAND_HEAD

    sub_p = doc.add_paragraph()
    sub_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sr = sub_p.add_run("Industrial IoT Platform — Technical Documentation")
    sr.font.size = Pt(16)
    sr.font.color.rgb = BRAND_MUTED

    doc.add_paragraph()
    meta_p = doc.add_paragraph()
    meta_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    mr = meta_p.add_run(f"Version {VERSION}    |    {TODAY}")
    mr.font.size = Pt(11)
    mr.font.color.rgb = BRAND_MUTED

    doc.add_page_break()

    # ── Sections ───────────────────────────────────────────────────────────
    for sec in SECTIONS:
        # Section heading
        h = doc.add_heading(sec["heading"], level=1)
        h.runs[0].font.color.rgb = BRAND_HEAD
        h.runs[0].font.size = Pt(14)

        if "body" in sec:
            p = doc.add_paragraph(sec["body"])
            p.paragraph_format.space_after = Pt(8)

        for sub in sec.get("subsections", []):
            sh = doc.add_heading(sub["title"], level=2)
            sh.runs[0].font.color.rgb = BRAND_HEAD
            sh.runs[0].font.size = Pt(12)

            if "body" in sub:
                sp = doc.add_paragraph(sub["body"])
                sp.paragraph_format.space_after = Pt(6)

            if "table" in sub:
                rows = sub["table"]
                tbl = doc.add_table(rows=len(rows), cols=len(rows[0]))
                tbl.style = "Table Grid"
                tbl.alignment = WD_TABLE_ALIGNMENT.LEFT
                for ri, row_data in enumerate(rows):
                    for ci, cell_text in enumerate(row_data):
                        cell = tbl.cell(ri, ci)
                        cell.text = cell_text
                        run = cell.paragraphs[0].runs[0]
                        run.font.size = Pt(9)
                        if ri == 0:
                            run.font.bold = True
                            run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                            _set_cell_bg(cell, "1e3a5f")
                        elif ri % 2 == 0:
                            _set_cell_bg(cell, "e8f4fd")
                doc.add_paragraph()

    doc.save(path)
    print(f"  DOCX saved: {path}")


# ══════════════════════════════════════════════════════════════════════════════
# PDF GENERATOR
# ══════════════════════════════════════════════════════════════════════════════

def build_pdf(path: str):
    doc = SimpleDocTemplate(
        path, pagesize=A4,
        leftMargin=2.2*cm, rightMargin=2.2*cm,
        topMargin=2.2*cm, bottomMargin=2.2*cm,
    )

    styles = getSampleStyleSheet()

    S_TITLE = ParagraphStyle("DocTitle",
        fontName="Helvetica-Bold", fontSize=28, textColor=RL_NAVY,
        alignment=TA_CENTER, spaceAfter=6)
    S_SUBTITLE = ParagraphStyle("DocSubtitle",
        fontName="Helvetica", fontSize=14, textColor=RL_MUTED,
        alignment=TA_CENTER, spaceAfter=4)
    S_META = ParagraphStyle("DocMeta",
        fontName="Helvetica", fontSize=10, textColor=RL_MUTED,
        alignment=TA_CENTER, spaceAfter=30)
    S_H1 = ParagraphStyle("H1",
        fontName="Helvetica-Bold", fontSize=14, textColor=RL_NAVY,
        spaceBefore=18, spaceAfter=6,
        borderPad=4, leading=18)
    S_H2 = ParagraphStyle("H2",
        fontName="Helvetica-Bold", fontSize=11, textColor=RL_NAVY,
        spaceBefore=12, spaceAfter=4)
    S_BODY = ParagraphStyle("Body",
        fontName="Helvetica", fontSize=9.5, textColor=colors.HexColor("#1e293b"),
        leading=14, spaceAfter=8, alignment=TA_JUSTIFY)

    story = []

    # Cover
    story.append(Spacer(1, 3*cm))
    story.append(Paragraph("WS-Integrated Suite", S_TITLE))
    story.append(Paragraph("Industrial IoT Platform — Technical Documentation", S_SUBTITLE))
    story.append(Paragraph(f"Version {VERSION}  |  {TODAY}", S_META))
    story.append(HRFlowable(width="100%", thickness=2, color=RL_CYAN))
    story.append(PageBreak())

    for sec in SECTIONS:
        story.append(Paragraph(sec["heading"], S_H1))
        story.append(HRFlowable(width="100%", thickness=0.5, color=RL_CYAN, spaceAfter=4))

        if "body" in sec:
            for line in sec["body"].split("\n\n"):
                story.append(Paragraph(line.replace("\n", " "), S_BODY))

        for sub in sec.get("subsections", []):
            story.append(Paragraph(sub["title"], S_H2))

            if "body" in sub:
                for line in sub["body"].split("\n\n"):
                    story.append(Paragraph(line.replace("\n", " "), S_BODY))

            if "table" in sub:
                rows = sub["table"]
                col_count = len(rows[0])
                col_width = (A4[0] - 4.4*cm) / col_count

                tdata = []
                for ri, row in enumerate(rows):
                    trow = []
                    for cell in row:
                        style = ParagraphStyle(
                            "tc",
                            fontName="Helvetica-Bold" if ri == 0 else "Helvetica",
                            fontSize=8,
                            textColor=RL_WHITE if ri == 0 else colors.HexColor("#1e293b"),
                            leading=11,
                        )
                        trow.append(Paragraph(cell, style))
                    tdata.append(trow)

                ts = TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), RL_NAVY),
                    ("GRID",       (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [RL_WHITE, RL_STRIPE]),
                    ("VALIGN",     (0, 0), (-1, -1), "MIDDLE"),
                    ("TOPPADDING",    (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ("LEFTPADDING",   (0, 0), (-1, -1), 6),
                ])
                t = Table(tdata, colWidths=[col_width]*col_count, repeatRows=1)
                t.setStyle(ts)
                story.append(t)
                story.append(Spacer(1, 0.3*cm))

    doc.build(story)
    print(f"  PDF  saved: {path}")


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    out_dir = "docs"
    os.makedirs(out_dir, exist_ok=True)
    docx_path = os.path.join(out_dir, "WS-Integrated-Suite-Documentation.docx")
    pdf_path  = os.path.join(out_dir, "WS-Integrated-Suite-Documentation.pdf")
    print("Generating documentation…")
    build_docx(docx_path)
    build_pdf(pdf_path)
    print("Done.")
