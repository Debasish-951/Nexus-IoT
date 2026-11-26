export type ContentItem =
  | { type: "h1"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; lang: string; text: string }
  | { type: "note"; text: string }
  | { type: "pagebreak" }
  | { type: "divider" };

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

export const PLATFORM_VERSION = "1.0";
export const PLATFORM_NAME = "WS-Integrated Suite";
export const DOC_DATE = "May 2026";

export function buildDocumentContent(): ContentItem[] {
  return [
    // ─── COVER ────────────────────────────────────────────────────────────────
    h1("WS-Integrated Suite"),
    h2("Platform User Manual & Technical Documentation"),
    p(`Version ${PLATFORM_VERSION}  |  ${DOC_DATE}`),
    p("Industrial IoT Data Acquisition & Analytics Platform"),
    divider(),
    p("This document provides comprehensive guidance for operating, configuring, and integrating with the WS-Integrated Suite platform. It is intended for operators, engineers, administrators, and system integrators."),
    pb(),

    // ─── TABLE OF CONTENTS ────────────────────────────────────────────────────
    h1("Table of Contents"),
    p("PART I — USER MANUAL"),
    ul([
      "Chapter 1: Introduction & Overview",
      "Chapter 2: Navigation & Interface",
      "Chapter 3: Home — Project List",
      "Chapter 4: Asset Hub",
      "Chapter 5: Data Insights",
      "Chapter 6: Event Manager",
      "Chapter 7: Integration Hub & Data Destinations",
      "Chapter 8: Security — Users & API Clients",
      "Chapter 9: System Management",
      "Chapter 10: Visualization Dashboards",
      "Chapter 11: Live Telemetry Monitor",
      "Chapter 12: Audit Log",
      "Chapter 13: Payload Simulator (switched off by default)",
      "Chapter 14: Role-Based Access Control",
    ]),
    p("PART II — TECHNICAL DOCUMENTATION"),
    ul([
      "Chapter 15: Architecture Overview",
      "Chapter 16: Database Schema Reference",
      "Chapter 17: REST API Reference",
      "Chapter 18: Data Ingestion Pipeline",
      "Chapter 19: MQTT Integration",
      "Chapter 20: Expression Engine",
      "Chapter 21: Alarm Rules Engine",
      "Chapter 22: WebSocket Protocol",
      "Chapter 23: Authentication & Authorization",
      "Chapter 24: Webhook & Destination System",
    ]),
    pb(),

    // ═══════════════════════════════════════════════════════════════════════════
    //  PART I — USER MANUAL
    // ═══════════════════════════════════════════════════════════════════════════
    h1("PART I — USER MANUAL"),
    pb(),

    // ─── CHAPTER 1 ────────────────────────────────────────────────────────────
    h1("Chapter 1: Introduction & Overview"),
    h2("1.1 About WS-Integrated Suite"),
    p("WS-Integrated Suite is a full-stack industrial IoT (Internet of Things) data acquisition and analytics platform designed for industrial environments such as manufacturing plants, energy facilities, and utility infrastructure. It provides a unified interface for collecting sensor data from physical devices and gateways, visualising real-time and historical telemetry, managing alarms, and integrating with external systems."),
    p("The platform is built on a modern technology stack: a React + Vite single-page application as the frontend, an Express 5 REST API server as the backend, PostgreSQL as the time-series and operational database, and a real-time WebSocket server for live data streaming to connected clients."),

    h2("1.2 Key Capabilities"),
    ul([
      "Asset Hierarchy Management — Model physical equipment as a tree of Projects and Assets, with unlimited nesting and parent-child relationships.",
      "Multi-Format Data Ingest — Accept telemetry payloads in four auto-detected formats (flat, nested-root, nested-data, nested-metrics) from any HTTP or MQTT source.",
      "Real-Time Telemetry — Stream live sensor readings to the browser via WebSocket with per-asset metric tiles and animated LIVE indicators.",
      "Alarm Rules Engine — Evaluate threshold and rate-of-change rules on every ingest and fire webhook notifications. (Heartbeat and deviation rules can be stored but are not evaluated yet; their options are hidden unless the advanced alarm options switch is on.)",
      "Dynamic & Runtime Attributes — Automatically update asset attribute values from incoming telemetry; compute derived values using a safe math expression engine.",
      "Integration Hub — Connect MQTT brokers, REST API sources, and Azure IoT Hubs with configurable payload mapping rules.",
      "Visualization Dashboards — Build named, persistent dashboards with 11 widget types (Line, Area, Bar, Gauge, Pie, Donut, KPI, Heatmap, Table, ScatterPlot, StackedBar) and global time-range control.",
      "Data Destinations — Forward alarm and telemetry events as HTTP POST webhooks to any external system with Bearer, API Key, or Basic Auth.",
      "Security & RBAC — Nine built-in roles (Super Admin, Company Admin, Admin, Project Manager, Team Lead, Developer, Engineer, Operator, Viewer). The API server enforces every permission; the UI hides or disables what your role cannot do.",
      "Audit Trail — Immutable activity log capturing all significant actions with actor identity, timestamps, and change details.",
      "Data Retention — Configurable per-asset, per-metric retention policies with hourly automated pruning and manual trigger support.",
      "Reporting — On-demand generation of Telemetry Summary, Alarm Report, and Asset Status Snapshot reports in CSV and JSON format.",
      "API Client Management — Issue OAuth-style bearer tokens with scoped access, IP allowlisting, and token rotation for external system integration.",
      "Payload Simulator — Browser-based tool to send test payloads without physical hardware. Switched off by default; your administrator can enable it for commissioning or demos.",
    ]),

    h2("1.3 Supported Use Cases"),
    ul([
      "Energy monitoring and sub-metering in commercial and industrial facilities.",
      "Predictive maintenance — track vibration, temperature, and run-hours; alert before failure.",
      "Environmental monitoring — CO2, humidity, temperature across multiple zones.",
      "SCADA integration — receive data from PLCs and DCS via MQTT or REST and present it in a unified dashboard.",
      "Fleet / remote asset monitoring — track GPS, fuel, battery, and operational status of distributed equipment.",
    ]),

    h2("1.4 System Requirements"),
    table(
      ["Component", "Requirement"],
      [
        ["Browser", "Chrome 110+, Firefox 110+, Edge 110+, Safari 16+ (WebSocket support required)"],
        ["Network", "HTTPS access to platform URL; WebSocket (WSS) on same origin"],
        ["Screen Resolution", "1280 × 720 minimum; 1920 × 1080 recommended"],
        ["Server OS", "Linux (NixOS/Debian/Ubuntu recommended)"],
        ["Database", "PostgreSQL 14+"],
        ["Node.js", "20+ (LTS)"],
        ["Memory", "2 GB RAM minimum for server; 4 GB recommended"],
        ["Storage", "SSD recommended for time-series performance; size depends on telemetry volume"],
      ]
    ),

    h2("1.5 Getting Started — First Login"),
    ol([
      "Navigate to the platform URL provided by your administrator.",
      "New accounts start as invitations: open the activation link your administrator sent you and choose a password. There are no default credentials.",
      "On the login page, sign in with your username (or email) and password. Once authenticated, Home opens and lists the projects you may open.",
      "Your role (one of the nine roles in Chapter 14) determines which features and actions are available.",
      "Check the top-right corner for your profile and role. To work as a different role, sign out from the profile menu and log back in as that user.",
      "Begin by navigating to Asset Hub to create your first project and add assets.",
    ]),
    pb(),

    // ─── CHAPTER 2 ────────────────────────────────────────────────────────────
    h1("Chapter 2: Navigation & Interface"),
    h2("2.1 Main Navigation Panel"),
    p("The left sidebar provides access to all sections of the platform. It is organized into functional groups:"),
    table(
      ["Group", "Pages Included"],
      [
        ["Home", "Project list — the projects your role lets you open"],
        ["Asset Hub", "Assets (hierarchy + attributes), Asset Templates, Media Library"],
        ["Data Insights", "Visualization, dashboard templates, Live Feed"],
        ["Live Twin", "3D and 2D twins of machines, processes and plants, linked to live asset data"],
        ["AI Advisor", "Natural-language questions, health insights, recommendations"],
        ["Event Manager", "Active Alarms, Alarm History, Alarm Rules"],
        ["Integration Hub", "Broker configuration, API Clients, Destinations, Connections, Integration Guide"],
        ["Governance", "User Management, Security Center, Notification Groups"],
        ["System", "Data Management, Reports"],
        ["Audit Log", "Audit trail of all platform actions"],
        ["Payload Simulator", "Browser-based device payload tester (shown only when the payload simulator is switched on)"],
      ]
    ),
    p("Click any parent group to expand or collapse its child pages. The currently active page is highlighted in the sidebar."),

    h2("2.2 Header Bar"),
    p("The top header bar contains three main elements:"),
    ul([
      "Broker Status Bar — A compact indicator showing the connection status of configured brokers (green = connected, amber = connecting, red = error). Clicking opens the Integration Hub → Broker page.",
      "Notification Bell — Displays a badge with the count of active unacknowledged alarms. Clicking opens the Active Alarms page.",
      "User Profile Menu — Displays the logged-in user's name and role badge. Clicking opens a dropdown with options to change your password and sign out.",
    ]),

    h2("2.3 User Profile & Roles"),
    p("Each user signs in with their own credentials and has a single role. The User Profile menu (top-right) shows your current name and role. To work under a different role, sign out and log back in as that user."),
    p("Signing in creates a server-side session held in an HttpOnly cookie. The API server identifies you from that session and records every action in the Audit Log under your identity; the browser cannot supply or change that identity."),
    note("Login is credential-based (username/email + password). Your role and permissions are read from the server on every request, so a role change by an administrator applies without signing out."),

    h2("2.4 Responsive Layout"),
    p("The platform layout consists of the fixed sidebar on the left and a main content area on the right. The content area is scrollable independently of the sidebar. All modal dialogs and dropdown menus are rendered at the document level and appear above all other content using z-index stacking contexts."),
    pb(),

    // ─── CHAPTER 3 ────────────────────────────────────────────────────────────
    h1("Chapter 3: Home — Project List"),
    h2("3.1 Overview"),
    p("Home is the first page shown on login. It lists the projects you may open; a project is a top-level asset in the Asset Hub. Pick a project to work inside it. Project Managers see every project. Team Leads and Developers see only the projects assigned to them. Other roles follow the per-user project setting chosen by an administrator."),
    note("Earlier versions opened a plant-wide Dashboard with stat cards, an asset health grid, recent telemetry and an alarm severity chart. That page is no longer reachable. The sections below describe the status information that the platform's dashboard API still serves and that other pages reuse."),

    h2("3.2 Stat Cards"),
    p("Four summary cards appear at the top of the dashboard:"),
    table(
      ["Card", "Description"],
      [
        ["Total Assets", "Count of all assets configured in the system hierarchy."],
        ["Active Alarms", "Number of alarm instances currently in 'active' or 'acknowledged' status."],
        ["Data Points Today", "Total telemetry records written since midnight (UTC)."],
        ["Connected Brokers", "Count of MQTT/REST/Azure IoT brokers with 'connected' status."],
      ]
    ),

    h2("3.3 Asset Health Grid"),
    p("Below the stat cards is an auto-refreshing grid showing one tile per asset. Each tile displays the asset name, its health status, active alarm count, and the time since the last telemetry reading."),
    p("Health status is calculated on the server and has three states:"),
    table(
      ["Status", "Color", "Condition"],
      [
        ["OK", "Green", "No active alarms AND freshness ≥ 50% (data received within last hour for majority of expected attributes)"],
        ["ALARM", "Red", "One or more active alarms on this asset"],
        ["STALE", "Amber", "Freshness < 50% — data not received recently for most attributes (device may be offline)"],
      ]
    ),
    p("The freshness percentage is calculated from the ratio of attributes that have received telemetry within the last hour versus the total number of dynamic/metric attributes."),

    h2("3.4 Recent Telemetry Table"),
    p("This table shows the latest telemetry records across all assets — the most recent sensor readings ingested into the platform. Columns include asset name, metric key, value (with unit of measure if configured), quality indicator, and timestamp."),

    h2("3.5 Alarm Severity Chart"),
    p("A horizontal bar chart showing the count of active alarms grouped by severity: Critical, High, Medium, and Low. This gives operators an immediate visual overview of alarm severity distribution across the entire installation."),
    pb(),

    // ─── CHAPTER 4 ────────────────────────────────────────────────────────────
    h1("Chapter 4: Asset Hub"),
    h2("4.1 Asset Hierarchy"),
    p("The platform models physical equipment using a hierarchical tree structure. The tree supports unlimited nesting. Every node in the tree is an 'Asset.' Assets at the root level are typically called Projects or Plants. Child assets represent individual machines, sub-systems, or measurement points."),
    p("For example:"),
    code("text", `Plant 1
  ├── Chiller A
  │     ├── Compressor
  │     └── Cooling Tower
  ├── Electrical Panel
  └── Solar Array`),
    p("This hierarchy is displayed in the left panel of the Assets page. Each row shows the asset name, identifier, type, and maintenance status."),

    h2("4.2 Creating a Root Project"),
    ol([
      "Navigate to Asset Hub → Assets from the left sidebar.",
      "Click the '+ Add New' button at the top of the asset panel or the 'New Root Project' button at the bottom of the tree.",
      "Enter the project Name (required) and optionally an Identifier, Description, and Asset Type.",
      "The Identifier field is critical — it must exactly match the 'deviceId' value sent by the physical device that will report data for this asset.",
      "Click Create. The project appears in the tree.",
    ]),
    note("The Identifier is case-sensitive and must be unique across the entire system. A mismatch will cause the ingest API to return HTTP 422."),

    h2("4.3 Creating Child Assets"),
    ol([
      "Click on a parent asset in the tree to select it.",
      "Click the '+ Add New' button — the dialog will show the parent context.",
      "Fill in the child asset details and click Create.",
      "The child asset is nested under the selected parent in the tree.",
    ]),

    h2("4.4 Asset Attributes"),
    p("Each asset can have any number of attributes. Attributes describe the asset's properties and sensor readings. There are four types:"),
    table(
      ["Type", "Description", "Updated By"],
      [
        ["Static", "Fixed descriptive information (e.g., model number, installation date). Never changes automatically.", "Manual edit only"],
        ["Dynamic", "Values updated automatically when telemetry is ingested via the ingest API. Maps to a specific metric key.", "Ingest pipeline"],
        ["Metric", "Sensor measurement with unit of measure (UoM), decimal places, and thousand-separator formatting.", "Ingest pipeline"],
        ["Runtime", "Computed value derived from an expression using other numeric attributes as variables. Recalculated on every ingest.", "Expression engine"],
      ]
    ),
    p("Attribute fields available during creation:"),
    ul([
      "Name — Display name of the attribute.",
      "Tag Name — Short identifier used in expressions and exports.",
      "Source Metric — The metric key in the telemetry payload that updates this attribute (for Dynamic/Metric types).",
      "Value — Current value (editable for Static; auto-updated for Dynamic/Metric/Runtime).",
      "Unit of Measure (UoM) — e.g., kWh, °C, bar, RPM.",
      "Decimal Places — Number of decimal places for display formatting.",
      "Thousand Separator — Toggle to show 1,234.5 vs 1234.5.",
      "Quality — Data quality flag: good, bad, or uncertain.",
      "Timestamp — Last update timestamp.",
      "Expression — Math expression for Runtime attributes (e.g., voltage * current / 1000).",
    ]),

    h2("4.5 Adding Attributes"),
    p("Attributes can be added in two ways:"),
    ul([
      "One-by-one: Click 'Add Attribute' on the asset's attribute table and fill the form.",
      "Bulk import: Click 'Bulk Import' to upload a CSV or JSON file containing multiple attribute definitions at once.",
    ]),
    p("CSV import format requires columns: name, tagName, type, sourceMetric, value, uom, decimalPlaces, expression."),

    h2("4.6 Attribute Quality Indicator"),
    p("Every attribute shows a quality indicator:"),
    table(
      ["Quality", "Color", "Meaning"],
      [
        ["Good", "Green", "Data is fresh and reliable"],
        ["Uncertain", "Amber", "Data may be delayed or from an unreliable source"],
        ["Bad", "Red", "Data is known to be invalid or the source is offline"],
      ]
    ),

    h2("4.7 Asset Templates"),
    p("Templates allow you to define a reusable set of attributes that can be stamped onto multiple assets. This is useful when many assets of the same type share the same attribute structure (e.g., all chillers have the same 8 monitoring points)."),
    h3("Creating a Template"),
    ol([
      "Navigate to Asset Hub → Asset Templates from the sidebar.",
      "Click 'New Template' and enter a name and description.",
      "Add attributes to the template exactly as you would for an individual asset, including expressions for runtime attributes.",
      "Save the template.",
    ]),
    h3("Applying a Template"),
    ol([
      "Select an asset in the tree.",
      "Click 'Apply Template' in the asset detail panel.",
      "Select the template from the dropdown.",
      "Click Apply — all template attributes are copied to the asset. Expressions are preserved.",
    ]),
    note("Applying a template to an asset that already has attributes will add the template attributes without removing existing ones. If an attribute with the same tag name exists, it will be updated."),

    h3("Master Template → Section Worksheets"),
    p("A large payload is easier to manage as one master template that is split into section-wise templates in a spreadsheet. Create one template from the raw device payload, export the worksheet, split it, and import the parts back — the header never changes."),
    ol([
      "Create a template and paste the raw device payload into the import panel — every key becomes an attribute definition.",
      "On the Asset Templates page, select the template (or nothing, for all of them) and click Export. An .xlsx worksheet is produced: green header row, frozen, with dropdowns on the columns you fill in.",
      "Only Attribute Name, Tag Name and any unit already set are pre-filled. Type, Device Template Name, Data Type and Required are left blank on purpose — they are yours to decide per section.",
      "In Excel, split the rows into section-wise files, fill the blank columns, and set the Device Template Name on each row to the section it belongs to. Keep the header row as-is.",
      "Click Import and choose a file (.xlsx or .csv). The preview lists each Device Template Name, whether it will be created or merged into, and any row-level problem.",
      "Confirm. New template names are created; existing ones are merged into, matching on Tag Name — nothing is deleted.",
      "When creating an asset, pick the section template so the asset gets exactly that section's attributes.",
    ]),
    table(
      ["Column", "Required", "Pre-filled", "Meaning"],
      [
        ["Attribute Name", "Yes", "Yes", "Display name — free text, choose whatever reads best."],
        ["Type", "Yes", "No", "static, dynamic, metric or timestamp."],
        ["Device Template Name", "Yes", "No", "Which template the row belongs to. A name that does not exist yet is created on import."],
        ["Tag Name", "Yes", "Yes", "Must match the incoming payload key. This is the binding — a mismatch means the attribute never receives data."],
        ["Data Type", "Yes", "No", "text, number, double, boolean or timestamp."],
        ["UoM", "No", "If set", "Unit shown next to the value (kWh, °C, mm/s…)."],
        ["Decimal Place", "No", "If set", "0–10. Display rounding for numeric values; blank shows the raw value."],
        ["Required", "No", "No", "TRUE or FALSE. Recorded on the definition; not currently enforced."],
      ],
    ),
    note("Import blocks on structural problems — a blank or unknown Type, Device Template Name or Data Type, a missing name or tag, a Decimal Place outside 0–10, or the same tag used twice in one template. A tag that matches no existing template is only a warning, since a template is often authored before its device has ever reported. Only the first sheet of a workbook is read."),

    h2("4.8 Maintenance Mode"),
    p("Any asset can be placed in Maintenance Mode to suppress alarm evaluation while work is being performed. When maintenance mode is enabled:"),
    ul([
      "No new alarms are triggered for this asset.",
      "Telemetry continues to be ingested and stored normally.",
      "A maintenance badge appears on the asset in the health grid and tree.",
      "A maintenance note (optional) is stored with the start time.",
    ]),
    p("To toggle maintenance mode, select the asset and click 'Maintenance Mode' toggle. A dialog prompts for an optional note. The note and start timestamp are recorded in the asset record."),

    h2("4.9 Asset Health Score"),
    p("Each asset has a computed health score accessible via the API endpoint GET /api/assets/:id/health. The response includes:"),
    ul([
      "health — 'ok', 'alarm', or 'stale'",
      "freshnessPct — Percentage of attributes with recent (last-hour) telemetry",
      "activeAlarms — Count of active/acknowledged alarms",
      "lastSeen — Timestamp of the most recent telemetry record for this asset",
      "keyMetrics — Array of recent metric name-value pairs",
    ]),

    h2("4.10 Trends Tab"),
    p("Each asset has a Trends tab in its detail view. This provides an interactive line chart of historical telemetry with the following controls:"),
    ul([
      "Time Range selector — 1 hour, 6 hours, 24 hours, 7 days",
      "Metric selector — choose which metric keys to plot",
      "Multi-metric overlay — up to 5 metrics on the same chart with different colors",
      "Export CSV — download the currently displayed data as a CSV file",
      "Chart rendering using Recharts with smooth curves, tooltips, and responsive sizing",
    ]),
    pb(),

    // ─── CHAPTER 5 ────────────────────────────────────────────────────────────
    h1("Chapter 5: Data Insights"),
    h2("5.1 Overview"),
    p("The Data Explorer page provides an advanced telemetry query interface for exploring historical sensor data across all assets. Unlike the Trends tab (which is scoped to one asset), the Data Explorer allows cross-asset queries and more detailed time-range control."),

    h2("5.2 Querying Telemetry"),
    p("To query telemetry:"),
    ol([
      "Select an asset from the asset tree panel on the left.",
      "Select one or more metrics from the metric dropdown.",
      "Choose a time range using the preset buttons (1h, 6h, 24h, 7d) or set custom from/to dates.",
      "The chart updates automatically with the selected data.",
    ]),

    h2("5.3 Chart Types"),
    p("The Data Explorer supports three chart rendering modes:"),
    table(
      ["Type", "Best For"],
      [
        ["Line", "Continuous sensor readings (temperature, pressure, vibration)"],
        ["Area", "Showing volume or cumulative values (energy consumed, flow totals)"],
        ["Bar", "Discrete or aggregated values (event counts, daily totals)"],
      ]
    ),

    h2("5.4 Multi-Metric Overlay"),
    p("You can overlay multiple metrics on the same chart. Add additional series by clicking the '+' button next to the metric selector. Up to 5 metrics can be displayed simultaneously, each with a unique color. This is useful for comparing related metrics (e.g., voltage and current) or cross-asset comparisons."),

    h2("5.5 Export as CSV"),
    p("Click the 'Export CSV' button to download the currently displayed telemetry as a CSV file. The file includes columns for asset name, metric name, value, quality, and timestamp. This is suitable for import into Excel, MATLAB, Python, or any data analysis tool."),
    pb(),

    // ─── CHAPTER 6 ────────────────────────────────────────────────────────────
    h1("Chapter 6: Event Manager"),
    h2("6.1 Active Alarms"),
    p("The Active Alarms page shows all alarm instances that are currently active or acknowledged. Alarms are triggered automatically by the alarm rules engine whenever a telemetry value violates a configured rule."),
    p("Each alarm record shows:"),
    ul([
      "Alarm Name — inherited from the alarm rule name.",
      "Asset — the asset that owns the alarm rule.",
      "Severity — Critical, High, Medium, or Low.",
      "Status — Active (not yet acknowledged) or Acknowledged.",
      "Class — threshold or rate_of_change. (heartbeat and deviation can be stored on a rule but are not evaluated yet.)",
      "Message — human-readable description including the metric name, condition, and actual value.",
      "Trigger Value — the numeric value that triggered the alarm.",
      "Triggered At — timestamp when the alarm was created.",
      "Acknowledged At — timestamp of acknowledgement (if applicable).",
    ]),

    h2("6.2 Severity Levels"),
    table(
      ["Severity", "Color", "Typical Use"],
      [
        ["Critical", "Dark Red", "Immediate action required — safety risk or severe equipment damage"],
        ["High", "Red", "Urgent attention required — significant deviation from normal"],
        ["Medium", "Amber", "Should be investigated within a reasonable timeframe"],
        ["Low", "Yellow", "Informational — minor deviation, monitor closely"],
      ]
    ),

    h2("6.3 Alarm Status Workflow"),
    p("Alarms follow a defined lifecycle:"),
    ol([
      "ACTIVE — Alarm is triggered by the rules engine. No action taken yet.",
      "ACKNOWLEDGED — An operator or engineer has noted the alarm. The triggering condition may still be present.",
      "CLEARED — The condition that triggered the alarm is no longer present. The alarm is resolved automatically by the rules engine on the next evaluation, or manually.",
    ]),
    note("Acknowledged alarms remain visible in the Active Alarms list. They are only removed when they transition to CLEARED and are moved to the Alarm History."),

    h2("6.4 Acknowledging Alarms"),
    ol([
      "Navigate to Event Manager → Alarm List.",
      "Locate the alarm to acknowledge.",
      "Click the 'Acknowledge' button in the alarm row.",
      "The status changes to 'Acknowledged' and the acknowledgedAt timestamp is recorded.",
      "The action is also recorded in the Audit Log with the actor's identity.",
    ]),

    h2("6.5 Filtering Alarms"),
    p("The Active Alarms page provides two filter controls:"),
    ul([
      "Severity filter — show only Critical, High, Medium, or Low alarms (or All).",
      "Status filter — show only Active, Acknowledged, or Cleared alarms (or All).",
    ]),

    h2("6.6 Alarm History"),
    p("The Alarm History page shows an immutable, paginated log of all alarm events — including alarms that have been cleared. It cannot be edited or deleted. It is useful for compliance, maintenance records, and trend analysis."),
    p("Filters available: severity, status, date range (from/to). The list is paginated with 25 records per page and shows the most recent events first."),

    h2("6.7 Alarm Rules"),
    p("Alarm rules are configured on the Alarm Rules page. Each rule defines the conditions under which an alarm is triggered for a specific asset and metric combination."),

    h3("6.7.1 Threshold Rules"),
    p("The most common rule type. An alarm is triggered when the metric value crosses a threshold."),
    table(
      ["Condition Operator", "Description"],
      [
        ["gt (greater than)", "Alarm when value > threshold"],
        ["gte (greater than or equal)", "Alarm when value ≥ threshold"],
        ["lt (less than)", "Alarm when value < threshold"],
        ["lte (less than or equal)", "Alarm when value ≤ threshold"],
        ["eq (equal)", "Alarm when value = threshold"],
        ["neq (not equal)", "Alarm when value ≠ threshold"],
      ]
    ),

    h3("6.7.2 Rate-of-Change Rules"),
    p("Triggers when the rate of change of a metric exceeds a configured limit. Useful for detecting sudden spikes or drops (e.g., voltage sag, vibration surge)."),
    ul([
      "rocWindow — time window in seconds over which the rate is computed (default: 60 seconds).",
      "The rate is computed as |Δvalue / Δtime| in units per second.",
      "An alarm is triggered when the computed rate exceeds the rule threshold.",
    ]),

    h3("6.7.3 Heartbeat Rules (not evaluated yet)"),
    p("Intended to raise an alarm when no telemetry arrives for an asset/metric within an expected interval. The server stores this rule type but does not evaluate it yet, so it never fires. The option is hidden unless the advanced alarm options switch (VITE_ENABLE_ADVANCED_ALARM_OPTIONS) is on at build time."),

    h3("6.7.4 Deviation Rules (not evaluated yet)"),
    p("Intended to raise an alarm when a metric drifts from an expected value. Like heartbeat rules, the server stores this type but does not evaluate it, and the option is hidden behind the advanced alarm options switch."),
    note("The rate-of-change Window, Scan Rate and Require Acknowledge options are also stored but not evaluated, and are hidden behind the same switch. Existing rules keep their stored values. Email, WhatsApp and SMS notification toggles and Notification Groups are shown so they can be set up in advance, but the server does not deliver those channels yet. Webhooks are delivered today. Building with VITE_DISABLE_NOTIFICATION_CHANNELS=true hides them."),

    h3("6.7.5 Rule Configuration Fields"),
    table(
      ["Field", "Description"],
      [
        ["Name", "Descriptive name for the alarm rule"],
        ["Asset", "The asset this rule applies to"],
        ["Metric", "The metric key to monitor (e.g., chiller.energy_kWh)"],
        ["Condition", "The comparison operator (gt, lt, gte, lte, eq, neq)"],
        ["Threshold", "The numeric value to compare against"],
        ["Severity", "Critical, High, Medium, or Low"],
        ["Alarm Class", "threshold or rate_of_change (heartbeat and deviation only with the advanced alarm options switch on, and not evaluated)"],
        ["Enabled", "Toggle to activate or deactivate the rule without deleting it"],
        ["ROC Window", "Stored but not evaluated yet; shown only with the advanced alarm options switch on"],
        ["Webhook URL", "Optional HTTP endpoint to notify when this specific rule fires"],
        ["Webhook Enabled", "Toggle to enable/disable the webhook for this rule"],
      ]
    ),

    h3("6.7.6 Test Webhook"),
    p("Each alarm rule with a webhook URL has a 'Test Webhook' button. Clicking it sends a test POST request to the configured URL immediately, without waiting for the alarm condition to be met. Use this to verify the webhook endpoint is reachable and correctly configured before deploying in production."),
    pb(),

    // ─── CHAPTER 7 ────────────────────────────────────────────────────────────
    h1("Chapter 7: Integration Hub & Data Destinations"),
    h2("7.1 Broker Types"),
    p("The platform supports three broker types for receiving data from external systems:"),
    table(
      ["Type", "Protocol", "Use Case"],
      [
        ["MQTT", "MQTT 3.1.1 / 5.0", "IoT sensors, PLCs, edge gateways via MQTT broker (e.g., Mosquitto, EMQX, HiveMQ)"],
        ["REST API", "HTTP/HTTPS", "External systems that push data via HTTP POST to the platform"],
        ["Azure IoT", "AMQP/MQTT", "Microsoft Azure IoT Hub device-to-cloud messages"],
      ]
    ),

    h2("7.2 Creating an MQTT Broker"),
    ol([
      "Navigate to Integration Hub → Broker.",
      "Click 'Add Broker' and select type: MQTT.",
      "Enter the broker configuration:",
    ]),
    table(
      ["Field", "Description"],
      [
        ["Name", "Friendly name for this broker connection"],
        ["Host", "MQTT broker hostname or IP address (e.g., mqtt.example.com)"],
        ["Port", "MQTT port (default: 1883 for plain, 8883 for TLS)"],
        ["Client ID", "Unique identifier for this platform's MQTT connection"],
        ["Username", "MQTT authentication username (if required)"],
        ["Password", "MQTT authentication password (if required)"],
        ["Topic", "MQTT topic to subscribe to. Supports wildcards: + (single level), # (multi-level)"],
      ]
    ),
    p("Click Save. The MQTT subscriber service will connect to the broker automatically within seconds. The connection status is shown as a colored dot (green = connected, red = error, grey = disconnected)."),

    h2("7.3 Payload Mapping Rules"),
    p("Mapping Rules allow you to rename fields in the MQTT payload before it is processed by the normalisation engine. This is useful when the device sends fields with different names than expected."),
    p("Example: If the MQTT payload contains { 'temp': 72.4 } but the asset's attribute expects 'temperature', a mapping rule renames 'temp' → 'temperature'."),
    p("To configure mapping rules, expand the broker card and click 'Edit Mapping Rules'. Each rule has a 'from' field name and a 'to' field name."),

    h2("7.4 Broker Connection History"),
    p("Each broker card has an expandable Connection History timeline. The timeline shows:"),
    ul([
      "Timestamp of each connection event",
      "Event status: connected, disconnected, or error",
      "Message — additional details about the event (e.g., error reason)",
    ]),
    p("Up to 500 events are stored per broker. This history is useful for diagnosing connectivity issues and tracking broker uptime."),

    h2("7.5 Data Destinations"),
    p("Data Destinations allow the platform to forward alarm and telemetry events to external systems via HTTP POST (webhook). A destination is a configured endpoint that receives a JSON payload whenever a subscribed event occurs."),

    h3("7.5.1 Creating a Destination"),
    ol([
      "Navigate to Integration Hub → Destinations.",
      "Click 'Add Destination'.",
      "Fill in the destination configuration:",
    ]),
    table(
      ["Field", "Description"],
      [
        ["Name", "Friendly name for this destination"],
        ["Description", "Optional description"],
        ["Endpoint URL", "The full HTTPS URL that will receive POST requests"],
        ["Auth Type", "Bearer Token, API Key, or Basic Auth"],
        ["Token / Key / Credentials", "Authentication credentials for the target endpoint"],
        ["API Key Header", "Header name for API Key auth (default: X-API-Key)"],
        ["Event Types", "Select which events trigger delivery: alarm events, telemetry events, or both"],
        ["Enabled", "Toggle to activate or deactivate this destination without deleting it"],
      ]
    ),

    h3("7.5.2 Authentication Methods"),
    table(
      ["Auth Type", "Header Sent", "Description"],
      [
        ["Bearer Token", "Authorization: Bearer <token>", "Sends the token as a standard Bearer auth header"],
        ["API Key", "<custom-header>: <key>", "Sends the key in a configurable header (default: X-API-Key)"],
        ["Basic Auth", "Authorization: Basic <b64(user:pass)>", "Standard HTTP Basic authentication"],
        ["None", "(no auth header)", "Destination accepts unauthenticated requests"],
      ]
    ),
    p("All requests from the platform include the signature header: X-Source: iot-platform, allowing the receiving system to identify the source."),

    h3("7.5.3 Event Types"),
    ul([
      "Alarm Events — A POST is sent whenever an alarm is triggered or cleared for any asset.",
      "Telemetry Events — A POST is sent for every telemetry ingest, containing the ingested metric values.",
    ]),
    note("Enabling telemetry events on high-frequency assets can generate a very large number of outbound requests. Consider using alarm events only, or using the ingest API directly from your integration system."),

    h2("7.6 Integration Hub"),
    p("The Integration Hub page provides a high-level status dashboard showing:"),
    ul([
      "Status of all configured brokers with connection indicator",
      "List of active data destinations",
      "API client list with last-used timestamp",
      "Quick link to the Ingest API endpoint",
      "Summary statistics for recent telemetry ingests",
    ]),

    h2("7.7 Device Integration Guide"),
    p("The Integration Guide page provides hands-on developer documentation for connecting devices to the platform. It includes:"),
    ul([
      "The ingest endpoint URL (auto-populated with the current platform address)",
      "3-step quick setup instructions",
      "All 4 supported payload format examples with copy-paste JSON",
      "deviceId → asset identifier binding explanation",
      "Python code example for automated ingest",
      "cURL examples for testing from terminal",
      "HTTP response format documentation",
      "All ingest endpoints reference table",
      "Authentication instructions",
      "Multi-gateway pattern (one asset per gateway)",
    ]),
    pb(),

    // ─── CHAPTER 8 ────────────────────────────────────────────────────────────
    h1("Chapter 8: Security — Users & API Clients"),
    h2("8.1 User Management"),
    p("User Management (Governance → User) provides a full CRUD interface for platform user accounts. Only Super Admins, Company Admins and Admins (the roles with manage_users) can create, edit, or delete users, and only users of a lower-ranked role: only a Super Admin can create or change a Company Admin, and a Company Admin can never change a Super Admin."),
    h3("8.1.1 User Fields"),
    table(
      ["Field", "Description"],
      [
        ["Full Name", "Display name shown in the interface and audit logs"],
        ["Username", "Unique login identifier (cannot be changed after creation)"],
        ["Email", "Contact email address"],
        ["Role", "One of the nine platform roles listed in Chapter 14"],
        ["Status", "Account status: Invited, Active, Suspended, or Inactive"],
        ["Last Login", "Timestamp of the most recent successful login"],
      ]
    ),

    h3("8.1.2 Creating a User"),
    ol([
      "Click 'Add User' (visible only to roles with manage_users).",
      "Enter Full Name, Username, Email and Role. You do not choose a password.",
      "Click Create. The account is created with status Invited and the user receives a single-use activation link to set their own password. The account cannot sign in until it is activated.",
    ]),

    h3("8.1.3 Editing a User"),
    ol([
      "Click the pencil (edit) icon next to the user row.",
      "Modify Full Name, Email, Role, and/or Status.",
      "Click Save Changes. Updates take effect immediately.",
    ]),
    note("Administrators never see or set a user's password. From the user row they can resend or revoke an invitation, send a password reset link, issue a temporary password that must be changed at next login, require a password change, unlock a locked account, and (Super Admin or Company Admin only) change the number of simultaneous sessions allowed."),

    h3("8.1.4 User Status"),
    table(
      ["Status", "Effect"],
      [
        ["Invited", "Account created but not yet activated; login is not possible until the user sets a password via the activation link"],
        ["Active", "User can log in and use the platform normally"],
        ["Suspended", "Login is blocked, typically temporarily"],
        ["Inactive", "Account exists but login is not permitted"],
        ["Suspended", "Account is suspended pending review; login blocked"],
      ]
    ),

    h2("8.2 API Clients"),
    p("API Clients (Security → API Client) are OAuth-style bearer tokens issued to external applications for programmatic access to the platform. Unlike user accounts, API clients do not have a login session — they authenticate every request using their bearer token in the Authorization header."),

    h3("8.2.1 Creating an API Client"),
    ol([
      "Click 'New Client' (requires the manage_api_clients permission: the three administrator roles, Engineer and Developer).",
      "Enter Name and optional Description.",
      "Select the access Scopes.",
      "Optionally set an expiry date (leave blank for no expiry).",
      "Optionally configure an IP Allowlist (one IP per line or comma-separated).",
      "Click Create. The clientId and clientSecret are displayed once — copy and store the secret securely.",
    ]),
    note("The client secret is shown only once at creation time. If lost, you must rotate the secret to generate a new one."),

    h3("8.2.2 Available Scopes"),
    table(
      ["Scope", "Permitted Operations"],
      [
        ["write:telemetry", "POST to /api/ingest/payload, /api/ingest/batch, /api/ingest/validate"],
        ["read:assets", "GET /api/export/assets — list assets with current attribute values"],
        ["read:telemetry", "GET /api/export/telemetry — query time-series telemetry data"],
        ["read:alarms", "GET /api/export/alarms — query active and historical alarms"],
        ["read:alarm-history", "GET /api/export/alarm-history — full alarm event history"],
      ]
    ),

    h3("8.2.3 Using the Bearer Token"),
    p("Include the API client token in every request using the Authorization header:"),
    code("http", "Authorization: Bearer <your-client-secret>"),
    p("The platform also accepts the token via the X-API-Key header for backward compatibility with systems that do not support standard Authorization headers."),

    h3("8.2.4 IP Allowlist"),
    p("Restrict which IP addresses can use a given API client by entering them in the IP Allowlist field. Leave blank to allow requests from any IP. When configured, requests from non-listed IPs are rejected with HTTP 403."),

    h3("8.2.5 Token Operations"),
    table(
      ["Operation", "Effect"],
      [
        ["View Token", "Click the eye icon to reveal the masked token in the row. Click again to hide."],
        ["Copy Token", "Click the copy icon to copy the token to clipboard."],
        ["Rotate Secret", "Generates a new client secret. The old secret is immediately invalidated. A new creation date is recorded."],
        ["Revoke", "Permanently marks the client as revoked. The token cannot be used for any further requests."],
        ["Restore", "Re-activates a revoked client (if supported by your admin)."],
      ]
    ),

    h3("8.2.6 Health Endpoint"),
    p("The platform exposes a public health check endpoint that requires no authentication:"),
    code("http", "GET /api/export/health"),
    p("This is suitable for use in uptime monitors (Grafana, Datadog, Zabbix, Pingdom). It returns HTTP 200 with a JSON body when the server is healthy."),
    pb(),

    // ─── CHAPTER 9 ────────────────────────────────────────────────────────────
    h1("Chapter 9: System Management"),
    h2("9.1 Data Management"),
    p("The Data Management page (System → Data Management) shows how much sensor data is stored, how fast it grows, how much disk space is left, and when old readings are deleted. A warning appears at the top while no retention policy exists, because readings are then never deleted."),
    p("It has six tabs: Overview (alerts, storage, growth, data per project and asset, summaries), Retention (policies, approvals, bad-data removal, legal holds, pruning history), Data health (quiet assets, gaps, busiest metrics, refused ingest requests), Archives & backups, Database (what uses the disk, monthly partitions, database health) and Settings (alert thresholds and webhook, pruning window, approval of large deletions, archiving, summary levels). The full guide is docs/features/data-management.md."),

    h3("9.1.1 Storage and growth"),
    ul([
      "Readings stored — an estimate from the database statistics, so it loads instantly on any table size.",
      "Size on disk — the telemetry table with its indexes. Space freed by pruning is reused; the file does not shrink.",
      "Oldest and newest reading.",
      "Readings per day and new data per month — averages over the last 7 complete days, with a bar chart of the last 30 days.",
      "Kept for ever, per month — readings that no policy covers. This is what keeps filling the disk.",
      "Free disk space — measured on the API server at STORAGE_DISK_PATH (default /), with an estimate of the days until the disk is full.",
    ]),

    h3("9.1.2 Data per asset"),
    p("A table lists every asset with its readings, estimated size, number of metrics, oldest and newest reading, and how long its readings are kept under the current policies. Search filters the list."),

    h3("9.1.3 Long-term summaries"),
    p("Every hour of readings is summarised per asset and metric (count, minimum, average, maximum). The counts on this page come from these summaries. Charts with 1-hour or longer steps use them for hours whose raw readings were deleted, so long-term trends survive a short retention. On first start the platform summarises existing data in the background; the page shows the progress. Pruning only deletes readings whose hour is already summarised."),

    h2("9.2 Data Retention Policies"),
    p("Retention policies automatically delete telemetry records older than a configured age. The platform evaluates all enabled policies hourly using a background job. A manual trigger is also available."),

    h3("9.2.1 Creating a Retention Policy"),
    ol([
      "Click 'Add policy' on the Data Management page.",
      "Enter a name.",
      "Set how many days to keep readings, or pick 30 d, 90 d, 180 d, 1 yr or 2 yr.",
      "Optionally choose an Asset from the list (All assets by default).",
      "Optionally choose a Metric; with an asset chosen, its metrics are listed.",
      "Check the estimate: the dialog shows how many readings the next pruning run would delete.",
      "Click Save policy.",
    ]),

    h3("9.2.2 Policy Evaluation"),
    p("Each hourly evaluation cycle runs all enabled policies and deletes matching rows. After each run:"),
    ul([
      "The rowsPruned counter accumulates the total number of rows deleted across all runs.",
      "The lastPrunedAt timestamp is updated.",
    ]),

    h3("9.2.3 Manual Pruning"),
    p("Click 'Run pruning now' to apply the policies immediately instead of waiting for the hourly run. A confirmation shows how many readings will be deleted; deletion cannot be undone. Deleting a policy also asks for confirmation and shows the effect."),

    h3("9.2.4 Pruning history and other records"),
    p("The Pruning history lists every hourly and manual run with the readings and other records it deleted and whether it succeeded. Other records (cleared alarms, alarm history, activity log, broker events, sign-in links, summaries, pruning history) are deleted by age; their periods are shown on the page and set in the server's .env file."),

    h2("9.3 Reports"),
    p("The Reports page (System → Reports) enables on-demand generation of structured reports from the platform's data. Three report types are available."),

    h3("9.3.1 Telemetry Summary Report"),
    p("Aggregated statistics (min, avg, max) per metric, grouped by time bucket over a selected time window. Configuration options:"),
    ul([
      "Asset — filter to a specific asset or include all assets.",
      "Metric — filter to a specific metric key or include all metrics.",
      "Time Bucket — aggregation interval: 5m, 15m, 30m, 1h, 6h, 12h, 1d, 1w.",
      "Date Range — from and to datetime (ISO format), with quick range buttons: Last 1h, Last 24h, Last 7d, Last 30d.",
    ]),

    h3("9.3.2 Alarm Report"),
    p("All alarm events (active and cleared) within a selected date range. Supports filtering by severity (Critical, High, Medium, Low, All). Fields in the report:"),
    ul([
      "Alarm name, asset name, severity, status",
      "Alarm class (threshold, rate_of_change, etc.)",
      "Trigger value, triggered-at timestamp, acknowledged-at, cleared-at",
      "Rule message",
    ]),

    h3("9.3.3 Asset Status Snapshot"),
    p("A point-in-time snapshot of every asset in the system, including:"),
    ul([
      "Asset name, type, identifier",
      "Maintenance mode status (active/inactive) and note",
      "Health status (ok / alarm / stale)",
      "Number of attributes",
      "List of attribute tag names",
    ]),

    h3("9.3.4 Export Formats"),
    p("Reports can be downloaded in two formats:"),
    ul([
      "CSV — comma-separated, importable into Excel, Google Sheets, or any BI tool.",
      "JSON — structured JSON array, suitable for programmatic processing or API integration.",
    ]),
    pb(),

    // ─── CHAPTER 10 ───────────────────────────────────────────────────────────
    h1("Chapter 10: Visualization Dashboards"),
    h2("10.1 Overview"),
    p("The Visualization page (/visualization) provides a full-featured industrial dark-theme dashboard builder. Dashboards are named, persisted in the database, and support role-based access control. Multiple dashboards can be created and switched using the dashboard selector dropdown."),

    h2("10.2 Dashboard Management"),
    h3("Creating a Dashboard"),
    ol([
      "Click 'New Dashboard' in the top bar.",
      "Enter a name and optionally configure role access (which user roles can see this dashboard).",
      "Click Create. The new dashboard appears in the selector dropdown.",
    ]),
    h3("Editing a Dashboard"),
    p("Click the edit (pencil) icon next to the dashboard name to rename it, change role access, or modify the widget layout."),
    h3("Cloning a Dashboard"),
    p("Click Clone to create a copy of the current dashboard with all widgets and configuration preserved."),
    h3("Deleting a Dashboard"),
    p("Click Delete to permanently remove the dashboard and all its widgets."),

    h2("10.3 Widget Types"),
    table(
      ["Widget Type", "Description"],
      [
        ["Line Chart", "Continuous time-series line plot. Best for sensor readings over time."],
        ["Area Chart", "Filled area under a line. Good for cumulative values and trends."],
        ["Bar Chart", "Vertical bars per time bucket. Good for discrete or aggregated values."],
        ["Stacked Bar", "Multiple series stacked vertically. Compare component contributions."],
        ["Gauge", "Circular dial with configurable min/max. For point-in-time percentage or level values."],
        ["Pie Chart", "Proportional slices. For comparing shares of a total."],
        ["Donut Chart", "Like Pie but with a center hole for displaying a value."],
        ["KPI Card", "Large number display with trend arrow. For critical single-metric KPIs."],
        ["Heatmap", "Color grid showing intensity over time. Useful for pattern detection."],
        ["Table", "Tabular data view with sortable columns. For detailed metric logs."],
        ["Scatter Plot", "X/Y scatter for correlation analysis between two metrics."],
      ]
    ),

    h2("10.4 Adding a Widget"),
    ol([
      "Click 'Add Widget' on the dashboard.",
      "In the widget dialog, select Widget Type from the dropdown.",
      "Select the Asset from the asset tree panel.",
      "Select the primary Metric to display.",
      "Optionally add up to 4 additional metrics for multi-metric overlay.",
      "Set title, color scheme, and chart-specific options (min/max for gauges, etc.).",
      "Click Save. The widget appears in the dashboard grid.",
    ]),

    h2("10.5 Multi-Metric Overlay"),
    p("Line, Area, Bar, and StackedBar charts support overlaying up to 4 additional metric series. Each additional series can come from the same asset (different metrics) or a different asset entirely. This enables rich comparative views such as power consumption vs. production output on the same chart."),

    h2("10.6 Global Time Range"),
    p("The global time range dropdown applies to all widgets on the dashboard simultaneously. Available presets:"),
    ul([
      "Last 15 minutes", "Last 30 minutes", "Last 1 hour", "Last 3 hours",
      "Last 6 hours", "Last 12 hours", "Last 24 hours", "Last 48 hours",
      "Last 7 days", "Last 14 days", "Last 30 days",
    ]),
    p("Changing the global time range immediately refreshes all widget data."),

    h2("10.7 Real-Time WebSocket Updates"),
    p("The Visualization dashboard is connected to the platform WebSocket server. When a new telemetry payload is ingested for an asset that has widgets on the current dashboard, those widgets automatically refetch their data without manual refresh. An animated green '● LIVE' badge appears on each widget that has received a real-time update."),

    h2("10.8 Auto-Refresh & Fullscreen"),
    ul([
      "Auto-Refresh: All widget data is automatically refreshed every 30 seconds.",
      "Fullscreen: Each widget has a fullscreen button. Clicking it expands the widget to fill the viewport, useful for control room displays.",
      "Per-Widget Refresh: Each widget also has a manual refresh button for on-demand data update.",
    ]),
    pb(),

    // ─── CHAPTER 11 ───────────────────────────────────────────────────────────
    h1("Chapter 11: Live Telemetry Monitor"),
    h2("11.1 Overview"),
    p("The Live Feed page (/live) provides a real-time monitoring view powered by the WebSocket server. It shows telemetry as it arrives, without polling. This is the primary tool for watching data flow in real-time during commissioning or troubleshooting."),

    h2("11.2 Connection Status"),
    p("The top status bar shows the WebSocket connection state:"),
    table(
      ["State", "Color", "Meaning"],
      [
        ["Connected", "Green", "WebSocket is active and receiving events"],
        ["Connecting", "Amber", "Attempting to establish connection (retry in progress)"],
        ["Disconnected", "Red", "Connection lost — check network or server status"],
      ]
    ),

    h2("11.3 Statistics Bar"),
    p("Below the connection status, live statistics are displayed:"),
    ul([
      "Events/min — rate of incoming telemetry events per minute",
      "Live Assets — number of distinct assets that have sent data in the current session",
      "Total Received — cumulative count of telemetry events received since page load",
      "Metrics Tracked — total number of distinct metric keys seen across all assets",
    ]),

    h2("11.4 Per-Asset Metric Tiles"),
    p("The left panel shows one tile per asset that has sent data in the current session. Each tile includes:"),
    ul([
      "Asset name",
      "Each metric seen from this asset with its current value",
      "Flash animation when a new value arrives (value briefly highlights in blue)",
      "Stale indicator — if no data has been received for 30 seconds, the tile shows a 'STALE' badge",
      "Trend indicators — up arrow (↑) if the value increased, down arrow (↓) if it decreased, dash (—) if stable",
    ]),
    p("Asset tiles auto-expand when new data arrives for an asset not previously seen in the session."),

    h2("11.5 Event Log"),
    p("The right panel shows a scrollable event log of up to 200 recent events. Each log entry shows:"),
    ul([
      "Timestamp",
      "Asset name",
      "Expandable row — click to see all metric values in the payload",
    ]),
    p("The 200-event buffer is a rolling window — the oldest events are dropped as new ones arrive. Click 'Clear Log' to reset the event log without disconnecting the WebSocket."),

    h2("11.6 Asset Filter"),
    p("A filter input at the top allows you to show only events from a specific asset by name. Type part of an asset name to filter both the event log and metric tiles."),
    pb(),

    // ─── CHAPTER 12 ───────────────────────────────────────────────────────────
    h1("Chapter 12: Audit Log"),
    h2("12.1 Overview"),
    p("The Audit Log (/activity-log) is an immutable audit trail recording every significant action taken on the platform. It cannot be edited or deleted. It is the authoritative record for compliance, security auditing, and change management."),

    h2("12.2 Logged Actions"),
    table(
      ["Action", "Category", "Description"],
      [
        ["alarm.acknowledged", "alarm", "Operator acknowledged an active alarm"],
        ["asset.created", "asset", "New asset added to the hierarchy"],
        ["asset.deleted", "asset", "Asset removed from the hierarchy"],
        ["user.created", "user", "New user account created"],
        ["user.deleted", "user", "User account deleted"],
        ["broker.created", "broker", "New broker connection added"],
        ["broker.deleted", "broker", "Broker connection removed"],
        ["api_client.created", "api_client", "New API client credential created"],
        ["api_client.deleted", "api_client", "API client credential deleted"],
        ["destination.created", "destination", "New data destination added"],
        ["destination.deleted", "destination", "Data destination removed"],
      ]
    ),

    h2("12.3 Log Entry Fields"),
    table(
      ["Field", "Description"],
      [
        ["Timestamp", "When the action occurred (UTC)"],
        ["Action", "Machine-readable action identifier (e.g., alarm.acknowledged)"],
        ["Category", "Functional category (alarm, asset, user, broker, api_client, destination)"],
        ["Actor Name", "Full name of the user who performed the action"],
        ["Actor Role", "Role of the actor at the time of the action"],
        ["Actor Username", "Username of the actor"],
        ["Target ID", "UUID of the affected entity"],
        ["Target Name", "Display name of the affected entity"],
        ["Detail", "Additional context (e.g., role=engineer, severity=high)"],
      ]
    ),

    h2("12.4 Filtering & Search"),
    ul([
      "Category filter — show only events in a specific category",
      "Free-text search — filters by actor name, actor username, target name, or action string",
      "Pagination — 25 records per page, navigable with prev/next controls",
      "Auto-refresh — the log refreshes every 30 seconds to show new events",
    ]),
    pb(),

    // ─── CHAPTER 13 ───────────────────────────────────────────────────────────
    h1("Chapter 13: Payload Simulator (switched off by default)"),
    h2("13.1 Overview"),
    note("The Payload Simulator is switched off in standard builds: it does not appear in the sidebar and its URL shows Not Found. An administrator enables it by building the frontend with VITE_ENABLE_PAYLOAD_SIMULATOR=true. The rest of this chapter applies only when it is on."),
    p("The Payload Simulator (/simulator) is a browser-based tool for sending test telemetry payloads to the platform without physical hardware. It is essential for testing alarm rules, validating attribute mappings, and demonstrating the platform to stakeholders."),

    h2("13.2 Device Presets Tab"),
    p("The Device Presets tab provides hardcoded payload templates for common industrial device types:"),
    ul([
      "Sensorgrow — a multi-sensor environmental monitoring device",
      "RF-Dryer — a radio-frequency industrial drying system with temperature, humidity, and power metrics",
    ]),
    p("Select a preset and click Send to dispatch a payload with the preset values. The response is shown in the request log below."),

    h2("13.3 Custom Asset Tab"),
    p("The Custom Asset tab enables fully configurable payload simulation against any asset in the system:"),
    ol([
      "Select an Asset from the dropdown — the platform fetches all dynamic/metric attributes for that asset.",
      "Each attribute appears as a metric row with its name, min/max range, and a value slider.",
      "Adjust the sliders to set the desired metric values for the test payload.",
      "Click 'Send Once' to dispatch a single payload immediately.",
      "Or enable 'Auto-Send' with a configurable interval (seconds) and optional jitter (random ±variation) — the simulator sends payloads repeatedly at the specified rate.",
    ]),

    h2("13.4 Live Trend Chart"),
    p("As payloads are sent, the simulator displays a live trend chart showing the last N values for each metric. This allows you to visually verify that the slider values are resulting in expected trends."),

    h2("13.5 Request Log"),
    p("Every payload sent is logged in the Request Log table at the bottom:"),
    ul([
      "Timestamp of the request",
      "HTTP status code (200 = success, 422 = device ID mismatch, 400 = malformed JSON)",
      "Response time in milliseconds",
      "Records written to the database",
      "Number of alarms triggered",
      "Number of alarms cleared",
      "Full response body (expandable)",
    ]),
    pb(),

    // ─── CHAPTER 14 ───────────────────────────────────────────────────────────
    h1("Chapter 14: Role-Based Access Control"),
    h2("14.1 Overview"),
    p("The platform implements Role-Based Access Control (RBAC) with nine built-in roles. The API server is the control: it refuses any request your role does not allow and records the refusal. The UI mirrors the same rules, so controls you cannot use are grayed out or hidden."),
    p("Roles: Super Admin, Company Admin, Admin, Project Manager, Team Lead, Developer, Engineer, Operator, Viewer. Super Admin, Company Admin and Admin hold every permission; they differ in rank (who may administer whom). Developer has the same rights as Engineer, but only on assigned projects. Project Manager and Team Lead are read-and-acknowledge roles that differ in which projects they see."),

    h2("14.2 Role Permission Matrix"),
    table(
      ["Permission", "Super Admin / Company Admin / Admin", "Engineer / Developer", "Project Manager / Team Lead", "Operator", "Viewer"],
      [
        ["view (read pages your modules allow)", "✓", "✓", "✓", "✓", "✓"],
        ["manage_assets (create, edit, delete assets & attributes)", "✓", "✓", "✗", "✗", "✗"],
        ["manage_templates (create, delete asset templates)", "✓", "✓", "✗", "✗", "✗"],
        ["manage_alarms (create, edit, delete alarm rules)", "✓", "✓", "✗", "✗", "✗"],
        ["acknowledge_alarms (acknowledge active alarms)", "✓", "✓", "✓", "✓", "✗"],
        ["manage_users (create, edit, delete users)", "✓", "✗", "✗", "✗", "✗"],
        ["manage_brokers (create, edit, delete brokers)", "✓", "✓", "✗", "✗", "✗"],
        ["manage_destinations (create, edit, delete destinations)", "✓", "✓", "✗", "✗", "✗"],
        ["manage_api_clients (create, rotate, revoke API clients)", "✓", "✓", "✗", "✗", "✗"],
        ["manage_security (Security Center, sessions, security events)", "✓", "✗", "✗", "✗", "✗"],
        ["approve_data_changes (approve or reject Data Management deletions, release legal holds, change Data Management settings, delete retention policies)", "✓", "✗", "✗", "✗", "✗"],
      ]
    ),
    p("Projects: Project Managers see every project; Team Leads and Developers see only the projects assigned to them; all other roles follow a per-user project setting. Administrators can also override module access per user (User → Access)."),

    h2("14.3 ReadOnly Banner"),
    p("On pages where the active role cannot perform write actions, an amber ReadOnly Banner is displayed at the top of the page explaining the limitation. For example, on the Alarm Rule page, a Viewer sees: 'Read-only — Viewers cannot create or modify alarm rules.'"),

    h2("14.4 RoleGuard"),
    p("The platform uses a RoleGuard component that wraps UI elements:"),
    ul([
      "mode='hide' — the element is completely removed from the DOM if the user lacks the required permission.",
      "mode='disable' — the element is rendered but grayed out and non-interactive.",
    ]),

    h2("14.5 Audit Identity"),
    p("The API server takes your identity from your session cookie (or, for machine clients, from the API key) and writes it to the Audit Log. The server removes or overwrites any X-Actor-* headers a client sends, so the browser cannot claim to be someone else."),
    pb(),

    // ═══════════════════════════════════════════════════════════════════════════
    //  PART II — TECHNICAL DOCUMENTATION
    // ═══════════════════════════════════════════════════════════════════════════
    h1("PART II — TECHNICAL DOCUMENTATION"),
    pb(),

    // ─── CHAPTER 15 ───────────────────────────────────────────────────────────
    h1("Chapter 15: Architecture Overview"),
    h2("15.1 Monorepo Structure"),
    p("WS-Integrated Suite is built as a pnpm workspace monorepo. The repository is organized as follows:"),
    code("text", `workspace root/
├── artifacts/
│   ├── api-server/          Express 5 REST + WebSocket API (port 8080, path /api)
│   └── iot-platform/        React 18 + Vite 7 SPA (auto-assigned port, path /)
├── lib/
│   ├── api-spec/            OpenAPI 3.1 specification + Orval codegen config
│   ├── api-client-react/    Generated React Query hooks + typed fetch client
│   ├── api-zod/             Generated Zod validation schemas
│   └── db/                  Drizzle ORM schema + PostgreSQL migrations
├── scripts/                 Utility scripts (seeding, pruning, migrations)
├── pnpm-workspace.yaml      Workspace package discovery and catalog pins
└── tsconfig.json            Solution-level TypeScript config for composite libs`),

    h2("15.2 Technology Stack"),
    table(
      ["Layer", "Technology", "Version", "Purpose"],
      [
        ["Frontend Framework", "React", "18.x", "UI component model"],
        ["Frontend Build", "Vite", "7.x", "Fast development server + production bundler"],
        ["UI Components", "shadcn/ui + Tailwind CSS", "Latest", "Design system and styling"],
        ["State / Data Fetching", "TanStack React Query", "5.x", "Server state management and caching"],
        ["Charts", "Recharts", "2.x", "Data visualization components"],
        ["Forms", "React Hook Form + Zod", "7.x / 3.x", "Form state and schema validation"],
        ["Routing", "Wouter", "3.x", "Lightweight client-side routing"],
        ["Backend Framework", "Express", "5.x", "REST API server"],
        ["ORM", "Drizzle ORM", "Latest", "Type-safe PostgreSQL queries"],
        ["Database", "PostgreSQL", "14+", "Primary data store"],
        ["WebSocket", "ws (Node.js)", "8.x", "Real-time event broadcasting"],
        ["MQTT Client", "mqtt.js", "5.x", "MQTT broker subscriber"],
        ["Schema Validation", "Zod", "3.x", "Input validation on API server"],
        ["API Codegen", "Orval", "7.x", "Generates React Query hooks from OpenAPI spec"],
        ["Language", "TypeScript", "5.x", "End-to-end type safety"],
      ]
    ),

    h2("15.3 Proxy & Service Routing"),
    p("A global reverse proxy routes traffic by path prefix:"),
    table(
      ["Path", "Service", "Port"],
      [
        ["/api/*", "API Server (Express)", "8080"],
        ["/*", "Frontend (Vite SPA)", "auto-assigned"],
      ]
    ),
    p("The proxy uses path-based routing with mTLS. All client access goes through the proxy — services are never accessed directly by clients. Paths are not rewritten by the proxy; each service handles its full base path."),

    h2("15.4 API Contract (OpenAPI + Codegen)"),
    p("The API contract is defined as an OpenAPI 3.1 specification in lib/api-spec/. Orval reads this spec and generates:"),
    ul([
      "Typed React Query hooks in lib/api-client-react/ (e.g., useListAssets, useCreateUser)",
      "Typed fetch functions with request/response types",
      "Zod validation schemas in lib/api-zod/ for server-side input validation",
    ]),
    p("To regenerate after changing the spec:"),
    code("bash", "cd lib/api-spec && pnpm exec orval --config ./orval.config.ts"),

    h2("15.5 Background Services"),
    p("The API server starts two background services at startup:"),
    ul([
      "MQTT Subscriber Service (src/services/mqtt.ts) — Reads all brokers with type='mqtt' from the database, connects to each, subscribes to configured topics, applies mapping rules, and feeds payloads through the normalisation pipeline. Broadcasts broker_status WebSocket events and writes broker_events rows on connect/disconnect/error.",
      "Hourly Retention Job — A setInterval(runPruning, 3600000) in src/index.ts that evaluates all enabled data retention policies every hour and deletes matching expired telemetry rows.",
    ]),
    pb(),

    // ─── CHAPTER 16 ───────────────────────────────────────────────────────────
    h1("Chapter 16: Database Schema Reference"),
    h2("16.1 Overview"),
    p("The platform uses PostgreSQL as its primary database. All schema is managed via Drizzle ORM and versioned migrations. The main tables are:"),

    h2("16.2 assets"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["name", "TEXT NOT NULL", "Display name of the asset"],
        ["identifier", "TEXT UNIQUE", "Device identifier matched against deviceId in payloads"],
        ["description", "TEXT", "Optional description"],
        ["type", "TEXT", "Asset type (e.g., chiller, pump, meter)"],
        ["parentId", "UUID (FK → assets.id)", "Self-referencing parent for hierarchy"],
        ["maintenanceMode", "BOOLEAN DEFAULT false", "When true, alarm rules are suppressed"],
        ["maintenanceSince", "TIMESTAMP", "Start timestamp of current maintenance period"],
        ["maintenanceNote", "TEXT", "Optional note describing maintenance reason"],
        ["createdAt", "TIMESTAMP", "Record creation timestamp"],
        ["updatedAt", "TIMESTAMP", "Last modification timestamp"],
      ]
    ),

    h2("16.3 attributes"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["assetId", "UUID (FK → assets.id)", "Owning asset"],
        ["name", "TEXT NOT NULL", "Display name"],
        ["tagName", "TEXT", "Short identifier used in expressions"],
        ["type", "ENUM", "static | dynamic | metric | runtime"],
        ["sourceMetric", "TEXT", "Metric key from telemetry that updates this attribute"],
        ["value", "TEXT", "Current value (stored as text, type-coerced in app)"],
        ["uom", "TEXT", "Unit of measure (e.g., kWh, °C, bar)"],
        ["decimalPlaces", "INTEGER DEFAULT 2", "Display decimal precision"],
        ["thousandSeparator", "BOOLEAN DEFAULT false", "Show thousand separator in formatted value"],
        ["quality", "ENUM DEFAULT 'good'", "good | bad | uncertain"],
        ["timestamp", "TIMESTAMP", "Last update time"],
        ["expression", "TEXT", "Math expression for runtime attributes"],
      ]
    ),

    h2("16.4 asset_templates"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["name", "TEXT NOT NULL", "Template name"],
        ["description", "TEXT", "Optional description"],
        ["attributes", "JSONB", "Array of attribute definitions (same shape as attributes table)"],
        ["createdAt", "TIMESTAMP", "Creation timestamp"],
      ]
    ),

    h2("16.5 telemetry"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["assetId", "UUID (FK → assets.id)", "Asset that owns this reading"],
        ["deviceId", "TEXT", "Device identifier from the payload"],
        ["metric", "TEXT NOT NULL", "Metric key (e.g., chiller.energy_kWh)"],
        ["value", "DOUBLE PRECISION NOT NULL", "Numeric sensor value"],
        ["quality", "TEXT DEFAULT 'good'", "Data quality: good | bad | uncertain"],
        ["timestamp", "TIMESTAMP NOT NULL", "Measurement timestamp from payload (or server time)"],
      ]
    ),
    p("Composite indexes on telemetry for query performance:"),
    ul([
      "idx_telemetry_asset_metric_ts (asset_id, metric, timestamp) — primary query path",
      "idx_telemetry_ts (timestamp) — for global time-range queries",
      "idx_telemetry_asset_ts (asset_id, timestamp) — for per-asset recent data",
    ]),

    h2("16.6 viz_dashboards"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["name", "TEXT NOT NULL", "Dashboard display name"],
        ["roleFilter", "TEXT[]", "Array of roles that can see this dashboard"],
        ["assetFilter", "TEXT[]", "Optional array of asset IDs to scope this dashboard"],
        ["widgets", "JSONB NOT NULL", "Array of widget configuration objects"],
        ["createdAt", "TIMESTAMP", "Creation timestamp"],
        ["updatedAt", "TIMESTAMP", "Last modification timestamp"],
      ]
    ),

    h2("16.7 alarms"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["name", "TEXT NOT NULL", "Alarm name (from rule)"],
        ["assetId", "UUID (FK → assets.id)", "Asset that owns the alarm"],
        ["assetName", "TEXT", "Denormalized asset name for display"],
        ["ruleId", "UUID (FK → alarm_rules.id)", "The rule that triggered this alarm"],
        ["severity", "ENUM", "critical | high | medium | low"],
        ["status", "ENUM", "active | acknowledged | cleared"],
        ["alarmClass", "TEXT", "threshold | rate_of_change | heartbeat | deviation"],
        ["message", "TEXT", "Human-readable alarm message"],
        ["triggerValue", "DOUBLE PRECISION", "The metric value that triggered the alarm"],
        ["triggeredAt", "TIMESTAMP", "Alarm creation timestamp"],
        ["acknowledgedAt", "TIMESTAMP", "Acknowledgement timestamp (nullable)"],
        ["clearedAt", "TIMESTAMP", "Clear timestamp (nullable)"],
      ]
    ),

    h2("16.8 alarm_history"),
    p("Identical schema to alarms table. When an alarm is cleared, it is moved to alarm_history for the immutable historical record."),

    h2("16.9 alarm_rules"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["name", "TEXT NOT NULL", "Rule display name"],
        ["assetId", "UUID (FK → assets.id)", "Asset this rule monitors"],
        ["metric", "TEXT NOT NULL", "Metric key to monitor"],
        ["condition", "TEXT NOT NULL", "Condition operator (gt, lt, gte, lte, eq, neq)"],
        ["threshold", "DOUBLE PRECISION NOT NULL", "Threshold value"],
        ["severity", "ENUM", "critical | high | medium | low"],
        ["alarmClass", "TEXT", "threshold | rate_of_change | heartbeat | deviation"],
        ["enabled", "BOOLEAN DEFAULT true", "Whether this rule is active"],
        ["webhookUrl", "TEXT", "Optional webhook URL for this rule"],
        ["webhookEnabled", "BOOLEAN DEFAULT false", "Whether the webhook is active"],
        ["rocWindow", "INTEGER DEFAULT 60", "Rate-of-change evaluation window in seconds"],
      ]
    ),

    h2("16.10 users"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["username", "TEXT UNIQUE NOT NULL", "Login identifier"],
        ["email", "TEXT", "Contact email"],
        ["fullName", "TEXT NOT NULL", "Display name"],
        ["role", "TEXT", "super_admin | company_admin | admin | project_manager | team_lead | developer | engineer | operator | viewer (unknown values are treated as viewer)"],
        ["status", "ENUM DEFAULT 'active'", "active | inactive | suspended"],
        ["passwordHash", "TEXT NOT NULL", "Hashed password (bcrypt)"],
        ["lastLogin", "TIMESTAMP", "Most recent successful login"],
        ["createdAt", "TIMESTAMP", "Account creation timestamp"],
      ]
    ),

    h2("16.11 brokers"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["name", "TEXT NOT NULL", "Broker display name"],
        ["type", "ENUM", "mqtt | rest | azure_iot"],
        ["host", "TEXT", "Broker hostname or IP"],
        ["port", "INTEGER", "Connection port"],
        ["status", "ENUM DEFAULT 'disconnected'", "connected | disconnected | error"],
        ["mqttClientId", "TEXT", "MQTT client identifier"],
        ["mqttUsername", "TEXT", "MQTT authentication username"],
        ["mqttPassword", "TEXT", "MQTT authentication password"],
        ["mqttTopic", "TEXT", "MQTT topic subscription pattern"],
        ["mappingRules", "JSONB DEFAULT '[]'", "Array of {from, to} field rename rules"],
        ["createdAt", "TIMESTAMP", "Creation timestamp"],
      ]
    ),

    h2("16.12 broker_events"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["brokerId", "UUID (FK → brokers.id)", "The broker this event belongs to"],
        ["brokerName", "TEXT", "Denormalized broker name"],
        ["status", "ENUM", "connected | disconnected | error"],
        ["message", "TEXT", "Additional event details"],
        ["timestamp", "TIMESTAMP NOT NULL", "Event timestamp"],
      ]
    ),

    h2("16.13 api_clients"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["name", "TEXT NOT NULL", "Client display name"],
        ["description", "TEXT", "Optional description"],
        ["clientId", "UUID", "OAuth client ID (auto-generated)"],
        ["clientSecret", "UUID", "Bearer token / client secret (auto-generated)"],
        ["scopes", "TEXT[]", "Array of scope strings (write:telemetry, read:assets, etc.)"],
        ["status", "ENUM DEFAULT 'active'", "active | inactive | revoked"],
        ["allowedIps", "TEXT[]", "IP allowlist (empty = any IP permitted)"],
        ["expiresAt", "TIMESTAMP", "Token expiry (null = no expiry)"],
        ["secretRotatedAt", "TIMESTAMP", "Last secret rotation timestamp"],
        ["totalRequests", "INTEGER DEFAULT 0", "Cumulative request count"],
        ["lastUsedAt", "TIMESTAMP", "Most recent authenticated request"],
        ["createdAt", "TIMESTAMP", "Creation timestamp"],
      ]
    ),

    h2("16.14 destinations"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["name", "TEXT NOT NULL", "Destination display name"],
        ["description", "TEXT", "Optional description"],
        ["endpoint", "TEXT NOT NULL", "Target URL for HTTP POST"],
        ["authType", "ENUM", "bearer | apikey | basic | none"],
        ["token", "TEXT", "Bearer token value"],
        ["secretKey", "TEXT", "API key value"],
        ["apiKeyHeader", "TEXT DEFAULT 'X-API-Key'", "Header name for API key auth"],
        ["basicUser", "TEXT", "Basic auth username"],
        ["basicPass", "TEXT", "Basic auth password"],
        ["eventTypes", "TEXT[]", "Subscribed event types (alarm, telemetry)"],
        ["enabled", "BOOLEAN DEFAULT true", "Active/inactive toggle"],
        ["createdAt", "TIMESTAMP", "Creation timestamp"],
      ]
    ),

    h2("16.15 activity_logs"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["action", "TEXT NOT NULL", "Action identifier (e.g., alarm.acknowledged)"],
        ["category", "TEXT NOT NULL", "Functional category"],
        ["actorName", "TEXT", "Display name of the acting user"],
        ["actorRole", "TEXT", "Role of the acting user"],
        ["actorUsername", "TEXT", "Username of the acting user"],
        ["targetId", "TEXT", "UUID of the affected entity"],
        ["targetName", "TEXT", "Display name of the affected entity"],
        ["detail", "TEXT", "Additional context details"],
        ["timestamp", "TIMESTAMP NOT NULL", "Action timestamp"],
      ]
    ),

    h2("16.16 data_retention_policies"),
    table(
      ["Column", "Type", "Description"],
      [
        ["id", "UUID (PK)", "Primary key"],
        ["name", "TEXT NOT NULL", "Policy display name"],
        ["assetId", "UUID (nullable)", "Restrict to a specific asset (null = all assets)"],
        ["metric", "TEXT (nullable)", "Restrict to a specific metric (null = all metrics)"],
        ["retentionDays", "INTEGER NOT NULL", "Delete telemetry older than this many days"],
        ["enabled", "BOOLEAN DEFAULT true", "Policy active toggle"],
        ["lastPrunedAt", "TIMESTAMP", "Timestamp of last pruning run"],
        ["rowsPruned", "INTEGER DEFAULT 0", "Total rows deleted across all runs"],
      ]
    ),
    pb(),

    // ─── CHAPTER 17 ───────────────────────────────────────────────────────────
    h1("Chapter 17: REST API Reference"),
    h2("17.1 Base URL"),
    p("All API endpoints are prefixed with /api. In production, the full URL is:"),
    code("text", "https://<platform-domain>/api/<endpoint>"),

    h2("17.2 Authentication"),
    p("Two authentication mechanisms are supported:"),
    ul([
      "API key (API Client) — Send the client secret as Authorization: Bearer <secret> or X-API-Key: <secret>. Used by gateways for /api/ingest/* and by integrations for /api/export/*.",
      "Session — HttpOnly session cookie for browser access, created at login. Write requests (POST, PUT, PATCH, DELETE) made with the cookie must also send the x-csrf-token header.",
    ]),

    h2("17.3 Asset Endpoints"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET", "/api/assets", "List all assets in the hierarchy"],
        ["POST", "/api/assets", "Create a new asset (body: name, identifier, description, type, parentId)"],
        ["GET", "/api/assets/:id", "Get a single asset by ID"],
        ["PUT", "/api/assets/:id", "Update an asset (body: name, identifier, description, type, parentId)"],
        ["DELETE", "/api/assets/:id", "Delete an asset (cascades to attributes and telemetry)"],
        ["GET", "/api/assets/:id/health", "Get asset health score (freshnessPct, activeAlarms, lastSeen, keyMetrics)"],
        ["POST", "/api/assets/:id/maintenance", "Toggle maintenance mode (body: { enabled: boolean, note?: string })"],
        ["POST", "/api/assets/:id/apply-template", "Apply a template to an asset (body: { templateId: string })"],
      ]
    ),

    h2("17.4 Attribute Endpoints"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET", "/api/assets/:id/attributes", "List all attributes for an asset"],
        ["POST", "/api/assets/:id/attributes", "Add a single attribute to an asset"],
        ["POST", "/api/assets/:id/attributes/bulk", "Bulk import attributes from CSV or JSON"],
        ["GET", "/api/attributes/:id", "Get a single attribute"],
        ["PUT", "/api/attributes/:id", "Update an attribute (value, expression, UoM, etc.)"],
        ["DELETE", "/api/attributes/:id", "Delete an attribute"],
      ]
    ),

    h2("17.5 Template Endpoints"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET", "/api/asset-templates", "List all asset templates"],
        ["POST", "/api/asset-templates", "Create a template (body: { name, description, attributes[] })"],
        ["DELETE", "/api/asset-templates/:id", "Delete a template"],
      ]
    ),

    h2("17.6 Telemetry Endpoints"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET", "/api/telemetry/:assetId", "Query telemetry (params: metric, from, to, limit)"],
        ["GET", "/api/telemetry/:assetId/metrics", "Get distinct metric keys for an asset"],
        ["GET", "/api/telemetry/:assetId/export", "Export telemetry as CSV (params: metric, from, to)"],
      ]
    ),

    h2("17.7 Ingest Endpoints"),
    table(
      ["Method", "Path", "Auth Required", "Description"],
      [
        ["POST", "/api/ingest/payload", "Optional (write:telemetry)", "Ingest a single telemetry payload"],
        ["POST", "/api/ingest/batch", "Optional (write:telemetry)", "Ingest an array of up to 500 payloads"],
        ["POST", "/api/ingest/validate", "Optional", "Dry-run: validate payload without writing to DB"],
      ]
    ),

    h2("17.8 Alarm Endpoints"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET", "/api/alarms", "List alarms (params: severity, status, limit)"],
        ["POST", "/api/alarms/:id/acknowledge", "Acknowledge an alarm"],
        ["GET", "/api/alarm-history", "Paginated alarm history (params: severity, status, from, to, limit, offset)"],
        ["GET", "/api/alarm-rules", "List all alarm rules"],
        ["POST", "/api/alarm-rules", "Create an alarm rule"],
        ["PUT", "/api/alarm-rules/:id", "Update an alarm rule"],
        ["DELETE", "/api/alarm-rules/:id", "Delete an alarm rule"],
        ["POST", "/api/alarm-rules/:id/test-webhook", "Fire a test webhook POST for this rule"],
      ]
    ),

    h2("17.9 User Endpoints"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET", "/api/users", "List all users"],
        ["POST", "/api/users", "Invite a user (body: username, email, fullName, role). No password: the account is created as invited and an activation link is sent"],
        ["GET", "/api/users/:id", "Get a single user"],
        ["PUT", "/api/users/:id", "Update user (body: fullName?, email?, role?, status?)"],
        ["DELETE", "/api/users/:id", "Delete a user"],
      ]
    ),

    h2("17.10 Broker Endpoints"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET", "/api/brokers", "List all broker configurations"],
        ["POST", "/api/brokers", "Create a broker configuration"],
        ["GET", "/api/brokers/:id/history", "Get broker connection event history (newest-first, up to 500)"],
      ]
    ),

    h2("17.11 API Client Endpoints"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET", "/api/api-clients", "List all API clients"],
        ["POST", "/api/api-clients", "Create an API client (body: name, scopes[], description?, expiresAt?, allowedIps?)"],
        ["PUT", "/api/api-clients/:id", "Update client (body: name?, scopes?, status?)"],
        ["DELETE", "/api/api-clients/:id", "Delete an API client"],
      ]
    ),

    h2("17.12 Dashboard & Visualization Endpoints"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET", "/api/dashboard/summary", "Stat cards: totalAssets, activeAlarms, dataPointsToday, connectedBrokers"],
        ["GET", "/api/dashboard/recent-telemetry", "Latest telemetry records across all assets"],
        ["GET", "/api/dashboard/alarm-stats", "Alarm counts grouped by severity"],
        ["GET", "/api/viz-dashboards", "List all named visualization dashboards"],
        ["POST", "/api/viz-dashboards", "Create a named dashboard"],
        ["PUT", "/api/viz-dashboards/:id", "Update dashboard (name, roleFilter, widgets)"],
        ["DELETE", "/api/viz-dashboards/:id", "Delete a named dashboard"],
      ]
    ),

    h2("17.13 System Endpoints"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET", "/api/system/storage", "Storage stats: totalRows, tableSize, perAsset breakdown"],
        ["GET", "/api/system/aggregate", "Time-bucketed aggregation (params: bucket, asset, metric, from, to)"],
        ["GET", "/api/system/retention", "List data retention policies"],
        ["POST", "/api/system/retention", "Create a retention policy"],
        ["PUT", "/api/system/retention/:id", "Update a retention policy"],
        ["DELETE", "/api/system/retention/:id", "Delete a retention policy"],
        ["POST", "/api/system/retention/run", "Manually trigger retention pruning"],
      ]
    ),

    h2("17.14 Activity & Destination Endpoints"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET", "/api/activity-log", "Paginated activity log (params: category, actorName, limit, offset)"],
        ["GET", "/api/destinations", "List data destinations"],
        ["POST", "/api/destinations", "Create a data destination"],
        ["PUT", "/api/destinations/:id", "Update a destination"],
        ["DELETE", "/api/destinations/:id", "Delete a destination"],
      ]
    ),

    h2("17.15 Export Endpoints (API Key Required)"),
    table(
      ["Method", "Path", "Scope Required", "Description"],
      [
        ["GET", "/api/export/assets", "read:assets", "List assets with current attribute values"],
        ["GET", "/api/export/telemetry", "read:telemetry", "Query time-series telemetry"],
        ["GET", "/api/export/alarms", "read:alarms", "Query active and historical alarms"],
        ["GET", "/api/export/alarm-history", "read:alarm-history", "Full alarm event history"],
        ["GET", "/api/export/health", "None (public)", "Server health check for uptime monitors"],
      ]
    ),
    pb(),

    // ─── CHAPTER 18 ───────────────────────────────────────────────────────────
    h1("Chapter 18: Data Ingestion Pipeline"),
    h2("18.1 Overview"),
    p("The ingest pipeline is the core data processing pathway. Every telemetry payload — whether received via HTTP POST or MQTT subscription — passes through the same pipeline:"),
    ol([
      "normalise(body) — Auto-detect payload format and convert to a standardised NormalisedPayload object.",
      "processNormalised(n) — Write telemetry records, update dynamic attributes, evaluate runtime expressions, evaluate alarm rules, and fire webhooks.",
    ]),

    h2("18.2 Normalisation"),
    p("The normaliser detects one of four payload formats:"),
    table(
      ["Format", "Detection Rule", "Metric Key Format"],
      [
        ["flat", "All metric fields at the root level beside deviceId", "field_name"],
        ["nested-root", "Root-level keys that are objects (sub-systems)", "subsystem.field_name"],
        ["nested-metrics", "Root has a 'metrics' key containing an object", "field_name"],
        ["nested-data", "Root has a 'data' key containing an object", "field_name"],
      ]
    ),
    p("All formats must include a top-level 'deviceId' string field. An optional 'timestamp' field (ISO 8601 string or Unix milliseconds) sets the measurement time; if absent, server receipt time is used."),

    h2("18.3 processNormalised Flow"),
    ol([
      "Lookup asset by identifier = deviceId. If not found, return HTTP 422.",
      "If asset is in maintenance mode, skip alarm evaluation (but still write telemetry).",
      "For each metric/value pair: INSERT a telemetry row.",
      "For each dynamic or metric attribute whose sourceMetric matches a metric in the payload: UPDATE attribute value, quality, and timestamp.",
      "Evaluate all runtime (expression) attributes for this asset using the updated attribute values as variables.",
      "For each enabled alarm rule on this asset: evaluate the rule condition. If the condition is met and no active alarm exists, create a new alarm record and (if enabled) fire the rule's webhook. If the condition is no longer met and an active alarm exists, clear the alarm.",
      "For each enabled destination subscribed to 'telemetry' events: fire an HTTP POST with the normalised payload.",
      "Broadcast a telemetry_update WebSocket event to all connected clients.",
    ]),

    h2("18.4 Rate-of-Change Calculation"),
    p("For alarm rules of type rate_of_change:"),
    ol([
      "Fetch the previous telemetry value for the same asset and metric (most recent row before the current one).",
      "Compute: rate = |currentValue - previousValue| / |currentTime - previousTime| (in seconds).",
      "Compare rate against the rule threshold.",
      "The rocWindow parameter (default 60 seconds) limits how far back the previous value can be fetched.",
    ]),

    h2("18.5 Batch Ingest"),
    p("POST /api/ingest/batch accepts a JSON array of payload objects. Each is processed through the same normalise → processNormalised pipeline sequentially. Up to 500 payloads per request. The response summarises: totalProcessed, recordsWritten, errors[]."),

    h2("18.6 Validate Endpoint"),
    p("POST /api/ingest/validate performs a dry-run: it resolves the deviceId, extracts metric keys, identifies the payload format, and returns what would be written — without actually writing any data to the database. Response includes: valid, assetId, assetName, payloadFormat, metricCount, extractedMetrics, warnings[]."),
    pb(),

    // ─── CHAPTER 19 ───────────────────────────────────────────────────────────
    h1("Chapter 19: MQTT Integration"),
    h2("19.1 How It Works"),
    p("The MQTT Subscriber Service (src/services/mqtt.ts) runs as a background service inside the API server process. On startup (and on broker config reload), it:"),
    ol([
      "Reads all broker records from the database where type = 'mqtt'.",
      "Creates an MQTT client connection for each broker using the configured host, port, clientId, username, and password.",
      "Subscribes to the configured topic pattern.",
      "On message receipt: applies mapping rules to the parsed JSON payload, then calls normalise() and processNormalised() — the same pipeline as HTTP ingest.",
      "On connection events: writes a broker_events row and broadcasts a broker_status WebSocket event to all clients.",
    ]),

    h2("19.2 Topic Wildcards"),
    table(
      ["Wildcard", "Meaning", "Example"],
      [
        ["+", "Single level — matches exactly one topic segment", "plant/+/sensors matches plant/chiller/sensors"],
        ["#", "Multi-level — matches all following segments", "plant/# matches plant/chiller, plant/chiller/sensors, etc."],
      ]
    ),

    h2("19.3 Mapping Rules"),
    p("Each broker can define a list of field rename rules (stored in the mappingRules JSONB column). Before the payload is normalised, each mapping rule is applied:"),
    code("json", `// Mapping rule example
{ "from": "temp", "to": "temperature" }

// Input payload from MQTT
{ "deviceId": "sensor-01", "temp": 72.4, "pressure": 1.02 }

// After mapping rule applied
{ "deviceId": "sensor-01", "temperature": 72.4, "pressure": 1.02 }`),

    h2("19.4 MQTT Payload Requirements"),
    p("The MQTT payload must be a valid JSON object. The same format detection rules apply as for HTTP ingest (flat, nested-root, nested-data, nested-metrics). The 'deviceId' field is required and must match an asset's identifier field."),

    h2("19.5 Graceful Error Handling"),
    p("MQTT broker errors (connection refused, authentication failure, network timeout) are caught and logged without crashing the API server. The broker_events table records each error with the error message. The MQTT service will attempt to reconnect based on the mqtt.js reconnection policy."),
    pb(),

    // ─── CHAPTER 20 ───────────────────────────────────────────────────────────
    h1("Chapter 20: Expression Engine"),
    h2("20.1 Purpose"),
    p("The Expression Engine allows runtime attributes to compute their values from mathematical expressions using other attribute values as variables. This enables derived metrics without any code — for example, computing Power (kW) from Voltage × Current, or calculating efficiency ratios."),

    h2("20.2 Implementation"),
    p("Expressions are evaluated using the 'expr-eval' library, a safe math expression parser that supports:"),
    ul([
      "Arithmetic operators: +, -, *, /, ^, % (modulo)",
      "Comparison operators: ==, !=, <, >, <=, >=",
      "Logical operators: and, or, not",
      "Built-in functions: abs, ceil, floor, round, sqrt, log, log2, log10, exp, min, max, sin, cos, tan",
      "Conditional expressions: if(condition, trueValue, falseValue)",
    ]),

    h2("20.3 Variable Binding"),
    p("When an expression is evaluated, ALL numeric attributes on the same asset are available as variables. The variable name is the attribute's tagName. For example, if an asset has attributes with tagNames 'voltage' and 'current', the expression 'voltage * current / 1000' is valid."),

    h2("20.4 Evaluation Trigger"),
    p("Runtime attributes are re-evaluated on every call to processNormalised() — i.e., every time a new telemetry payload arrives for the asset. The evaluation order ensures that base (dynamic/metric) attributes are updated first, then runtime attributes are computed from the updated values."),

    h2("20.5 Expression Examples"),
    table(
      ["Use Case", "Expression", "Variables Required"],
      [
        ["Power from voltage & current", "voltage * current / 1000", "voltage, current"],
        ["COP from cooling output & power", "cooling_kW / power_kW", "cooling_kW, power_kW"],
        ["Energy cost", "energy_kWh * tariff_rate", "energy_kWh, tariff_rate"],
        ["Temperature delta", "outlet_temp - inlet_temp", "outlet_temp, inlet_temp"],
        ["Conditional alarm level", "if(vibration > 10, 100, vibration * 10)", "vibration"],
        ["Load factor", "round(actual_load / rated_load * 100, 2)", "actual_load, rated_load"],
      ]
    ),
    pb(),

    // ─── CHAPTER 21 ───────────────────────────────────────────────────────────
    h1("Chapter 21: Alarm Rules Engine"),
    h2("21.1 Evaluation Trigger"),
    p("Alarm rule evaluation is triggered on every call to processNormalised(). After telemetry is written and attributes are updated, the engine fetches all enabled alarm rules for the asset and evaluates each one."),

    h2("21.2 Threshold Rule Evaluation"),
    code("typescript", `// Pseudocode for threshold rule evaluation
for each enabled threshold rule on this asset:
  currentValue = telemetry[rule.metric]  // from current payload
  
  conditionMet = evaluate(currentValue, rule.condition, rule.threshold)
  // e.g., 72.4 > 70 → true  for condition "gt", threshold 70
  
  if conditionMet and no active alarm for this rule:
    create new alarm record (status: active)
    if rule.webhookEnabled and rule.webhookUrl:
      fire POST to rule.webhookUrl (non-blocking)
    for each destination subscribed to alarm events:
      fire POST to destination.endpoint
  
  if not conditionMet and active alarm exists for this rule:
    update alarm status to "cleared", set clearedAt timestamp
    move alarm to alarm_history`),

    h2("21.3 Rate-of-Change Evaluation"),
    p("For rate_of_change rules, the engine additionally fetches the previous telemetry value before computing the rate:"),
    code("typescript", `previousRow = SELECT value, timestamp FROM telemetry
  WHERE assetId = rule.assetId 
    AND metric = rule.metric 
    AND timestamp < currentTimestamp
    AND timestamp > (currentTimestamp - rule.rocWindow * interval '1 second')
  ORDER BY timestamp DESC LIMIT 1

rate = abs(currentValue - previousRow.value) / 
       abs(currentTimestamp - previousRow.timestamp) /* in seconds */

conditionMet = rate > rule.threshold`),

    h2("21.4 Maintenance Mode Suppression"),
    p("Before evaluating any alarm rules for an asset, the engine checks the asset's maintenanceMode flag. If maintenanceMode = true, all rule evaluation is skipped for that asset — no new alarms are created. Existing active alarms remain in their current state until maintenance mode is disabled."),

    h2("21.5 Webhook Delivery"),
    p("Webhook delivery is fire-and-forget with a 5-second timeout:"),
    code("typescript", `fetch(rule.webhookUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Source': 'iot-platform' },
  body: JSON.stringify({ 
    type: 'alarm_triggered', 
    alarm: { name, assetId, severity, message, triggerValue },
    timestamp: new Date().toISOString()
  }),
  signal: AbortSignal.timeout(5000)
}).catch(err => logger.warn({ err }, 'Webhook delivery failed'))`),
    p("Failed webhooks are logged but do not block telemetry processing or alarm creation."),
    pb(),

    // ─── CHAPTER 22 ───────────────────────────────────────────────────────────
    h1("Chapter 22: WebSocket Protocol"),
    h2("22.1 Connection"),
    p("The WebSocket server is attached to the Express HTTP server at the path /api/ws. Clients connect using:"),
    code("text", "wss://<platform-domain>/api/ws"),
    p("The platform frontend establishes this connection automatically using the useWsEvents React hook. Every component in a tab shares one WebSocket connection; multiple browser tabs maintain independent connections."),

    h2("22.2 Event Types"),
    table(
      ["Event Type", "Trigger", "Payload Fields"],
      [
        ["telemetry_update", "Each successful ingest", "assetId, assetName, metrics (object), timestamp"],
        ["alarm_triggered", "New alarm created", "alarm (id, name, assetId, severity, status, message, triggerValue, triggeredAt)"],
        ["alarm_cleared", "Alarm moved to cleared status", "alarmId, assetId, clearedAt"],
        ["broker_status", "Broker connect/disconnect/error", "brokerId, brokerName, status, message, timestamp"],
      ]
    ),
    p("All events are JSON objects with a top-level 'type' field matching the event type strings above, plus a 'data' field containing the event payload."),

    h2("22.3 useWsEvents Hook"),
    p("The frontend useWsEvents hook (src/hooks/useWsEvents.ts) manages the WebSocket lifecycle:"),
    ul([
      "Opens one shared WebSocket connection when the first component subscribes.",
      "Automatically reconnects with exponential backoff on disconnection (immediately when the server closes it because the user's access changed), then refreshes loaded data so events missed while disconnected are picked up.",
      "Parses incoming JSON messages and dispatches them to registered event handlers.",
      "Exposes connection status (connecting, connected, reconnecting) to consuming components.",
      "Closes the connection shortly after the last subscribing component unmounts.",
    ]),

    h2("22.4 Per-Asset Signal Map"),
    p("The Visualization dashboard maintains a wsSignals map (Map<assetId, incrementing counter>). When a telemetry_update event arrives for an asset, the counter for that asset is incremented. WidgetCards subscribe to their asset's signal using React's useEffect hook, and automatically call their data-refetch function when the signal changes. This results in near-instantaneous widget updates without polling."),

    h2("22.5 LIVE Badge"),
    p("Each widget that has received at least one real-time WebSocket update shows an animated green dot (● LIVE) badge in its title bar. This badge provides clear visual confirmation that the widget is receiving live data from the server."),
    pb(),

    // ─── CHAPTER 23 ───────────────────────────────────────────────────────────
    h1("Chapter 23: Authentication & Authorization"),
    h2("23.1 Session Authentication"),
    p("Browser sessions are stored server-side in PostgreSQL and identified by an HttpOnly cookie (is_session). A session expires after 30 minutes idle and 12 hours absolute by default (AUTH_SESSION_IDLE_MINUTES, AUTH_SESSION_ABSOLUTE_HOURS). Cookie-authenticated write requests must send the x-csrf-token header that matches the is_csrf cookie."),

    h2("23.2 API Key Authentication (Bearer Token)"),
    p("External applications authenticate using API client credentials:"),
    ol([
      "Create an API client via Integration Hub → API Client. The secret is shown once; the server stores only its SHA-256 hash.",
      "Send the secret on every request as Authorization: Bearer <clientSecret> or X-API-Key: <clientSecret>. A key in the query string (?key=) is ignored unless the server sets API_KEY_ALLOW_QUERY_PARAM=true.",
      "The API server hashes the secret, looks up the matching api_clients record, verifies status=active and not expired, checks the IP allowlist and scopes, and applies a per-client limit of 1200 requests per minute by default (INGEST_RATE_LIMIT_RPM). Over the limit it returns HTTP 429.",
    ]),
    p("Requests without a valid token to protected endpoints (e.g., /api/export/alarms) receive HTTP 401."),

    h2("23.3 Scope Enforcement"),
    p("Each API endpoint in the /api/export/* namespace is protected by the apiKeyAuth(scope) middleware:"),
    code("typescript", `// Example: protect read:alarms scope
router.get('/export/alarms', apiKeyAuth('read:alarms'), async (req, res) => {
  // Only API clients with read:alarms in their scopes array reach here
});`),

    h2("23.4 IP Allowlist Enforcement"),
    p("If an API client has entries in its allowedIps array, the middleware extracts the requesting IP from req.ip (or X-Forwarded-For header). If the IP is not in the allowlist, HTTP 403 is returned immediately."),

    h2("23.5 Role-Based Access Control Implementation"),
    p("RBAC is enforced by the API server. The catalogue of roles, permissions and module defaults lives in artifacts/api-server/src/lib/rbac.ts, and middleware/authorize.ts holds a deny-by-default route table: a route without a rule is refused, and every refusal is written to security_events. The server sends the catalogue to the browser, where UserContext.tsx and RoleGuard use it so the UI matches. The permission sets per role are:"),
    code("typescript", `// artifacts/api-server/src/lib/rbac.ts (abridged)
super_admin, company_admin, admin:
  view, manage_assets, manage_templates, manage_alarms, acknowledge_alarms,
  manage_users, manage_brokers, manage_destinations, manage_api_clients, manage_security,
  approve_data_changes
engineer, developer:
  view, manage_assets, manage_templates, manage_alarms, acknowledge_alarms,
  manage_brokers, manage_destinations, manage_api_clients
project_manager, team_lead, operator: view, acknowledge_alarms
viewer: view

// Usage in components:
const { can } = useCurrentUser();
if (can('manage_users')) { /* show admin controls */ }`),
    note("The UI checks are for usability only. The server decision is authoritative; AUTH_ENFORCE=false disables it and exists only as a documented rollback switch (the server refuses to start with it in production)."),
    pb(),

    // ─── CHAPTER 24 ───────────────────────────────────────────────────────────
    h1("Chapter 24: Webhook & Destination System"),
    h2("24.1 Overview"),
    p("The Webhook & Destination System enables the platform to push events to external systems in real-time. There are two distinct webhook mechanisms: Data Destinations (platform-wide, configured per destination record) and Alarm Rule Webhooks (per-rule, triggered on alarm state change)."),

    h2("24.2 Data Destination Delivery"),
    p("When a telemetry ingest completes, processNormalised() queries all enabled destinations where the eventType matches (alarm or telemetry). For each matching destination:"),
    ol([
      "Construct the HTTP request with appropriate auth headers.",
      "Fire a non-blocking POST with a 5-second AbortSignal timeout.",
      "On failure, log the error — no retry in the current version.",
    ]),

    h2("24.3 Alarm Event Payload Format"),
    code("json", `{
  "type": "alarm_event",
  "event": "triggered",
  "alarm": {
    "id": "uuid",
    "name": "High Temperature",
    "assetId": "uuid",
    "assetName": "Chiller A",
    "severity": "high",
    "status": "active",
    "alarmClass": "threshold",
    "message": "ChillerA.outlet_temp gt 75 (value: 78.3)",
    "triggerValue": 78.3,
    "triggeredAt": "2026-05-09T10:30:00.000Z"
  },
  "timestamp": "2026-05-09T10:30:00.000Z",
  "source": "iot-platform"
}`),

    h2("24.4 Telemetry Event Payload Format"),
    code("json", `{
  "type": "telemetry_event",
  "assetId": "uuid",
  "assetName": "Chiller A",
  "deviceId": "chiller-a-01",
  "metrics": {
    "chiller.energy_kWh": 15.2,
    "chiller.load_percent": 82,
    "chiller.outlet_temp": 78.3
  },
  "timestamp": "2026-05-09T10:30:00.000Z",
  "source": "iot-platform"
}`),

    h2("24.5 Authentication Headers"),
    table(
      ["Auth Type", "Header Added to Outbound Request"],
      [
        ["Bearer Token", "Authorization: Bearer <token>"],
        ["API Key", "<apiKeyHeader>: <secretKey>  (default header: X-API-Key)"],
        ["Basic Auth", "Authorization: Basic <base64(basicUser:basicPass)>"],
        ["None", "(no additional auth header)"],
      ]
    ),
    p("All outbound destination requests also include: X-Source: iot-platform for source identification."),

    h2("24.6 Alarm Rule Webhooks"),
    p("Each alarm rule can have its own dedicated webhook URL (separate from global destinations). This allows different teams or systems to receive notifications only for specific rules they care about."),
    table(
      ["Field", "Description"],
      [
        ["webhookUrl", "Full HTTPS URL for the rule's dedicated webhook"],
        ["webhookEnabled", "Toggle — when false, the webhook URL is saved but not used"],
      ]
    ),
    p("The 'Test Webhook' button on the Alarm Rules page fires a test POST to the rule's webhook URL immediately, without waiting for an alarm condition. This is useful for verifying endpoint connectivity and request format during initial setup."),

    h2("24.7 Current Limitations"),
    ul([
      "No retry logic — if the destination endpoint is unavailable, the event is lost for that delivery attempt.",
      "No delivery queue — events are fire-and-forget in the ingest processing thread.",
      "5-second hard timeout per delivery — endpoints must respond within 5 seconds.",
      "No TLS client certificate authentication for destinations in the current version.",
    ]),
    note("For production-critical integrations requiring guaranteed delivery, consider using a message queue (e.g., RabbitMQ, Kafka, AWS SQS) as the destination endpoint and consuming from there."),

    // ─── APPENDICES ───────────────────────────────────────────────────────────
    pb(),
    h1("Appendix A: Frequently Asked Questions"),
    table(
      ["Question", "Answer"],
      [
        ["Why am I getting HTTP 422 on ingest?", "The deviceId in your payload does not match any asset's Identifier field. Check for typos, case sensitivity, and trailing spaces."],
        ["Can I send data without creating an asset first?", "No. Every ingest payload must have a deviceId that resolves to an existing asset. Create the asset with the correct identifier first."],
        ["Why isn't my alarm triggering?", "Check that: (1) the alarm rule is enabled, (2) the asset is not in maintenance mode, (3) the metric key in the rule matches exactly the key in the telemetry payload, (4) the threshold and condition are correct."],
        ["How do I scale to many assets?", "Add composite indexes on the telemetry table (already included). Consider data retention policies to limit table size. Use batch ingest for high-frequency sources."],
        ["How do I connect a legacy device that doesn't send JSON?", "Use an MQTT or HTTP gateway (e.g., Node-RED, AWS IoT Greengrass) to translate the protocol and format before forwarding to the platform ingest endpoint."],
        ["Can multiple devices report to the same asset?", "Yes, but only one deviceId per asset is matched. If multiple devices report similar data, create separate assets with separate identifiers and use the hierarchy to group them."],
        ["What happens if the WebSocket disconnects?", "The useWsEvents hook reconnects automatically with exponential backoff. Missed events are not replayed, but once it reconnects the page reloads its data from the server, so current values appear without a manual refresh."],
      ]
    ),

    pb(),
    h1("Appendix B: Troubleshooting Guide"),
    table(
      ["Symptom", "Likely Cause", "Resolution"],
      [
        ["No data in telemetry chart", "deviceId mismatch or telemetry not being sent", "Confirm the payload deviceId exactly matches the asset identifier (case-sensitive); send a test payload with curl (see the Integration Guide)."],
        ["Alarms not triggering", "Rule disabled, asset in maintenance, wrong metric key", "Verify rule is enabled; check maintenance mode; confirm metric key matches exactly."],
        ["MQTT broker shows 'error'", "Wrong credentials, host unreachable, or firewall block", "Test connectivity from server with mosquitto_pub; verify credentials; check firewall rules."],
        ["Dashboard widgets show 'No data'", "Asset has no telemetry in the selected time range", "Send test data with curl or a gateway; check the time range selector."],
        ["Add Destination dialog crashes", "Form component rendered outside proper context", "Refresh the page. If persistent, clear browser cache and reload."],
        ["API client returns 401", "Token expired or client revoked", "Check client status in Security → API Clients; create a new client if needed."],
        ["Reports show empty alarm data", "Date range does not include any alarm events", "Expand the date range; check Alarm History page for actual event timestamps."],
        ["Expression attribute not updating", "tagName typo in expression, or dependency attributes not updated", "Verify all tagNames used in the expression exist on the asset; check telemetry is arriving."],
      ]
    ),

    pb(),
    h1("Appendix C: Glossary"),
    table(
      ["Term", "Definition"],
      [
        ["Asset", "A logical representation of a physical device, machine, or sub-system in the hierarchy."],
        ["Attribute", "A named property of an asset — can be static, dynamic, metric, or runtime computed."],
        ["Broker", "A configured connection to an external data source (MQTT, REST, Azure IoT)."],
        ["deviceId", "The identifier in a telemetry payload that links incoming data to a specific asset."],
        ["Destination", "An external HTTP endpoint that receives forwarded alarm or telemetry events."],
        ["Expression", "A mathematical formula (using expr-eval) that computes a runtime attribute value."],
        ["freshnessPct", "The percentage of an asset's attributes that have received telemetry within the last hour."],
        ["Ingest", "The process of receiving a telemetry payload, normalising it, and storing it."],
        ["NormalisedPayload", "The standardised internal representation after format detection and field extraction."],
        ["Rate of Change", "The rate at which a metric value changes over time (|Δvalue / Δtime|)."],
        ["RBAC", "Role-Based Access Control — permissions are assigned to roles, roles are assigned to users."],
        ["Retention Policy", "A configured rule that automatically deletes telemetry older than a specified age."],
        ["rocWindow", "The time window (in seconds) over which rate-of-change is computed."],
        ["Scope", "A permission string (e.g., read:assets) granted to an API client."],
        ["sourceMetric", "The metric key in a telemetry payload that updates a specific attribute."],
        ["tagName", "A short identifier for an attribute, used in expressions and exports."],
        ["Telemetry", "Time-series sensor readings stored in the telemetry table."],
        ["UoM", "Unit of Measure — the physical unit of a measurement (e.g., kWh, °C, bar, RPM)."],
        ["WebSocket", "A persistent bidirectional connection between the browser and server for real-time events."],
        ["Webhook", "An HTTP POST sent by the platform to an external URL when a specific event occurs."],
      ]
    ),

    divider(),
    p(`${PLATFORM_NAME} v${PLATFORM_VERSION} — Platform Documentation`),
    p(`Generated: ${DOC_DATE}`),
    p("This document covers all features available in the current platform release. For the latest updates and API changes, consult the Integration Guide within the platform."),
  ];
}
