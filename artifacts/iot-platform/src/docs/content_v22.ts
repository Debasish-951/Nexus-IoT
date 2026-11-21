import { type ContentItem, PLATFORM_NAME } from "./content";

/**
 * Platform documentation v2.2 (November 2026).
 *
 * A standalone document, not a diff on top of v1.0/v1.1: it follows the same
 * Part I / Part II / Appendix structure but describes only what the current
 * application does. Features that are switched off by default are mentioned
 * only in the feature-switch table (Chapter 26).
 *
 * Text stays within Latin-1 / WinAnsi characters: the PDF generator uses
 * jsPDF's standard fonts, which cannot draw symbols, CJK or Indic scripts.
 */

export const PLATFORM_VERSION_V22 = "2.2";
export const DOC_DATE_V22 = "November 2026";

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

export function buildDocumentContent_v22(): ContentItem[] {
  return [
    // ─── COVER ────────────────────────────────────────────────────────────────
    h1(PLATFORM_NAME),
    h2("Platform User Manual & Technical Documentation"),
    p(`Version ${PLATFORM_VERSION_V22}  |  ${DOC_DATE_V22}`),
    p("Industrial IoT Data Acquisition & Analytics Platform"),
    divider(),
    p("This document describes the platform as it is today: how to operate, configure and integrate with it. It is intended for operators, engineers, administrators and system integrators."),
    pb(),

    // ─── TABLE OF CONTENTS ────────────────────────────────────────────────────
    h1("Table of Contents"),
    p("PART I - USER MANUAL"),
    ul([
      "Chapter 1: Introduction & Overview",
      "Chapter 2: Sign-in, Navigation & Interface",
      "Chapter 3: Home - Project List",
      "Chapter 4: Asset Hub",
      "Chapter 5: Data Studio",
      "Chapter 6: Event Manager",
      "Chapter 7: Integration Hub & Data Destinations",
      "Chapter 8: Governance - Users, API Clients & Security Center",
      "Chapter 9: Data Management & Reports",
      "Chapter 10: Visualization Dashboards",
      "Chapter 11: Live Feed",
      "Chapter 12: Audit Log",
      "Chapter 13: Live Twin",
      "Chapter 14: AI Advisor",
      "Chapter 15: Role-Based Access Control",
    ]),
    p("PART II - TECHNICAL DOCUMENTATION"),
    ul([
      "Chapter 16: Architecture Overview",
      "Chapter 17: Database Schema Reference",
      "Chapter 18: REST API Reference",
      "Chapter 19: Data Ingestion Pipeline",
      "Chapter 20: MQTT Integration",
      "Chapter 21: Expression Engine",
      "Chapter 22: Alarm Rules Engine",
      "Chapter 23: WebSocket Protocol",
      "Chapter 24: Authentication & Authorization",
      "Chapter 25: Webhook & Destination System",
      "Chapter 26: Operations & Feature Switches",
    ]),
    p("APPENDICES - A: Frequently Asked Questions, B: Troubleshooting Guide, C: Glossary"),
    pb(),

    // ═══════════════════════════════════════════════════════════════════════════
    //  PART I — USER MANUAL
    // ═══════════════════════════════════════════════════════════════════════════
    h1("PART I - USER MANUAL"),
    pb(),

    // ─── CHAPTER 1 ────────────────────────────────────────────────────────────
    h1("Chapter 1: Introduction & Overview"),
    h2("1.1 About the Platform"),
    p(`${PLATFORM_NAME} is an industrial IoT data acquisition and analytics platform for plants, energy facilities and utilities. It collects sensor data from devices and gateways, stores it, evaluates alarm rules in real time, and presents live and historical data in dashboards, digital twins and reports.`),
    p("It consists of a React single-page web application, an Express 5 API server with a WebSocket channel for live updates, and a PostgreSQL database. Each company runs its own installation on its own server."),

    h2("1.2 Key Capabilities"),
    ul([
      "Projects and asset hierarchy - a project is a top-level asset; assets nest without limit below it.",
      "Telemetry ingest - HTTP (single, array and batch) and MQTT, with four auto-detected payload formats.",
      "Attributes - static, dynamic, metric and timestamp attributes, plus runtime values computed from expressions.",
      "Asset templates - reusable attribute sets, built from a device payload or an Excel/CSV worksheet.",
      "Visualization - a dashboard hierarchy with ownership and sharing, the standard widget set plus 104 Pro widgets, SPC lines, live updates.",
      "Live Feed - live operations view of assets, sensors and events.",
      "Live Twin - 2D, asset, process and plant twins and a 3D Builder linked to live asset data.",
      "AI Advisor - plain-language questions about assets, health, failures and recommendations, and AI Reports written for executives, managers or engineers.",
      "Event Manager - threshold and rate-of-change alarm rules with deadband and on/off delays, acknowledgement, history and webhooks.",
      "Integration Hub - MQTT brokers, project-scoped API clients, per-client ingest URLs and alarm forwarding to destinations.",
      "Governance - invited user accounts, nine roles, per-module access, project access, Security Center.",
      "Data Management (in Governance) - storage, retention, summaries, archives, data health.",
      "Audit Log - record of every significant change with the actor's identity.",
      "Interface languages - English, Japanese, Hindi and Telugu.",
    ]),

    h2("1.3 Supported Use Cases"),
    ul([
      "Energy monitoring and sub-metering.",
      "Condition monitoring and predictive maintenance (vibration, temperature, run hours).",
      "Utilities: chillers, compressors, boilers, cooling towers, HVAC and water treatment.",
      "Pharma and cold-chain compliance monitoring (temperature, humidity, cleanrooms).",
      "SCADA and PLC integration through MQTT or HTTP gateways such as Node-RED.",
    ]),

    h2("1.4 System Requirements"),
    table(
      ["Component", "Requirement"],
      [
        ["Browser", "Current Chrome, Edge, Firefox or Safari with WebSocket support; WebGL for the 3D twins"],
        ["Network", "HTTPS access to the platform address; WebSocket on the same address"],
        ["Screen", "1280 x 720 minimum; 1920 x 1080 recommended"],
        ["Server", "One Linux virtual machine with nginx"],
        ["Runtime", "Node.js 20 or later (LTS)"],
        ["Database", "PostgreSQL 14 or later"],
        ["Storage", "SSD recommended; size depends on telemetry volume and retention"],
      ]
    ),

    h2("1.5 Getting Started"),
    ol([
      "Your administrator creates your account. You receive a single-use activation link.",
      "Open the link and choose a password that meets the password policy shown on the page.",
      "Sign in at the platform address with your username or email and password.",
      "Home lists the projects you may open. Click a project to work inside it.",
      "What you can see and change depends on your role and module access (Chapter 15).",
    ]),
    pb(),

    // ─── CHAPTER 2 ────────────────────────────────────────────────────────────
    h1("Chapter 2: Sign-in, Navigation & Interface"),
    h2("2.1 Signing In"),
    ul([
      "There are no default credentials. Every account starts as an invitation.",
      "Activation links are valid for 72 hours by default and can be used once.",
      "'Remember me' keeps the session across browser restarts for 14 days by default.",
      "'Forgot password' sends a reset link valid for 60 minutes by default.",
      "After 5 failed attempts the account is locked for 15 minutes by default. An administrator can unlock it.",
      "A session ends after 30 minutes without activity and after 12 hours at most (defaults).",
      "An administrator can issue a temporary password or require a password change; you then set a new password at sign-in.",
    ]),

    h2("2.2 Main Navigation"),
    table(
      ["Menu", "Pages"],
      [
        ["Home", "Project list"],
        ["Asset Hub", "Assets, Asset Templates, Media Library"],
        ["Data Studio", "Visualization, Asset Template (dashboard templates), Live Feed"],
        ["Live Twin", "Digital twins of machines, processes and plants"],
        ["AI Advisor", "Advisor (Ask Your Assets, Health Insights, Failure Explanations, Smart Recommendations), AI Reports"],
        ["Event Manager", "Alarm List, Alarm History, Alarm Rule"],
        ["Integration Hub", "Broker, API Client, Destinations, Connections, Integration Guide"],
        ["Governance", "User, Security Center, Notification Groups, Data Management"],
        ["Audit Log", "Record of changes"],
      ]
    ),
    p("Menus and pages you have no access to are not shown. The sidebar can be collapsed with the button at the left of the top bar."),

    h2("2.3 Top Bar"),
    table(
      ["Element", "Function"],
      [
        ["Broker status", "Shows broker connection state: Connected, Error or Disconnected"],
        ["Language", "English, Japanese, Hindi or Telugu (Chapter 2.5)"],
        ["Appearance", "Skin (Slate, Classic, Deep navy, Cool grey, Soft white, Pale blue) and Light or Dark theme"],
        ["Notification bell", "Open alarms and recent activity, with a link to all alarms"],
        ["Profile menu", "Your name and email, Change Password, Sign Out"],
      ]
    ),
    p("A banner below the top bar appears while critical alarms are open."),

    h2("2.4 Address-bar Links"),
    p("Page addresses use opaque tokens instead of readable paths. A copied link still opens the same page for any user who has access to it. The tokens are not a security control; access is always checked by the server."),

    h2("2.5 Interface Languages"),
    p("The choice is remembered per browser and applies immediately. Only interface text is translated; project, asset and attribute names, values and units always appear as stored."),
    table(
      ["Area", "Translated"],
      [
        ["Main menu, sidebar, top bar, profile menu", "Yes"],
        ["Home", "Yes"],
        ["Live Twin", "Yes"],
        ["All other screens and server messages", "Not yet - shown in English"],
      ]
    ),
    note("The Japanese, Hindi and Telugu texts are machine-written and waiting for review by native speakers."),
    pb(),

    // ─── CHAPTER 3 ────────────────────────────────────────────────────────────
    h1("Chapter 3: Home - Project List"),
    h2("3.1 Overview"),
    p("Home is the first page after sign-in. It lists the projects you may open. A project is a top-level (root) asset in the Asset Hub. Each card shows the project name; clicking it opens the project at its Assets, or at Visualization if you do not have the Assets module."),

    h2("3.2 Who Sees Which Projects"),
    table(
      ["Role", "Projects shown"],
      [
        ["Project Manager", "All projects"],
        ["Team Lead, Developer", "Only projects ticked under User > Access Control > Project Access. None ticked means none"],
        ["Other roles", "Follow the user's Project Access setting"],
      ]
    ),
    p("The server applies the same rule to every request: assets, telemetry, alarms and dashboards of other projects are refused or left out of lists. Pages that cover every project, such as Data Management, are not available to project-restricted users."),
    pb(),

    // ─── CHAPTER 4 ────────────────────────────────────────────────────────────
    h1("Chapter 4: Asset Hub"),
    h2("4.1 Asset Hierarchy"),
    p("Physical equipment is modelled as a tree. Root assets are projects (plants or sites); child assets are units, processes, machines or measurement points. Nesting is unlimited."),
    code("text", `Plant 1                (project)
  Unit 1
    Chiller A
      Compressor
      Cooling Tower
  Electrical Panel`),

    h2("4.2 Creating Assets"),
    ol([
      "Open Asset Hub > Assets.",
      "Use the '+' menu in the tree: New root project or site, Child asset, or Sibling asset.",
      "Enter the asset name and create it.",
      "A child asset inherits its parent's template.",
    ]),
    p("New assets are created without a device. An asset receives data once it has a Device ID: the Device ID comes from the asset template and is shown read-only in the asset's Edit dialog, where 'Unbind this device' removes it."),
    note("Incoming telemetry is matched by comparing the payload deviceId with the asset's Device ID (identifier) exactly, including upper and lower case."),

    h2("4.3 Asset Details"),
    p("Opening an asset shows a header card and two tabs:"),
    ul([
      "Attributes - the attribute table with Add Attribute, Apply Template and Export CSV.",
      "Media - a link to the Media Library.",
    ]),
    p("Deleting an asset deletes its whole subtree with telemetry, attributes, alarms and the alarm rules bound to those assets, in one transaction. Alarm history is kept."),

    h2("4.4 Attributes"),
    table(
      ["Type", "Meaning", "Updated by"],
      [
        ["Static", "Fixed information such as model number or installation date", "Manual edit"],
        ["Dynamic", "Value taken from incoming telemetry", "Ingest pipeline"],
        ["Metric", "Measured value with unit, decimals and thousand separator", "Ingest pipeline"],
        ["Timestamp", "Date and time value", "Ingest pipeline or manual"],
      ]
    ),
    p("Any attribute can instead be calculated from an expression ('Use Expression (Runtime)'); it is then recalculated on every incoming payload (Chapter 21)."),
    table(
      ["Field", "Description"],
      [
        ["Name", "Display name"],
        ["Tag Name", "Key that binds the attribute to the payload field, and the variable name in expressions"],
        ["Data Type", "Text, Number, Double, Boolean or Timestamp"],
        ["UoM", "Unit of measure, e.g. kWh, °C, bar"],
        ["Decimals", "Display rounding"],
        ["Thousand Sep.", "Show 1,234.5 instead of 1234.5"],
        ["Expression", "Formula for runtime values, e.g. voltage * current / 1000"],
      ]
    ),
    p("Each attribute also carries a quality (good, uncertain or bad) and the time of its last update. Blank readings are stored with quality 'bad'."),

    h2("4.5 Maintenance Mode"),
    p("The switch on the asset header card puts the asset into maintenance, with an optional reason. While it is on, alarm rules are not evaluated for the asset; telemetry is still stored. The change is recorded in the Audit Log."),

    h2("4.6 Asset Templates"),
    p("A template is a reusable set of attribute definitions, optionally with the Device ID of the device it describes."),
    h3("Creating a template"),
    ol([
      "Open Asset Hub > Asset Templates and click Create Template. Enter a name.",
      "Open the template and add attributes by hand, or import them: paste a device payload ('Extract attributes from payload'), or import a CSV or JSON file.",
      "Apply the template to an asset from the asset's Attributes tab (Apply Template). Attributes that already exist are skipped.",
    ]),
    h3("Master template and section worksheets"),
    ol([
      "Create one template from the full device payload.",
      "Click Export on the Asset Templates page. An .xlsx worksheet is produced with a frozen header row and dropdowns.",
      "Attribute Name, Tag Name and any unit already set are pre-filled. Fill Type, Device Template Name, Data Type and Required per row.",
      "Split the rows into section files in Excel and set the Device Template Name of each row to its section.",
      "Click Import and choose the .xlsx or .csv file. The preview lists each template name, whether it will be created or merged, and any row problem.",
      "Confirm. New names are created; existing templates are merged by Tag Name. Nothing is deleted.",
    ]),
    table(
      ["Column", "Required", "Meaning"],
      [
        ["Attribute Name", "Yes", "Display name"],
        ["Type", "Yes", "static, dynamic, metric or timestamp"],
        ["Device Template Name", "Yes", "Template the row belongs to; created if it does not exist"],
        ["Tag Name", "Yes", "Must match the payload key"],
        ["Data Type", "Yes", "text, number, double, boolean or timestamp"],
        ["UoM", "No", "Unit shown next to the value"],
        ["Decimal Place", "No", "0 to 10"],
        ["Required", "No", "TRUE or FALSE; recorded, not enforced"],
      ]
    ),
    note("Import stops on structural problems (unknown Type or Data Type, missing name or tag, Decimal Place outside 0-10, the same tag twice in one template). Only the first sheet of a workbook is read."),

    h2("4.7 Media Library"),
    p("Stores images on the server for use in dashboards. Upload PNG, JPG, GIF or WebP files up to 10 MB (several at once, by drag and drop) or add an image by URL. Search, preview, copy an image's URL, or delete it. Image widgets use an image by its URL."),
    pb(),

    // ─── CHAPTER 5 ────────────────────────────────────────────────────────────
    h1("Chapter 5: Data Studio"),
    h2("5.1 Overview"),
    p("Data Studio (called Data Insights before November 2026) groups the pages for looking at data: Visualization (Chapter 10), Live Feed (Chapter 11) and the dashboard templates page described below. Reports are written by AI Advisor > AI Reports (Chapter 14.2)."),

    h2("5.2 Asset Template (Dashboard Templates)"),
    p("Any dashboard can be saved as a template: right-click it in Visualization and select Create Template. The Asset Template page lists saved templates."),
    ul([
      "Search templates by name.",
      "Apply a template: choose the target dashboard; the template's widgets become that dashboard's layout.",
      "Rename or delete a template.",
    ]),
    note("Templates are stored in the browser where they were created. A dashboard created from a template is stored on the server like any other."),
    pb(),

    // ─── CHAPTER 6 ────────────────────────────────────────────────────────────
    h1("Chapter 6: Event Manager"),
    h2("6.1 Alarm List"),
    p("Shows open and recent alarms raised by the alarm rules. Filters: search, severity and status. Columns: Name, Asset, Severity, Status, Class, Triggered, Message and an Ack button."),

    h2("6.2 Severity Levels"),
    table(
      ["Severity", "Typical use"],
      [
        ["Critical", "Immediate action - safety risk or severe damage; also shown in the critical alarm banner"],
        ["High", "Urgent attention"],
        ["Medium", "Investigate within a reasonable time"],
        ["Low", "Minor deviation"],
        ["Info", "Information only"],
      ]
    ),

    h2("6.3 Alarm Lifecycle"),
    ol([
      "ACTIVE - the rule condition is met (after any On Delay).",
      "ACKNOWLEDGED - a user with acknowledge rights has seen it; the condition may still be present.",
      "CLEARED - the condition has ended (after any deadband and Off Delay), or the rule was disabled or deleted.",
    ]),
    p("Each rule raises at most one open alarm per asset. Acknowledging is recorded in the Audit Log and in Alarm History."),

    h2("6.4 Alarm History"),
    p("A permanent record of alarm events. Filters: search, severity and state (Unacknowledged, Acknowledged, Returned to Normal). Columns: Event Time, Alarm Name, Asset, Severity, Priority, State, Cleared / Ack. At and Action."),

    h2("6.5 Alarm Rules"),
    p("The rules list shows Name, Type, Severity, Metric, Condition, Webhook and Enabled, with a Test webhook button per rule."),
    table(
      ["Field", "Description"],
      [
        ["Asset", "Asset the rule watches"],
        ["Name, Description", "Shown on alarms and notifications"],
        ["Severity", "Critical, High, Medium, Low or Info"],
        ["Alarm Type", "Threshold or Rate of Change"],
        ["Signal / Metric", "Metric key in the telemetry"],
        ["Operator", "gt, lt, gte, lte, eq, ne"],
        ["Threshold", "Limit value (for Rate of Change: units per second)"],
        ["Deadband", "Margin the value must move back past before a high or low alarm clears"],
        ["On Delay / Off Delay", "Seconds the condition must last before the alarm raises / clears"],
        ["Webhook", "URL called when the alarm raises or clears, with a payload preview"],
        ["Enabled", "Turns the rule on or off without deleting it"],
      ]
    ),

    h2("6.6 Notification Channels and Groups"),
    p("Rules also show Email, WhatsApp and Text Message switches with recipient pickers (platform users and notification groups). Governance > Notification Groups manages the groups."),
    note("These channel settings are saved, but the server does not send Email, WhatsApp or text messages yet. Webhooks are delivered today."),
    pb(),

    // ─── CHAPTER 7 ────────────────────────────────────────────────────────────
    h1("Chapter 7: Integration Hub & Data Destinations"),
    h2("7.1 Connections"),
    p("The Connections page summarises MQTT/REST brokers, webhook destinations, API clients and the ingest endpoint, with cards linking to each page, the Integration Guide and a 'How data flows' explanation."),

    h2("7.2 Brokers"),
    table(
      ["Type", "Status"],
      [
        ["MQTT", "Connected and subscribed by the platform"],
        ["REST API", "Configuration record for HTTP sources (data arrives at the ingest API)"],
        ["Azure IoT Hub, Azure Event Hub", "Stored, but not connected yet"],
      ]
    ),
    h3("MQTT broker fields"),
    table(
      ["Field", "Description"],
      [
        ["Name", "Display name"],
        ["Endpoint", "Broker address, e.g. mqtt://broker.example.com:1883 or mqtts://...:8883"],
        ["Client ID", "Stable MQTT client id for the platform"],
        ["Username / Password", "Broker credentials; the password is stored encrypted and never shown again"],
        ["Topic", "Subscription; + matches one level, # all remaining levels"],
        ["Mapping rules", "Field renames applied before the payload is processed"],
      ]
    ),
    p("Saving a broker restarts its connection immediately. Each broker keeps a connection history (connected, disconnected, error, with messages)."),

    h2("7.3 Data Destinations"),
    p("A destination is an external HTTPS endpoint that receives alarm events (raised and cleared) from every project."),
    table(
      ["Field", "Description"],
      [
        ["Name, Description", "Display information"],
        ["Endpoint URL", "Receives a JSON POST"],
        ["Auth Type", "Bearer, API Key (header name configurable, default X-API-Key), Basic or None"],
        ["Event Types", "alarm"],
        ["Enabled", "Turns delivery on or off"],
      ]
    ),
    p("The Test button sends a test event and shows the HTTP status. Each destination shows the time and error of its last send and a send count. Payloads are described in Chapter 25."),

    h2("7.4 Integration Guide"),
    p("This page shows the ingest endpoint address with a copy button and offers this documentation as PDF and Word downloads in every published version."),
    pb(),

    // ─── CHAPTER 8 ────────────────────────────────────────────────────────────
    h1("Chapter 8: Governance - Users, API Clients & Security Center"),
    p("The Governance menu holds User, Security Center, Notification Groups and Data Management (Chapter 9). API Client is under Integration Hub."),
    h2("8.1 Users"),
    p("Governance > User has two tabs: User List and Access Control. Only Super Admin, Company Admin and Admin can manage users, and only users of a lower rank."),
    h3("8.1.1 Inviting a user"),
    ol([
      "Click to invite a user and enter Full Name, Username, Email and Role. No password is set.",
      "The account is created as Invited and an activation link is sent.",
      "The user sets a password with the link; the account becomes Active.",
    ]),
    h3("8.1.2 User status"),
    table(
      ["Status", "Effect"],
      [
        ["Invited", "Created, not yet activated; cannot sign in"],
        ["Active", "Can sign in"],
        ["Suspended", "Sign-in blocked; open sessions and live connections are closed"],
        ["Inactive", "Sign-in not permitted"],
      ]
    ),
    h3("8.1.3 Row actions"),
    ul([
      "Resend activation email (invited users).",
      "Email password reset link.",
      "Unlock (locked accounts).",
      "Temporary password, valid 1 to 1440 minutes, that must be changed at sign-in.",
      "Login limit - number of simultaneous sessions (default 3; Super Admin and Company Admin).",
      "Edit (name, email, role, status) and Delete.",
    ]),
    note("Administrators never see a user's password."),
    h3("8.1.4 Access Control tab"),
    p("Per-user overrides of the role defaults: Module Permissions (Read, Write, Delete per module), API client scopes, Project Access, Visualization dashboards, and Analytics & Reports."),

    h2("8.2 API Clients"),
    p("API clients give gateways and other systems machine access with a secret key instead of a user session."),
    h3("8.2.1 Creating an API client"),
    ol([
      "Open Integration Hub > API Client and create a client.",
      "Enter a name and optional description and tags.",
      "Choose a project, or leave it platform-wide. Project-restricted users can only create project-assigned clients.",
      "Select scopes. You cannot grant more than your own rights.",
      "Optionally set an expiry date and an IP allowlist (addresses or CIDR ranges).",
      "Create. The secret is shown once; copy it. Only its SHA-256 hash is stored.",
    ]),
    h3("8.2.2 Scopes"),
    table(
      ["Scope", "Allows"],
      [
        ["ingest:write", "POST /api/ingest/payload, /batch, /validate"],
        ["read:assets", "GET /api/export/assets"],
        ["read:telemetry", "GET /api/export/telemetry"],
        ["read:alarms", "GET /api/export/alarms"],
        ["read:alarm-history", "GET /api/export/alarm-history"],
      ]
    ),
    p("A project-assigned client only reaches its project's assets. A request for another project's asset returns HTTP 403 (project_forbidden) and is logged as a security event."),
    h3("8.2.3 Client operations"),
    table(
      ["Operation", "Effect"],
      [
        ["Rotate secret", "Issues a new secret; the old one stops working at once"],
        ["Regenerate ingest URL", "Issues a new copy-and-paste ingest URL; the old one stops working"],
        ["Revoke / Restore", "Blocks the client / allows it again"],
        ["Delete", "Removes the client"],
      ]
    ),
    p("Each client may make 1200 requests per minute by default; beyond that the API answers HTTP 429."),

    h2("8.3 Security Center"),
    table(
      ["Tab", "Content"],
      [
        ["Overview", "Security summary"],
        ["Login History", "Successful and failed sign-ins"],
        ["Security Events", "Refused requests, key misuse and other security events, live"],
        ["Active Sessions", "Signed-in sessions with address and browser; revoke one session or all sessions of a user"],
      ]
    ),
    pb(),

    // ─── CHAPTER 9 ────────────────────────────────────────────────────────────
    h1("Chapter 9: Data Management & Reports"),
    p("Data Management is in the Governance menu (until November 2026 it was under System). Reports are written by AI Advisor > AI Reports (Chapter 14.2); the classic report builder below is kept for installations that turn it back on."),
    h2("9.1 Data Management"),
    p("Governance > Data Management shows how much sensor data is stored, how fast it grows and whether it is complete, and controls when old readings are deleted. A warning appears while no retention policy exists, because readings are then never deleted."),
    table(
      ["Tab", "Content"],
      [
        ["Overview", "Alerts, storage and growth, free disk space and days until full, data per project and per asset, summary progress"],
        ["Retention", "Policies, approvals waiting, bad-data removal, legal holds, pruning history with CSV reports, age limits of other records"],
        ["Data health", "Assets that stopped sending, hourly coverage and gaps, busiest metrics, refused ingest requests"],
        ["Archives & backups", "Backup status reported by the backup script; daily archive files with download and restore"],
        ["Database", "Disk use of every table, uploads, archives and backups; monthly partitions; database health with Vacuum"],
        ["Settings", "Alert thresholds and webhook, quiet time, pruning window, approval of large deletions, archiving, summary levels"],
      ]
    ),
    note("Reading needs the Data Management module (part of the Reports module before November 2026). Deleting, restoring, changing settings, downloading raw data or showing database queries also needs Manage assets. Project-restricted users cannot open the page. Every change is written to the Audit Log."),

    h3("9.1.1 Summaries"),
    p("A background job summarises telemetry per asset and metric (count, minimum, average, maximum) at two levels: 15 minutes (kept 365 days by default) and hourly (kept 1825 days). Charts use the summaries where raw readings were deleted, so long-term trends survive a short raw retention. Pruning never deletes raw readings that are not summarised yet."),

    h3("9.1.2 Retention policies"),
    ol([
      "Click Add policy. Enter a name and how many days to keep readings (or pick 30 d, 90 d, 180 d, 1 yr, 2 yr).",
      "Optionally limit it to an asset and a metric.",
      "Check the estimate of how many readings the next run would delete, then save.",
    ]),
    ul([
      "The most specific enabled policy decides a reading's retention: asset + metric, then asset, then metric, then all.",
      "Pruning runs every hour; 'Run pruning now' runs it immediately after confirmation.",
      "With approval switched on, a change that would delete more than the limit waits for approval by a second person.",
      "Readings under a legal hold, not yet summarised, or (with archiving on) not yet archived are never deleted.",
      "Cleared alarms, alarm history, the audit log, broker events, sign-in links and summaries are deleted by age as set on the server.",
    ]),

    h2("9.2 Classic Reports"),
    p("Not in the menu by default. Build the web application with VITE_CLASSIC_REPORTS=true to list Reports in Data Studio again; the page also opens at its address /reports for users with the Reports module."),
    table(
      ["Report", "Content"],
      [
        ["Telemetry Summary", "Minimum, average and maximum per metric and time bucket"],
        ["Alarm Event Log", "Alarm events in a date range, filterable by severity"],
        ["Asset Status Snapshot", "Every asset with maintenance state, health and attributes"],
        ["Alarm Analysis by Asset", "Alarm counts and patterns per asset"],
        ["Operational Health Report", "Overall operating health of the assets"],
      ]
    ),
    p("Quick ranges: 1 h, 24 h, 7 d, 30 d. Buckets: 15 min, 1 h, 6 h, 1 day. Download as CSV or JSON."),
    p("Generate AI summary (shown to users with AI Advisor) opens AI Advisor > AI Reports for the same asset and period (Chapter 14.2)."),
    pb(),

    // ─── CHAPTER 10 ───────────────────────────────────────────────────────────
    h1("Chapter 10: Visualization Dashboards"),
    h2("10.1 Dashboard Hierarchy"),
    p("Visualization has its own tree of dashboards, separate from the asset tree. Each node in the tree is one dashboard, and nodes can be nested. Dashboards are stored on the server."),
    ul([
      "'Create a top-level dashboard' adds a root node; the '+' menu adds child nodes.",
      "Each dashboard has an owner. You see dashboards you own and dashboards shared with you; access to a node includes its children.",
      "A top-level dashboard can be assigned to a project. Unassigned dashboards show in every project; dashboards created inside a project are assigned to it.",
    ]),

    h2("10.2 Dashboard Menu (right-click)"),
    table(
      ["Action", "Effect"],
      [
        ["Edit Dashboard / Rename", "Change the dashboard"],
        ["Clone Dashboard / Clone Dashboard & Children", "Copy the layout of one node, or of the node and its subtree, for pasting with Import Dashboard"],
        ["Create Template", "Save the layout as a dashboard template (Chapter 5.2)"],
        ["Delete Dashboard", "Remove the node"],
        ["Bookmark / Remove Bookmark", "Pin a dashboard for quick access"],
        ["Import Dashboard", "Paste a cloned layout, or load a dashboard JSON file"],
        ["Export Dashboard", "Download the dashboard's widgets as a JSON file"],
        ["Manage Access", "Share with users with Read, Write and Delete rights (Super Admin and Company Admin)"],
        ["Assign to Project", "Root dashboards only"],
        ["Futuristic Dashboard", "Switch the futuristic display mode on or off for the dashboard"],
      ]
    ),

    h2("10.3 Widget Library"),
    table(
      ["Group", "Widgets"],
      [
        ["Charts", "Card, Line, Area, Bar, Stacked Bar, Horizontal Bar, Step Line, Stacked Area, Bar + Line, Radar, Radial Bar, Sparkline, Pie, Donut, Scatter, Heatmap"],
        ["Industrial", "Gauge, Thermometer, Tank Level, Progress Bar, Status Indicator, Traffic Light, Battery"],
        ["Tables", "Data Grid, Alarm Table"],
        ["Combined", "Combined Value"],
        ["Media & Controls", "Text, Image, Asset Selector, Button"],
      ]
    ),
    h3("Pro widgets"),
    p("104 additional widgets in thirteen groups:"),
    table(
      ["Set", "Groups"],
      [
        ["52 general widgets", "Charts Pro, Instruments, Equipment, Plant Status, Alarms & Operations, Analytics, Energy, Process"],
        ["52 equipment widgets", "Utilities, Process Equipment, Pharma & Cold Chain, HVAC & Water, Power & Facility"],
      ]
    ),
    p("Equipment widgets take named inputs (for example a chiller's supply and return temperatures) and show sample data until their inputs are bound."),

    h2("10.4 Configuring a Widget"),
    ol([
      "Add a widget from the library, or click Edit on an existing widget.",
      "Choose an asset and a metric. The metric list combines live telemetry tags and the asset's attributes.",
      "Add more series with 'Add Series'; each series can come from a different asset.",
      "Set a Label and UoM per series; they are used in the legend and tooltip.",
      "Optionally add SPC reference lines (below).",
      "Save.",
    ]),
    h3("SPC reference lines"),
    p("Line, Area, Bar, Stacked Bar, Step Line, Stacked Area and Bar + Line charts can show horizontal reference lines:"),
    table(
      ["Line", "Meaning", "Default style"],
      [
        ["UCL", "Upper Control Limit", "Red, dashed"],
        ["LCL", "Lower Control Limit", "Blue, dashed"],
        ["CL", "Center line / target", "Green, solid"],
      ]
    ),
    p("Each line has its own value, colour, style (solid, dashed, dotted) and label. Lines are for display only and do not raise alarms."),

    h2("10.5 Layout"),
    ul([
      "Drag a widget by its grip icon and drop it anywhere. A same-size widget underneath swaps places; others move down.",
      "Resize a widget from its bottom-right corner.",
      "Widgets move up to fill empty space after a move, resize, delete or duplicate.",
      "Dragging near the edge scrolls the canvas; Escape cancels a drag.",
      "Duplicate a widget from its menu; copy and paste widgets between dashboards.",
      "Save stores the dashboard. Read-only users cannot move or resize widgets.",
    ]),

    h2("10.6 Time Range and Refresh"),
    table(
      ["Control", "Options"],
      [
        ["Dashboard time range", "Last 1, 5, 15, 30 min; 1, 6, 12, 24 h; 3, 7, 30 days; 3, 6, 9 months; 1 year; WTD, MTD, YTD; custom From/To"],
        ["Per-widget clock", "Own range, granularity, aggregation and refresh interval"],
        ["Auto-refresh", "On/Off, default 20 s; 1 s to 1 day"],
        ["Fullscreen", "Whole dashboard or a single widget"],
      ]
    ),
    p("A status badge shows Live, Inactive or Connecting. Widgets update immediately when new telemetry arrives for their asset."),
    pb(),

    // ─── CHAPTER 11 ───────────────────────────────────────────────────────────
    h1("Chapter 11: Live Feed"),
    h2("11.1 Overview"),
    p("Data Studio > Live Feed (Live Operations Center) shows telemetry as it arrives over the live connection, without polling. Use it to watch data flow during commissioning and operation."),

    h2("11.2 Layout"),
    table(
      ["Element", "Content"],
      [
        ["Status badge", "Live or 'No live data'"],
        ["KPIs", "Assets Online, Connected Devices"],
        ["Live Asset Status", "Each asset with its latest values; stale after 30 s without data"],
        ["Live Sensor Feed", "Time, Asset, Sensor, Value, Status; search, asset filter, Export; 8 rows per page"],
        ["Asset Health Ranking", "Top Healthy and Needs Attention"],
        ["Live Event Timeline", "Recent platform events (not shown to project-restricted users)"],
      ]
    ),
    p("The page keeps the latest 1000 events in the browser."),
    pb(),

    // ─── CHAPTER 12 ───────────────────────────────────────────────────────────
    h1("Chapter 12: Audit Log"),
    h2("12.1 Overview"),
    p("The Audit Log records every change made in the application with the identity of the user or API client that performed it. The identity comes from the session or API key and cannot be supplied by the browser. Writes that a screen does not record itself are still recorded with the method, address and result, and failed or refused changes are recorded too."),

    h2("12.2 Logged Actions"),
    table(
      ["Category", "Actions"],
      [
        ["user", "invited, activated, updated, deleted, login, logout, access updated, invitation resent/revoked, password changed/reset/reset sent, password change required, temporary password issued, session limit changed, unlocked"],
        ["asset", "created, updated, deleted, maintenance enabled/disabled, attributes imported, template applied"],
        ["attributes", "created, updated, deleted"],
        ["alarm_rules", "created, updated, deleted, webhook tested"],
        ["export", "data downloaded through the export API (filters only, no data)"],
        ["template", "created, updated, deleted"],
        ["alarm", "acknowledged"],
        ["broker", "created, updated, deleted"],
        ["api_client", "created, updated, deleted, revoked, restored, secret rotated, ingest URL regenerated"],
        ["destination", "created, updated, deleted, tested"],
        ["visualization", "dashboard created, updated, deleted, shared, unshared, imported; twin created, updated, moved, deleted"],
        ["upload", "created, deleted"],
        ["security", "session revoked, all sessions revoked"],
        ["system", "retention policies and runs, data holds, bad-data removal and approvals, archives, settings, alerts, Vacuum"],
        ["ai", "question asked, report generated"],
        ["activity_log", "exported, verified, verify failed, settings changed, alert acknowledged"],
      ]
    ),

    h2("12.3 Entry Fields"),
    table(
      ["Field", "Description"],
      [
        ["Timestamp", "When the action happened"],
        ["Action, Category", "What happened"],
        ["Actor Name, Role, Username", "Who did it"],
        ["Target ID, Target Name", "What it was done to"],
        ["Detail", "Additional context"],
        ["Changes", "Before and after of each changed field; passwords, tokens and keys show as [redacted]"],
        ["Result", "success, failure or denied"],
        ["IP address, Device, Request reference", "Where the request came from and its reference"],
        ["Project", "The project of the asset concerned"],
        ["Hash", "Link in the tamper-evident chain"],
      ]
    ),

    h2("12.4 Search, Summary and Export"),
    ul([
      "Summary cards for the last 7 days: changes per day, most active users, sensitive actions, failed or denied actions.",
      "Search across all history (action, item, detail, person) with filters for date range, user, action, category (including AI, Export and Security), result and project or asset.",
      "Include security events merges sign-ins, refusals and rate limits into the list.",
      "Click an entry for every field and the before/after table of what changed.",
      "Export the filtered list as CSV (up to 50,000 rows, including the hash) or PDF (up to 2,000 rows). Each export is recorded.",
      "A History button on assets, alarm rules, users, brokers, destinations, API clients and the selected dashboard shows that item's own change history.",
    ]),

    h2("12.5 Tamper Evidence"),
    p("Entries cannot be changed or deleted through the application or the database: a database trigger refuses it. Each entry also carries a SHA-256 hash of the previous entry's hash and its own fields. Verify integrity (users with Manage security) checks the whole chain and reports the first entry that was changed or removed. The check itself is recorded, and a failed check raises an alert."),

    h2("12.6 Retention"),
    p("Audit entries are kept for at least 365 days (default 365, set in Audit Log > Settings; 0 keeps them for ever). Older entries are removed oldest first and the last removed hash is kept, so verification still works afterwards."),

    h2("12.7 Sensitive-Action Alerts"),
    p("These actions raise an alert in the notification bell for users with Security Settings access: alarm rule deleted or disabled, administrator role granted, user deleted, data deleted, API client secret rotated, audit integrity check failed, and 5 or more failed sign-ins for one user within 10 minutes. Each alert can be switched off in Audit Log > Settings and acknowledged from the bell."),
    note("Not available yet: sending audit alerts to notification groups (email). The earlier Audit Log page can be restored with VITE_CLASSIC_AUDIT_LOG=true."),
    pb(),

    // ─── CHAPTER 13 ───────────────────────────────────────────────────────────
    h1("Chapter 13: Live Twin"),
    h2("13.1 Overview"),
    p("Live Twin shows machines, processes and plants as twins driven by live asset data. A Twin type dropdown next to the title selects one type at a time. The saved twins of that type for the open project appear in a folder tree on the left; folders can be nested and twins dragged between them."),

    h2("13.2 Twin Types"),
    table(
      ["Type", "What it shows"],
      [
        ["2D twin", "An SVG drawing or any image whose parts or drawn regions are mapped to live readings"],
        ["Asset twin", "Machines from the library on a free 3D floor; includes close-up views (pump skid, wind turbine, solar PV plant, battery storage)"],
        ["Process twin", "P&ID builder: draw your own process diagram from 114 symbols or your own uploaded symbols, or start from an industry template, and link its tags to asset metrics"],
        ["Plant twin", "Saved plants in 3D, view only, with live tags, a legend and 'Edit in 3D Builder'"],
        ["3D Builder", "Plant editor with industry templates and the machine library"],
        ["Map view", "Every project on a map with its live status and active alarms"],
      ]
    ),
    p("Each installation can offer a subset of these types. Kiosk (top right) shows the open twin full screen for control-room displays and can cycle through the twins of that type every 60 seconds."),

    h2("13.3 Building a Twin"),
    ol([
      "The machine library is the panel on the left (Add twin shows or hides it): 83 machines in 14 groups, each machine a tile with a small 3D picture. Groups open with a click; search opens every group with a match. In the 3D Builder the industry template picker is at the top of the panel. For a single-machine POC, pick Detailed wind turbine, Detailed solar PV plant or Detailed battery storage (BMS) at the top: it opens that one machine in close-up as a new twin.",
      "Drag a machine tile from the left panel onto the view, or click it. The panel stays open while you add machines.",
      "Click the machine and link its readings to asset metrics in the Data Source panel. 'Link all readings to one asset' matches readings to that asset's metrics by name.",
      "In the 3D Builder, an industry template can load a complete plant layout.",
      "Duplicate a selected machine 1-50 times in a row or grid (for example a wind farm). Copies keep their settings and links, are numbered on (WTG-01, WTG-02...) and can be linked to the next-numbered assets.",
      "Press Save. The button is orange when not saved, light orange with unsaved changes, and grey when saved.",
    ]),

    h2("13.4 Viewing Tools"),
    ul([
      "X-ray, Auto-rotate and Heat map in 3D views. Heat map colours machines from blue to red by temperature against their limits.",
      "Labels, Fit (frame everything), full screen and live status in the toolbar.",
      "Live tags and trend graphs per reading.",
      "Demo values with a Scenario panel (Normal running, Machine fault, and where applicable Bearing overheat, Cavitation, Pump trip, Cloud cover, Storm / high wind, Low wind, Battery charging, Battery discharging). Scenarios move only demo values; linked readings always show plant data.",
      "Limits from alarm rules: a linked reading with enabled threshold rules in Event Manager is coloured by those limits (critical and high = alarm, other severities = warning); otherwise the model's own limits apply.",
      "Playback: replay the linked readings over the last 1, 6 or 24 hours with a time slider. Demo values are not recorded.",
      "Active alarms of the linked assets in the side panel; click one to show its machine, acknowledge where permitted.",
      "PNG snapshot of the current view.",
      "Customer 3D models: upload a .glb model, save it with the twin and pin readings onto its parts (uploading needs Visualization write).",
    ]),

    h2("13.5 Solar PV Plant"),
    p("Library group Renewable energy. Settings: rows (1-6), panels per row (4-16), mounting (fixed tilt or single-axis tracker) and balance of system (combiner, inverter, transformer and weather station, or panels only)."),
    table(
      ["Component", "Behaviour"],
      [
        ["Module rows", "Brighten with irradiance"],
        ["Single-axis tracker", "Rows tilt to the tracker angle and stow flat at 18 m/s wind"],
        ["Faulty string", "Blinks red when string current is below 60% of the expected value or performance ratio is below 75%"],
        ["Combiner box", "One LED per string; the faulty string's LED turns red"],
        ["DC and AC cables", "Particles flow with DC power and AC output"],
        ["Inverter", "Cooling fan turns with output; status LED shows the machine status"],
        ["Transformer", "Radiator fins and bushings"],
        ["Weather station", "Pyranometer, wind vane, anemometer turning with wind speed"],
      ]
    ),
    p("Readings: AC output, DC power, irradiance, performance ratio, string current, DC voltage, module temperature, ambient temperature, inverter temperature, inverter efficiency, wind speed and (with tracker) tracker angle."),

    h2("13.6 Wind Turbine"),
    p("Library group Renewable energy. Settings: size (0.6-2; rated power 1650 kW at size 1) and pad-mount transformer (yes or no)."),
    table(
      ["Component", "Behaviour"],
      [
        ["Rotor with three blades", "Turns with rotor speed; blades pitch to the blade pitch angle (88 degrees = feathered)"],
        ["Nacelle", "Yaws to the nacelle direction and shakes with vibration"],
        ["Drivetrain (visible with X-ray)", "Main bearing, gearbox and generator glow with their temperatures; brake disc, converter and cooler"],
        ["Anemometer and wind vane", "Turn with wind speed and point along the wind direction"],
        ["Aviation light", "Blinks red"],
        ["Pad-mount transformer", "Particles flow down the tower with active power"],
      ]
    ),
    p("Readings: active power, wind speed (cut-out 25 m/s), wind direction, nacelle direction, rotor speed, generator speed, blade pitch, gearbox oil temperature, generator winding temperature, main bearing temperature and nacelle vibration."),

    h2("13.7 Instruments and Meters"),
    p("Library group Instruments & meters. Each instrument has a display or needle that moves with its reading and shows alarm colours."),
    table(
      ["Model", "Readings"],
      [
        ["Energy meter", "Active power, energy, voltage, current, power factor, frequency"],
        ["Pressure gauge", "Pressure (needle with warning and alarm bands)"],
        ["Electromagnetic flow meter", "Flow, totaliser, conductivity, empty pipe"],
        ["Coriolis flow meter", "Mass flow, density, temperature, drive gain"],
        ["Vortex flow meter", "Flow, temperature, pressure, vortex frequency"],
        ["Temperature transmitter", "Temperature"],
        ["Radar level transmitter", "Level, distance to surface, signal strength"],
        ["Gas detector", "Gas concentration (beacon blinks above the warning limit)"],
        ["Control valve with positioner", "Position, set point, deviation, supply air"],
        ["VFD panel", "Frequency, current, power, DC bus voltage, heatsink temperature"],
      ]
    ),

    h2("13.8 Battery Energy Storage (BMS)"),
    p("Library group Renewable energy. A container with 2-10 battery racks, BMS controller, PCS and transformer (optional), HVAC units and a fire panel with strobe. Each rack shows its state of charge as a fill bar and turns hot with cell temperature; the strobe blinks on fault; the power flow runs in the direction of charge or discharge."),
    p("Readings: state of charge, state of health, power (+ discharge, - charge), DC voltage, DC current, highest and lowest cell voltage, cell voltage spread, highest and lowest cell temperature, rack temperature spread, insulation resistance, HVAC supply temperature, cycle count and BMS state (0 idle, 1 charging, 2 discharging, 3 fault)."),

    h2("13.9 2D Twin"),
    ol([
      "Click New, then upload or drop an SVG drawing or any image (PNG, JPEG, GIF, WebP, BMP, AVIF, ICO), or give an image address.",
      "SVG: every element with an id or layer name becomes a part; hover highlights it and a click selects it. Images: draw rectangle, ellipse or polygon regions, or place point pins.",
      "In the mapping panel, give each part an asset, a metric and one or more behaviours: show value, colour by status, fill level, colour scale, rotate, blink on alarm, show/hide, text for value ranges.",
      "Auto-match links parts to an asset's metrics by name (TT-101 matches tt101), with a preview. The mapping can be exported and imported as CSV.",
      "Press Save. 2D twins are stored on the server in the open project, like the 3D twins.",
    ]),
    note("SVG drawings are cleaned of scripts, event handlers and external links when imported and every time they are shown. 2D twins saved in the browser by the earlier version can be imported to the server once."),

    h2("13.10 Process Twin Builder"),
    ul([
      "Start blank or from one of eight industry templates: reactor cooling loop (sample), water treatment, boiler house / steam, compressed air, chiller plant, textile dyeing, pharma batch and oil separation (More > Replace with a template). Process twins from the earlier fixed diagram open as the sample with their links kept.",
      "114 symbols in 13 groups (each group opens with a click): vessels, rotating equipment, valves, heat transfer, instruments (ISA bubbles, switches, analysers, meters, VFD), water & effluent, solids handling, pharma & food, oil & gas, power & utilities, textile, other equipment and custom blocks (a labelled box for anything not in the library).",
      "My symbols: upload your own SVG drawing (up to 200 KB) or picture (PNG, JPEG, WebP, GIF) as a symbol with four connection points. It is cleaned, stored with each diagram that uses it and kept in this browser for other diagrams.",
      "Annotations: free text, an area/zone (dashed box with a title, drawn behind the symbols) and a line or arrow.",
      "Style and arrange: fill and line colour, label position and tag number per symbol, colour and label position per pipe; resize with the corner handle, flip, align and distribute several items, and lock an item so it cannot be moved or deleted.",
      "Pipes connect port to port with horizontal and vertical runs and movable bends; line types process, utility, signal and electrical; colour by medium; flow arrows.",
      "Tag bubbles on symbols or pipes are linked to asset metrics with unit, decimals and limits.",
      "Live: flow dashes follow flow, tanks fill with level, rotors turn with speed, valves shade with opening, heat equipment glows with temperature, symbols pulse on warning or alarm.",
      "Grid and snapping, zoom and pan, multi-select, rotate, copy and paste, undo and redo, JSON export and import, demo scenarios.",
    ]),

    h2("13.11 Map View"),
    p("Map view shows every project the user may open as a marker: red for an active critical or high alarm, amber for other active alarms, green when data arrived in the last 15 minutes, grey otherwise. Click a site for its alarms, asset count and last data, and to open the project, its Live Twin or Visualization."),
    p("A project's location is the static attributes Latitude, Longitude and (optional) Address on the project asset. Users with Asset write can place a site from the map. The base map is bundled and works offline; the optional Street map needs internet access and https://tile.openstreetmap.org in the nginx img-src policy."),

    h2("13.12 Dashboard Widgets"),
    p("Visualization has a Maps & twins widget category: Sites Map (the map, view-only) and Live Twin (a saved 2D, process, asset or plant twin, view-only with live values)."),
    note("Not available yet: sharing a twin with edit rights (only the owner or an administrator can change it), playback and the alarm list on the detailed pump skid, and automatic pipe routing in the Process twin."),
    pb(),

    // ─── CHAPTER 14 ───────────────────────────────────────────────────────────
    h1("Chapter 14: AI Advisor"),
    h2("14.1 Overview"),
    p("AI Advisor has two pages in the menu: Advisor, which answers questions about the plant in plain language, and AI Reports (14.2). Advisor reads assets, attributes, telemetry and alarms through read-only tools and never changes data. Each answer shows the steps (tools) it used."),
    table(
      ["Mode", "Use"],
      [
        ["Ask Your Assets", "Free questions, e.g. 'Which pumps ran hot this week?'"],
        ["Health Insights", "Summary of asset health and stale data"],
        ["Failure Explanations", "Likely causes of active and recent alarms"],
        ["Smart Recommendations", "Suggested actions based on readings and alarms"],
      ]
    ),
    p("A From/To range limits the period the answer looks at. Example prompts help to start."),
    p("The Ask about panel on the left holds Project or asset, From and To. Project or asset limits the answer to one project, or to one asset and the assets beneath it. It starts on the open project; All assets asks about everything you can see. The choice is shown above the conversation (Asking about: ...) and applies to each question, so it can be changed between questions. Advisor then only looks up readings, alarms and assets inside that choice and says so when asked about anything else."),
    note("AI Advisor is a licensed feature that needs an internet connection. Answers come from a model hosted by Groq (the provider may change); the server needs GROQ_API_KEY. Questions are rate limited, answers respect your project access, and alarm data also needs the Alarms module."),

    h2("14.2 AI Reports"),
    p("AI Advisor > AI Reports writes one report for the reader's level. The level comes from the user's role; there is no report-type list to choose from."),
    table(
      ["Level", "Roles", "Content"],
      [
        ["Executive", "Super Admin, Company Admin, Project Manager", "1-2 pages (PDF at most 5) for a meeting: headline, 4-6 key figures against the previous period, top 3 risks (what, why it matters, likely cause, recommended decision), what improved, decisions needed, outlook"],
        ["Manager", "Admin, Team Lead, Viewer (and any other role)", "Problem areas ranked by impact with causes, response times (MTTA, MTTR) and their trend, patterns (repeat alarms, time of day, maintenance), team priorities with a suggested owner"],
        ["Engineer", "Engineer, Developer, Operator", "Diagnosis per asset (abnormal readings, related metrics, likely root cause with confidence), alarm sequence, sensor and data issues, maintenance actions with urgency"],
      ]
    ),
    ol([
      "Choose a project or asset (or all assets you can see) and a period: last 24 hours, 7 days, 30 days or Custom (at most 92 days).",
      "Click Generate. The report opens as a document with sections, key figure cards and charts.",
      "Edit text changes the AI-written sections before export. Export as PDF (with the edited text) or CSV (every figure).",
    ]),
    p("The server computes every figure from the database: readings, data coverage, minimum, average and maximum per metric with the change against the previous period of the same length, energy used, a plant health score (0-100), asset status, metrics that moved together (correlation of 0.7 or more), readings that were away from normal just before alarms, repeat alarms (3 or more), alarm times by hour and weekday in your time zone, maintenance time, stale and silent assets and possibly stuck sensors. Alarm figures need the Alarms module."),
    p("Plant health score = 40 x availability (share of monitored assets that sent data) + 30 x data coverage + 30 x 1 / (1 + weighted alarms per asset per day), with weights critical 3, high 2, medium 1, low and info 0.5."),
    p("Only the figures the level needs are sent to the AI service, without asset ids. It explains why things happened from those figures and may not invent numbers; numbers in its text that are not among the figures are listed as 'check before sharing'."),
    ul([
      "AI Advisor is licensed and needs an internet connection. Without them the report still shows every figure and chart with the note 'AI insights are not available right now'. A temporary AI failure shows a Retry button.",
      "The PDF is in English, as the AI text is; characters outside Latin-1 print as '?'. The CSV keeps them.",
      "Reports run on demand; scheduled reports do not exist yet. Each report is written to the Audit Log.",
    ]),
    pb(),

    // ─── CHAPTER 15 ───────────────────────────────────────────────────────────
    h1("Chapter 15: Role-Based Access Control"),
    h2("15.1 Overview"),
    p("Access is decided by the API server on every request. A route without a rule is refused, and every refusal is written to the security event log. The web application hides or disables what you cannot use, for convenience only."),

    h2("15.2 Roles"),
    table(
      ["Permission", "Super Admin / Company Admin / Admin", "Engineer / Developer", "Project Manager / Team Lead / Operator", "Viewer"],
      [
        ["View pages of granted modules", "Yes", "Yes", "Yes", "Yes"],
        ["Manage assets", "Yes", "Yes", "-", "-"],
        ["Manage templates", "Yes", "Yes", "-", "-"],
        ["Manage alarm rules", "Yes", "Yes", "-", "-"],
        ["Acknowledge alarms", "Yes", "Yes", "Yes", "-"],
        ["Manage brokers and destinations", "Yes", "Yes", "-", "-"],
        ["Manage API clients", "Yes", "Yes", "-", "-"],
        ["Manage users", "Yes", "-", "-", "-"],
        ["Manage security", "Yes", "-", "-", "-"],
      ]
    ),
    ul([
      "The three administrator roles differ in rank: only a Super Admin can manage a Company Admin, and a Company Admin can never change a Super Admin.",
      "Developer has Engineer rights on assigned projects only.",
      "Project access is described in Chapter 3.2.",
    ]),

    h2("15.3 Modules"),
    p("Each page area is a module with Read, Write and Delete levels, set by role defaults and per-user overrides (Governance > User > Access Control). Live Twin, AI Advisor and Data Management are modules of their own; each started with the access of the module it was part of."),

    h2("15.4 Read-only Display"),
    p("Where your role cannot change data, controls are hidden or greyed out and a read-only banner explains why."),
    pb(),

    // ═══════════════════════════════════════════════════════════════════════════
    //  PART II — TECHNICAL DOCUMENTATION
    // ═══════════════════════════════════════════════════════════════════════════
    h1("PART II - TECHNICAL DOCUMENTATION"),
    pb(),

    // ─── CHAPTER 16 ───────────────────────────────────────────────────────────
    h1("Chapter 16: Architecture Overview"),
    h2("16.1 Monorepo Structure"),
    code("text", `artifacts/
  api-server/        Express 5 REST + WebSocket API (port 8080, path /api)
  iot-platform/      React 19 + Vite single-page application (path /)
lib/
  api-spec/          OpenAPI 3.1 specification + Orval code generation
  api-client-react/  Generated TanStack Query hooks + fetch client
  api-zod/           Generated Zod schemas
  db/                Drizzle ORM schema (one file per table) + seed
scripts/             Utility and operations scripts
docs/                Architecture, API, security and operations documentation`),
    p("The application packages never import each other. The API server uses lib/db and lib/api-zod; the web application uses lib/api-client-react."),

    h2("16.2 Technology Stack"),
    table(
      ["Layer", "Technology"],
      [
        ["Language", "TypeScript"],
        ["Frontend", "React 19, Vite 7, Tailwind CSS 4, wouter routing, TanStack Query 5"],
        ["Charts and 3D", "Recharts 2, three.js"],
        ["Document export", "jsPDF (PDF) and docx (Word), in the browser"],
        ["Backend", "Node.js, Express 5, built with esbuild"],
        ["Database", "PostgreSQL with Drizzle ORM and the pg driver"],
        ["Validation", "Zod 3 (generated from the OpenAPI spec)"],
        ["Real time", "ws WebSocket server at /api/ws"],
        ["MQTT", "mqtt.js 5"],
        ["Other", "pino logging, nodemailer email, expr-eval expressions"],
        ["Workspace", "pnpm monorepo with a shared version catalogue"],
      ]
    ),

    h2("16.3 Deployment and Routing"),
    table(
      ["Path", "Served by"],
      [
        ["/api/* and /api/ws", "nginx proxies to the API server on port 8080"],
        ["/*", "nginx serves the built web application"],
      ]
    ),
    p("The API runs as exactly one Node.js process per installation. Rate-limit counters, MQTT connections, alarm delay timers and WebSocket clients live in that process."),

    h2("16.4 API Contract"),
    p("lib/api-spec/openapi.yaml is the source of truth. Orval generates the React hooks and the Zod schemas from it; generated files are never edited by hand."),
    code("bash", "pnpm --filter @workspace/api-spec run codegen"),

    h2("16.5 Background Jobs"),
    table(
      ["Job", "Interval"],
      [
        ["MQTT subscribers", "Started at boot; reconnect automatically"],
        ["Telemetry summaries (15 min and hourly)", "Every 10 minutes"],
        ["Storage alerts", "Every 10 minutes"],
        ["Refused-ingest counters flush", "Every 30 seconds"],
        ["Retention, expired sessions, old security events", "Every hour"],
        ["Security-event coalescing flush", "Every 15 seconds"],
        ["WebSocket heartbeat", "Every 30 seconds"],
        ["Future telemetry partitions (when partitioned)", "At boot"],
      ]
    ),
    pb(),

    // ─── CHAPTER 17 ───────────────────────────────────────────────────────────
    h1("Chapter 17: Database Schema Reference"),
    h2("17.1 Overview"),
    p("PostgreSQL schema defined with Drizzle ORM in lib/db/src/schema and applied with 'pnpm --filter @workspace/db run push'. There is no company column: each company has its own database."),

    h2("17.2 assets"),
    table(
      ["Column", "Description"],
      [
        ["id", "UUID primary key"],
        ["name", "Display name"],
        ["identifier", "Device ID matched against payload deviceId (case-sensitive)"],
        ["parentId", "Parent asset; null for a project (root)"],
        ["templateId, templateName", "Template the asset was built from"],
        ["description, tags", "Free text"],
        ["childCount, attributeCount", "Cached counts"],
        ["maintenanceMode, maintenanceSince, maintenanceNote", "Maintenance state"],
        ["createdAt, updatedAt", "Timestamps"],
      ]
    ),

    h2("17.3 attributes"),
    table(
      ["Column", "Description"],
      [
        ["id, assetId", "Keys"],
        ["name, tagName, sourceMetric", "Name and payload binding"],
        ["type", "static | dynamic | metric | timestamp"],
        ["dataType", "text | number | double | boolean | timestamp"],
        ["value", "Current value (JSONB)"],
        ["uom, decimalPlaces, thousandSeparator", "Display formatting"],
        ["quality, timestamp", "Quality and last update"],
        ["expression", "Formula for runtime values"],
        ["sortOrder, createdAt, updatedAt", "Ordering and timestamps"],
      ]
    ),

    h2("17.4 asset_templates"),
    table(
      ["Column", "Description"],
      [
        ["id, name", "Keys and name"],
        ["deviceId", "Device ID the template binds"],
        ["tags, attributeCount", "Metadata"],
        ["attributeDefinitions", "JSONB array of attribute definitions"],
        ["createdAt, updatedAt", "Timestamps"],
      ]
    ),

    h2("17.5 telemetry"),
    table(
      ["Column", "Description"],
      [
        ["id", "UUID primary key"],
        ["assetId, deviceId", "Asset and device"],
        ["metric", "Metric key, e.g. Unit 1.Chiller.powerKW"],
        ["value", "Reading (JSONB; numbers, text or booleans)"],
        ["quality", "good | uncertain | bad"],
        ["timestamp", "Measurement time"],
      ]
    ),
    p("Indexes: (asset_id, metric, timestamp), (timestamp), (asset_id, timestamp). The table can optionally be partitioned by month."),

    h2("17.6 Alarms"),
    table(
      ["Table", "Columns"],
      [
        ["alarm_rules", "id, name, description, assetId, alarmType, severity, metric, operator, threshold, deadband, onDelay, offDelay, scanRate, rocWindow, enabled, requireAcknowledge, webhookUrl, webhookEnabled, createdAt, updatedAt"],
        ["alarms", "id, name, assetId, assetName, ruleId, severity, status (active | acknowledged | cleared), alarmClass, message, triggerValue, triggeredAt, acknowledgedAt, clearedAt; at most one open alarm per rule and asset"],
        ["alarm_history", "id, alarmId, assetId, assetName, name, severity, status, triggeredAt, acknowledgedAt, clearedAt"],
      ]
    ),

    h2("17.7 Users and Security"),
    table(
      ["Table", "Columns"],
      [
        ["users", "id, username, email, fullName, role, status (invited | active | suspended | inactive), maxSessions, passwordHash, passwordUpdatedAt, mustChangePassword, passwordExpiresAt, invitedAt, invitedBy, activatedAt, failedLoginAttempts, lockedUntil, lastLogin, lastLoginIp, accessOverrides, createdAt"],
        ["sessions", "id, userId, tokenHash, csrfToken, ip, userAgent, createdAt, lastSeenAt, expiresAt, absoluteExpiresAt, revokedAt, revokedReason"],
        ["auth_tokens", "id, userId, type (activation | password_reset), tokenHash, expiresAt, consumedAt, revokedAt, createdBy, createdIp, createdAt"],
        ["security_events", "id, userId, username, eventType, outcome, reason, ip, userAgent, detail, createdAt"],
        ["activity_logs", "id, seq, action, category, actorUserId, actorName, actorRole, actorUsername, targetId, targetName, detail, changes (JSONB before/after), outcome, ip, userAgent, correlationId, assetId, projectId, prevHash, hash, timestamp. Append-only: a database trigger refuses edits and deletes except the retention job"],
        ["audit_alerts", "Sensitive-action alert rules (key, enabled) and the alerts they raised"],
      ]
    ),

    h2("17.8 Integration"),
    table(
      ["Table", "Columns"],
      [
        ["brokers", "id, name, type (mqtt | rest_api | azure_iot | azure_event_hub), endpoint, status, connectedDevices, totalRequests, tags, mqttUsername, mqttPassword (encrypted), mqttTopic, mqttClientId, mappingRules, createdAt, updatedAt"],
        ["broker_events", "id, brokerId, brokerName, status, message, timestamp"],
        ["api_clients", "id, name, description, clientId, clientSecretHash, projectId, ingestTokenHash, ingestTokenEnc, ingestTokenIssuedAt, tags, scopes, status, allowedIps, expiresAt, secretRotatedAt, totalRequests, lastUsedAt, createdAt, updatedAt"],
        ["destinations", "id, name, description, endpoint, authType, token, secretKey, apiKeyHeader, basicUser, basicPass, eventTypes, enabled, lastSentAt, lastError, sendCount, createdAt, updatedAt"],
        ["seen_devices", "deviceId, lastSeen, count, matched, createdAt"],
      ]
    ),

    h2("17.9 Visualization, Twins and Media"),
    table(
      ["Table", "Columns"],
      [
        ["viz_nodes", "id, name, parentId, widgets (JSONB dashboard), ownerId, projectId, createdAt, updatedAt"],
        ["viz_node_shares", "nodeId, userId, canRead, canWrite, canDelete, grantedBy, createdAt, updatedAt"],
        ["plant_twins", "id, name, projectId, ownerId, scene (JSONB; folders use scene.kind = folder), createdAt, updatedAt"],
        ["uploads", "id, originalName, extension, mimeType, sizeBytes, sha256, width, height, scan status, uploadedBy, uploadedByName, createdAt"],
      ]
    ),

    h2("17.10 Data Management"),
    table(
      ["Table", "Holds"],
      [
        ["data_retention_policies", "id, name, assetId, metric, retentionDays, enabled, lastPrunedAt, rowsPruned, createdAt, updatedAt"],
        ["telemetry_rollups, telemetry_rollups_15m", "Hourly and 15-minute summaries per asset and metric (rows, n, sum, min, max)"],
        ["retention_runs", "One row per pruning run with deletions and errors"],
        ["data_holds", "Legal holds"],
        ["data_archives", "One row per archived day with file path and SHA-256"],
        ["data_change_requests", "Bad-data removals and approvals"],
        ["backup_runs", "Backups reported by the backup script"],
        ["system_alerts", "Open storage and data alerts"],
        ["ingest_rejections", "Refused ingest requests per hour, source and reason"],
        ["job_state", "Progress of background jobs and data settings"],
      ]
    ),
    pb(),

    // ─── CHAPTER 18 ───────────────────────────────────────────────────────────
    h1("Chapter 18: REST API Reference"),
    h2("18.1 Base URL and Authentication"),
    code("text", "https://<platform-address>/api/<endpoint>"),
    ul([
      "Session - HttpOnly cookie created at sign-in. Writes (POST, PUT, PATCH, DELETE) also need the x-csrf-token header.",
      "API key - Authorization: Bearer <secret> or X-API-Key: <secret>, for ingest and export routes.",
      "Public - sign-in, activation, password reset, /healthz, /readyz, /export/health, /export/schema.",
    ]),

    h2("18.2 Auth and Security"),
    table(
      ["Method", "Path", "Description"],
      [
        ["POST", "/auth/login, /auth/logout", "Sign in / out"],
        ["GET", "/auth/session", "Current user, permissions and CSRF token"],
        ["GET", "/auth/password-policy", "Password rules"],
        ["GET, POST", "/auth/activation/:token, /auth/activate", "Check a link / activate an account"],
        ["POST, GET, POST", "/auth/forgot-password, /auth/reset/:token, /auth/reset-password", "Password reset"],
        ["POST", "/auth/change-password", "Change own password"],
        ["GET", "/security/summary, /security/events, /security/login-history, /security/sessions, /security/rbac-catalog", "Security Center data"],
        ["DELETE", "/security/sessions/:id, /security/users/:id/sessions", "Revoke sessions"],
      ]
    ),

    h2("18.3 Users"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET, POST", "/users", "List / invite"],
        ["GET, PUT, DELETE", "/users/:id", "Read / update / delete"],
        ["GET, PUT", "/users/:id/access", "Access overrides"],
        ["POST", "/users/:id/resend-invitation, /revoke-invitation, /send-password-reset, /temporary-password, /unlock, /require-password-change", "Account actions"],
        ["PUT", "/users/:id/session-limit", "Simultaneous sessions"],
      ]
    ),

    h2("18.4 Assets, Attributes and Templates"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET, POST", "/assets", "List / create"],
        ["GET, PUT, DELETE", "/assets/:id", "Read / update / delete with subtree"],
        ["POST", "/assets/:id/maintenance", "Maintenance on or off ({ enabled, note? })"],
        ["POST", "/assets/:id/apply-template", "Apply a template"],
        ["GET, POST", "/assets/:id/attributes", "List / add attributes"],
        ["POST", "/assets/:id/attributes/bulk", "Add many attributes"],
        ["PUT, DELETE", "/attributes/:id", "Update / delete an attribute"],
        ["GET", "/assets/:assetId/health", "Health: ok, alarm or stale, freshness, active alarms, last seen"],
        ["GET, POST", "/asset-templates", "List / create templates"],
        ["GET, PUT, DELETE", "/asset-templates/:id", "Read / update / delete a template"],
      ]
    ),

    h2("18.5 Telemetry and Ingest"),
    table(
      ["Method", "Path", "Description"],
      [
        ["POST", "/ingest/payload", "One payload or an array of payloads"],
        ["POST", "/ingest/batch", "Array of payloads"],
        ["POST", "/ingest/validate", "Dry run, nothing stored"],
        ["POST", "/ingest/k/:clientId/{payload,batch,validate}", "Same, bound to one API client"],
        ["POST", "/ingest/e/:token/{payload,batch,validate}", "Same, authenticated by the token in the URL"],
        ["POST", "/ingest/register-device", "Record a device id"],
        ["GET, DELETE, POST", "/ingest/seen-devices, /ingest/seen-devices/:deviceId, /ingest/seen-devices/prune", "Devices seen by ingest"],
        ["GET", "/telemetry/:assetId", "Readings (metric, from, to, limit)"],
        ["GET", "/telemetry/:assetId/metrics", "Metric keys of an asset"],
        ["GET", "/telemetry/:assetId/export", "CSV export"],
      ]
    ),

    h2("18.6 Alarms"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET", "/alarms", "Alarms (severity, status, limit)"],
        ["POST", "/alarms/:id/acknowledge", "Acknowledge an active alarm"],
        ["GET", "/alarm-history", "Paginated history"],
        ["GET, POST", "/alarm-rules", "List / create rules"],
        ["PUT, DELETE", "/alarm-rules/:id", "Update / delete a rule"],
        ["POST", "/alarm-rules/:id/test-webhook", "Send a test webhook"],
      ]
    ),

    h2("18.7 Integration"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET, POST", "/brokers", "List / create brokers"],
        ["PUT, DELETE", "/brokers/:id", "Update / delete a broker"],
        ["GET", "/brokers/:id/history", "Connection history (up to 500)"],
        ["GET, POST", "/destinations", "List / create destinations"],
        ["PUT, DELETE", "/destinations/:id", "Update / delete"],
        ["POST", "/destinations/:id/test", "Send a test event"],
        ["GET, POST", "/api-clients", "List / create API clients"],
        ["GET", "/api-clients/projects", "Projects a client can be assigned to"],
        ["PUT, DELETE", "/api-clients/:id", "Update / delete"],
        ["POST", "/api-clients/:id/rotate-secret, /regenerate-ingest-url, /revoke, /restore", "Client actions"],
      ]
    ),

    h2("18.8 Visualization, Twins, Media and AI"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET, POST", "/viz-nodes", "Dashboards the caller may see / create"],
        ["PUT, DELETE", "/viz-nodes/:id", "Update / delete a dashboard"],
        ["POST", "/viz-nodes/import", "Import dashboards"],
        ["GET, PUT, DELETE", "/viz-nodes/:id/shares, /viz-nodes/:id/shares/:userId", "Sharing"],
        ["GET", "/viz-tags", "Metric choices for widgets"],
        ["GET, POST", "/plant-twins", "List / create twins"],
        ["GET, PUT, DELETE", "/plant-twins/:id", "Read / update / delete a twin"],
        ["POST", "/plant-twins/values", "Latest values for up to 500 asset+metric pairs"],
        ["GET", "/sites", "Projects with location, asset counts and newest data time (Map view)"],
        ["GET, POST", "/uploads", "List / upload images, PDF, CSV and .glb 3D models"],
        ["GET, DELETE", "/uploads/:id/content, /uploads/:id", "File content / delete"],
        ["POST", "/ai/chat", "AI Advisor question"],
        ["POST", "/ai/report", "AI Reports: computed figures plus an AI narrative for the caller's level (figures only without an AI provider)"],
      ]
    ),

    h2("18.9 Dashboard Data, System and Audit"),
    table(
      ["Method", "Path", "Description"],
      [
        ["GET", "/dashboard/summary, /recent-telemetry, /alarm-stats, /attention, /health-index, /alarm-trend, /ingest-series, /live-metrics", "Plant-wide figures used by pages and widgets"],
        ["GET", "/system/aggregate", "Time buckets (5m to 1w) with avg, min, max"],
        ["GET", "/system/storage, /system/storage/all", "Storage, growth and disk"],
        ["GET, POST, PUT, DELETE", "/system/retention, /system/retention/:id", "Retention policies"],
        ["POST", "/system/retention/run, /system/retention/preview", "Run now / estimate"],
        ["GET", "/system/retention/runs, /system/retention/runs/:id/report", "Pruning history / CSV"],
        ["GET", "/system/data-health, /system/db-health", "Data and database health"],
        ["GET, PUT", "/system/data-settings", "Data Management settings"],
        ["GET, POST", "/system/alerts, /system/holds, /system/archives, /system/backups, /system/changes", "Alerts, legal holds, archives, backups, bad-data removal"],
        ["GET", "/activity-log", "Audit Log search (q, from, to, actor, action, category, outcome, targetId, assetId, includeSecurity, limit, offset)"],
        ["GET", "/activity-log/export, /activity-log/summary", "Filtered audit log as CSV; 7-day summary"],
        ["GET", "/activity-log/verify", "Check the hash chain (Manage security)"],
        ["GET, PUT", "/activity-log/settings", "Audit retention (at least 365 days) and alert switches (Manage security)"],
        ["GET, POST", "/activity-log/alerts, /activity-log/alerts/:id/acknowledge", "Sensitive-action alerts"],
      ]
    ),

    h2("18.10 Export (API Key)"),
    table(
      ["Method", "Path", "Scope", "Description"],
      [
        ["GET", "/export/assets", "read:assets", "Assets with current attribute values"],
        ["GET", "/export/telemetry", "read:telemetry", "Readings"],
        ["GET", "/export/alarms", "read:alarms", "Alarms"],
        ["GET", "/export/alarm-history", "read:alarm-history", "Alarm history"],
        ["GET", "/export/health", "None", "Status and time; figures only for signed-in, unrestricted users"],
        ["GET", "/export/schema", "None", "Export schema"],
      ]
    ),
    p("Project-assigned keys only receive their project's data."),

    h2("18.11 Health"),
    table(
      ["Path", "Response"],
      [
        ["/healthz", "200 { status: ok } while the process runs"],
        ["/readyz", "200 { status: ok, database: ok }, or 503 when the database does not respond"],
      ]
    ),

    h2("18.12 Error Format"),
    table(
      ["Status", "Example codes", "Meaning"],
      [
        ["400", "missing_device_id, body_not_json", "Request rejected"],
        ["401", "authentication_required, session_expired", "Not signed in or no valid key"],
        ["403", "insufficient_permission, csrf_failed, project_forbidden", "Not allowed"],
        ["409", "pruning_in_progress, hold_conflict", "Conflict"],
        ["413", "-", "Body over 1 MB"],
        ["429", "-", "Rate limited (Retry-After header)"],
      ]
    ),
    pb(),

    // ─── CHAPTER 19 ───────────────────────────────────────────────────────────
    h1("Chapter 19: Data Ingestion Pipeline"),
    h2("19.1 Overview"),
    p("Every payload, from HTTP or MQTT, passes through the same two steps: normalise(body) detects the format and extracts deviceId, timestamp and metrics; processNormalised() stores and evaluates them."),

    h2("19.2 Payload Formats"),
    table(
      ["Format", "Shape", "Metric keys"],
      [
        ["flat", "Metrics beside deviceId at the root", "field"],
        ["nested-metrics", "{ deviceId, metrics: { ... } }", "field"],
        ["nested-data", "{ deviceId, data: { ... } } with optional sensor, asset and measurement point names", "field"],
        ["nested-root", "Objects and arrays below the root", "Dot-joined path; array items keyed by their machine or name field"],
      ]
    ),
    code("json", `{
  "deviceId": "demo-pump-001",
  "timestamp": "2026-11-20T10:30:00Z",
  "metrics": { "temperature": 72.4, "vibration": 2.1 }
}`),
    p("Timestamps: epoch seconds or milliseconds, or an ISO date-time (a space instead of T is accepted). Fields are read in the order timestampUnix, capturedAt, receivedAt, timestamp. A time more than 5 minutes in the future is ignored and server time is used."),

    h2("19.3 Processing Steps"),
    ol([
      "Find the asset whose identifier equals deviceId (case-sensitive). The device id is recorded as seen either way.",
      "If no asset matches, nothing is stored: the answer is HTTP 200 with matched: false and a message.",
      "Check project scope for project-bound keys and restricted users (HTTP 403 out_of_project_scope).",
      "Store the readings; blank values are stored with quality 'bad'.",
      "Update matching attributes, then recalculate runtime expressions.",
      "Unless the asset is in maintenance, evaluate its enabled alarm rules; send webhooks and forward alarm events to destinations.",
      "Broadcast telemetry and alarm events over the WebSocket.",
    ]),

    h2("19.4 Responses"),
    table(
      ["Endpoint", "Fields"],
      [
        ["/ingest/payload (single)", "success, recordsWritten, assetId, assetName, machinesAttributed, matched, message, alarmsTriggered, alarmsCleared, alarmEvents"],
        ["/ingest/payload (array)", "success, items, matched, rejected, outOfScope, recordsWritten, message, alarmsTriggered, alarmsCleared, alarmEvents"],
        ["/ingest/batch", "success, totalRecords, successCount, failureCount, outOfScopeCount, alarmsTriggered, alarmsCleared"],
        ["/ingest/validate", "valid, deviceId, assetId, assetName, assetMatched, timestamp, payloadFormat, extractedMetrics, metricCount, warnings"],
      ]
    ),
    p("Request bodies are limited to 1 MB; there is no separate item limit for arrays. Refused requests are counted for Data Management > Data health."),

    h2("19.5 Ingest URLs"),
    table(
      ["URL", "Authentication"],
      [
        ["/api/ingest/payload", "Key with ingest:write in a header, or a session with the Broker module"],
        ["/api/ingest/k/:clientId/payload", "That client's key in a header"],
        ["/api/ingest/e/:token/payload", "Token in the URL, for gateways that accept only a URL; regenerate it to revoke"],
      ]
    ),
    code("bash", `curl -X POST https://<platform-address>/api/ingest/payload \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: <client-secret>" \\
  -d '{"deviceId":"demo-pump-001","metrics":{"temperature":72.4}}'`),
    note("Keys in the query string (?key=...) are ignored unless the server sets API_KEY_ALLOW_QUERY_PARAM=true, because proxies write full URLs to their logs."),
    pb(),

    // ─── CHAPTER 20 ───────────────────────────────────────────────────────────
    h1("Chapter 20: MQTT Integration"),
    h2("20.1 How It Works"),
    ol([
      "At start-up the API connects to every broker of type mqtt.",
      "It subscribes to the broker's topic with QoS 1 and a persistent session under a stable client id, so the broker keeps messages while the platform restarts.",
      "Each message is parsed as JSON, mapping rules rename fields, and the payload enters the ingest pipeline (Chapter 19).",
      "At most 4 messages per broker are processed at once.",
      "Connection changes are stored in broker_events and broadcast as broker_status events.",
    ]),

    h2("20.2 Topic Wildcards"),
    table(
      ["Wildcard", "Meaning", "Example"],
      [
        ["+", "Exactly one level", "plant/+/sensors matches plant/chiller/sensors"],
        ["#", "All remaining levels", "plant/# matches plant/chiller/sensors"],
      ]
    ),

    h2("20.3 Mapping Rules"),
    code("json", `// rule
{ "from": "temp", "to": "temperature" }
// incoming
{ "deviceId": "sensor-01", "temp": 72.4 }
// processed as
{ "deviceId": "sensor-01", "temperature": 72.4 }`),

    h2("20.4 Error Handling"),
    p("Connection failures are logged in the broker history and never stop the API. The client reconnects automatically. Saving a broker restarts only that broker's connection."),
    pb(),

    // ─── CHAPTER 21 ───────────────────────────────────────────────────────────
    h1("Chapter 21: Expression Engine"),
    h2("21.1 Purpose"),
    p("Runtime values are calculated from other attributes of the same asset, e.g. power from voltage and current, without code."),

    h2("21.2 Syntax"),
    ul([
      "Arithmetic: + - * / ^ %",
      "Comparison: == != < > <= >=",
      "Logic: and, or, not; conditional: condition ? a : b",
      "Functions: abs, ceil, floor, round, sqrt, log, exp, min, max, sin, cos, tan",
    ]),
    p("Expressions are evaluated with the expr-eval library, which cannot run code or access files."),

    h2("21.3 Variables and Timing"),
    p("Every numeric attribute of the asset is available under its Tag Name. Runtime values are recalculated on each incoming payload, after the measured attributes are updated. Blank readings are never treated as 0."),

    h2("21.4 Examples"),
    table(
      ["Use", "Expression"],
      [
        ["Power (kW)", "voltage * current / 1000"],
        ["COP", "cooling_kW / power_kW"],
        ["Energy cost", "energy_kWh * tariff_rate"],
        ["Temperature difference", "outlet_temp - inlet_temp"],
        ["Load factor (%)", "actual_load / rated_load * 100"],
      ]
    ),
    pb(),

    // ─── CHAPTER 22 ───────────────────────────────────────────────────────────
    h1("Chapter 22: Alarm Rules Engine"),
    h2("22.1 Evaluation"),
    ul([
      "Rules are evaluated on every incoming payload for the asset; enabled rules are cached for 5 seconds.",
      "Rule types evaluated: threshold and rate_of_change.",
      "Operators: gt, lt, gte, lte, eq, ne.",
      "Assets in maintenance are skipped.",
      "Blank or non-numeric readings are not evaluated.",
      "Late readings are handled; readings more than 5 minutes in the future use server time.",
    ]),

    h2("22.2 Threshold"),
    p("The alarm raises when 'value operator threshold' is true for at least On Delay seconds (payload time). It clears when the condition has ended for Off Delay seconds; for high and low operators the value must also move back past the deadband."),

    h2("22.3 Rate of Change"),
    p("rate = |value - previous value| / seconds between them, using the previous numeric reading of the same asset and metric. The rate is compared with the threshold."),

    h2("22.4 Lifecycle Rules"),
    ul([
      "One open alarm per rule and asset.",
      "Acknowledging changes the status to acknowledged and records the time in alarm history.",
      "Disabling, changing or deleting a rule clears its open alarms (reason rule_changed).",
      "On raise and clear: rule webhook (if enabled), destinations subscribed to alarm, WebSocket alarm event.",
    ]),
    note("On Delay and Off Delay timers live in the API process; after a restart a running delay starts again."),
    pb(),

    // ─── CHAPTER 23 ───────────────────────────────────────────────────────────
    h1("Chapter 23: WebSocket Protocol"),
    h2("23.1 Connection"),
    code("text", "wss://<platform-address>/api/ws"),
    p("The connection is authenticated by the session cookie and checks the browser origin. On connect the server sends { type: 'connected' }. All messages have the form { type, data }. The server sends a heartbeat every 30 seconds and closes a user's connections when the user is suspended or their access changes."),

    h2("23.2 Event Types"),
    table(
      ["type", "data", "Who receives it"],
      [
        ["telemetry", "assetId, assetName, metrics, timestamp", "Users with access to the asset's project"],
        ["alarm", "event (triggered | cleared | acknowledged), alarmId, ruleName, metric, value, threshold, operator, severity, assetId, assetName, timestamp", "Users with access to the asset's project"],
        ["activity_log", "The new Audit Log entry", "Users with the Audit Log module (project-filtered)"],
        ["security_event", "The new security event", "Users with Manage security"],
        ["broker_status", "brokerId, brokerName, status, timestamp", "Signed-in users"],
        ["system_alerts", "{ changed: true }", "Users with the Reports module"],
      ]
    ),

    h2("23.3 Client Behaviour"),
    ul([
      "All components in a browser tab share one connection.",
      "It reconnects automatically with increasing delay and then reloads data, so values missed while offline appear.",
      "Visualization widgets refetch when a telemetry event arrives for their asset.",
    ]),
    pb(),

    // ─── CHAPTER 24 ───────────────────────────────────────────────────────────
    h1("Chapter 24: Authentication & Authorization"),
    h2("24.1 Sessions"),
    ul([
      "Server-side sessions in PostgreSQL, identified by the HttpOnly cookie is_session; only a hash of the token is stored.",
      "Idle timeout 30 minutes, absolute limit 12 hours, Remember me 14 days (AUTH_SESSION_IDLE_MINUTES, AUTH_SESSION_ABSOLUTE_HOURS, AUTH_SESSION_REMEMBER_DAYS).",
      "Cookie writes need the x-csrf-token header matching the is_csrf cookie.",
      "Simultaneous sessions per user are limited (default 3).",
    ]),

    h2("24.2 Passwords and Tokens"),
    ul([
      "Passwords are hashed with scrypt (N=65536, r=8, p=2, 16-byte salt) after Unicode normalisation.",
      "Activation and reset tokens are 256-bit random values, single-use, stored only as a hash.",
      "Lockout after 5 failures for 15 minutes (AUTH_LOCKOUT_THRESHOLD, AUTH_LOCKOUT_MINUTES).",
      "Sign-in, forgot-password and token requests are rate limited per source.",
    ]),

    h2("24.3 API Keys"),
    ol([
      "The key is read from Authorization: Bearer or X-API-Key.",
      "Its SHA-256 hash is looked up; the client must be active and not expired.",
      "The IP allowlist (addresses or CIDR) and the route's scope are checked.",
      "Project-assigned clients are limited to their project.",
      "At most 1200 requests per minute per client (INGEST_RATE_LIMIT_RPM), then HTTP 429.",
    ]),

    h2("24.4 Authorization"),
    p("artifacts/api-server/src/lib/rbac.ts defines roles, permissions and module defaults. middleware/authorize.ts holds a deny-by-default route table; lib/project-access.ts applies project access and lib/viz-access.ts applies dashboard ownership and shares. Every refusal is written to security_events."),
    code("text", `super_admin, company_admin, admin:
  view, manage_assets, manage_templates, manage_alarms, acknowledge_alarms,
  manage_users, manage_brokers, manage_destinations, manage_api_clients, manage_security
engineer, developer (assigned projects only):
  view, manage_assets, manage_templates, manage_alarms, acknowledge_alarms,
  manage_brokers, manage_destinations, manage_api_clients
project_manager, team_lead, operator: view, acknowledge_alarms
viewer: view`),
    note("The web application reads the same catalogue from the server to hide or disable controls. That is for usability only; the server decision is authoritative."),
    pb(),

    // ─── CHAPTER 25 ───────────────────────────────────────────────────────────
    h1("Chapter 25: Webhook & Destination System"),
    h2("25.1 Overview"),
    p("Two outbound mechanisms exist: rule webhooks (one URL per alarm rule) and destinations (platform-wide endpoints for alarm events). Both are sent in the background and never delay ingest. Outbound addresses are checked so that internal network addresses cannot be targeted."),

    h2("25.2 Rule Webhook"),
    p("POST with Content-Type: application/json, 5-second timeout:"),
    code("json", `{
  "event": "triggered",
  "alarmId": "uuid",
  "ruleName": "High Temperature",
  "metric": "temperature",
  "value": 84.2,
  "threshold": 80,
  "operator": "gt",
  "severity": "high",
  "assetId": "uuid",
  "assetName": "Demo Pump",
  "timestamp": "2026-11-20T10:30:00.000Z"
}`),
    p("event is 'triggered' or 'cleared'. Test webhook sends { event: 'test', ruleName, severity, metric, timestamp, source: 'iot-platform' } and reports the HTTP status (502 webhook_unreachable when the endpoint does not answer)."),

    h2("25.3 Destination Event"),
    p("POST with Content-Type and the configured authentication header, 6-second timeout:"),
    code("json", `{
  "event": "alarm",
  "alarmEvent": "triggered",
  "alarmId": "uuid",
  "ruleName": "High Temperature",
  "metric": "temperature",
  "value": 84.2,
  "threshold": 80,
  "operator": "gt",
  "severity": "high",
  "assetId": "uuid",
  "assetName": "Demo Pump",
  "timestamp": "2026-11-20T10:30:00.000Z"
}`),
    table(
      ["Auth type", "Header"],
      [
        ["bearer", "Authorization: Bearer <token>"],
        ["api_key", "<apiKeyHeader>: <key> (default X-API-Key)"],
        ["basic", "Authorization: Basic <base64(user:password)>"],
        ["none", "No authentication header"],
      ]
    ),
    p("The destination Test button sends { event: 'test', source: 'iot-platform', timestamp, destinationId }."),

    h2("25.4 Limitations"),
    ul([
      "No retries or delivery queue; a failed delivery is recorded as the destination's last error.",
      "Destinations have no project setting and receive alarms from every project.",
      "Only alarm events are forwarded; telemetry is not.",
    ]),
    pb(),

    // ─── CHAPTER 26 ───────────────────────────────────────────────────────────
    h1("Chapter 26: Operations & Feature Switches"),
    h2("26.1 Installation"),
    ul([
      "One Linux VM per company, with nginx in front of the API and the built web application. Never share one database between companies.",
      "Apply the schema with 'pnpm --filter @workspace/db run push'.",
      "There are no default users. The first Super Admin is created with 'pnpm --filter @workspace/db run bootstrap' during installation and sets a password through a single-use activation link.",
      "Production refuses to start without SECRETS_ENC_KEY or with sign-in enforcement switched off.",
    ]),

    h2("26.2 Backup and Restore"),
    p("A backup must contain the database, the uploads folder and SECRETS_ENC_KEY together; broker passwords and ingest tokens cannot be decrypted without the key. The backup script reports each run to Data Management > Archives & backups."),

    h2("26.3 Monitoring"),
    table(
      ["Check", "Use"],
      [
        ["GET /api/healthz", "Process is running"],
        ["GET /api/readyz", "Process and database are ready (503 otherwise)"],
        ["GET /api/export/health", "Public status for uptime monitors"],
        ["Data Management alerts", "Disk space, growth and data gaps, optionally sent to a webhook"],
      ]
    ),

    h2("26.4 Build-time Feature Switches"),
    p("Set when the web application is built, for example VITE_LIVE_TWIN_TYPES=asset pnpm --filter @workspace/iot-platform build."),
    table(
      ["Variable", "Default", "Effect"],
      [
        ["VITE_LIVE_TWIN_TYPES", "all", "Twin types offered: image, asset, process, plant, builder, map"],
        ["VITE_LIVE_TWIN_CLASSIC", "off", "true uses the earlier 2D twin (browser only) and fixed process diagram"],
        ["VITE_TWIN_LIBRARY_LIST", "off", "true shows the machine library as the earlier list on the right instead of the tile panel on the left"],
        ["VITE_CLASSIC_REPORTS", "off", "true lists the classic Reports page in Data Studio again"],
        ["VITE_CLASSIC_AUDIT_LOG", "off", "true restores the earlier Audit Log page"],
        ["VITE_DISABLE_PRO_WIDGETS", "off", "true hides the 104 Pro widgets"],
        ["VITE_DISABLE_PLANT_TWIN_3D", "off", "true offers only 2D twins"],
        ["VITE_DISABLE_NOTIFICATION_CHANNELS", "off", "true hides Email/WhatsApp/SMS and Notification Groups"],
        ["VITE_READABLE_URLS", "off", "true uses readable page addresses"],
        ["VITE_ENABLE_ADVANCED_ALARM_OPTIONS", "off", "true shows rule options that are saved but not evaluated (Deviation, Heartbeat, Window, Scan Rate, Require Acknowledge)"],
        ["VITE_ENABLE_PAYLOAD_SIMULATOR", "off", "true shows a browser-based test payload sender"],
        ["VITE_ENABLE_HIERARCHY_GENERATOR", "off", "true shows the Hierarchy Generator"],
      ]
    ),

    // ─── APPENDICES ───────────────────────────────────────────────────────────
    pb(),
    h1("Appendix A: Frequently Asked Questions"),
    table(
      ["Question", "Answer"],
      [
        ["Ingest answers 200 but no data appears. Why?", "The response says matched: false: no asset has that Device ID. Matching is exact and case-sensitive. Bind the device through the asset's template."],
        ["Can I send data before the asset exists?", "The device id is recorded as seen, but readings are only stored once an asset has that Device ID."],
        ["Why does my alarm not raise?", "Check that the rule is enabled, the asset is not in maintenance, the metric key matches the payload exactly, the value is numeric, and any On Delay has passed."],
        ["My gateway can only take a URL. How does it authenticate?", "Use the client's copy-and-paste ingest URL (/api/ingest/e/<token>/payload). Regenerate it to revoke."],
        ["Why do I not see a project?", "Your role or Project Access does not include it. Ask an administrator."],
        ["Why do I not see a dashboard?", "Dashboards are visible to their owner and to users they are shared with."],
        ["Are Email, WhatsApp and SMS alarms sent?", "Not yet. The settings are saved; webhooks and destinations are delivered today."],
        ["What happens if the live connection drops?", "It reconnects automatically and reloads data."],
      ]
    ),

    pb(),
    h1("Appendix B: Troubleshooting Guide"),
    table(
      ["Symptom", "Likely cause", "Resolution"],
      [
        ["Ingest returns 401", "Missing, wrong, revoked or expired key", "Send the key in X-API-Key or Authorization: Bearer; check the client in API Client"],
        ["Ingest returns 403 out_of_project_scope", "Key or user is limited to another project", "Use a key assigned to the asset's project"],
        ["Ingest returns 400 missing_device_id", "No deviceId field in the payload", "Add a top-level deviceId"],
        ["Ingest returns 429", "More than the per-client request limit", "Batch readings or slow the gateway"],
        ["MQTT broker shows Error", "Wrong address or credentials, or firewall", "Check the broker history message; test with an MQTT client from the server"],
        ["Widget shows no data", "No readings in the selected range, or wrong metric", "Widen the time range; check the metric choice"],
        ["Cannot sign in", "Account locked, suspended or not activated", "Wait 15 minutes or ask an administrator to unlock, activate or resend the link"],
        ["Write action fails with csrf_failed", "Page open too long or cookies blocked", "Reload the page and try again"],
        ["Runtime value not updating", "Tag name in the expression does not exist, or input is blank", "Check the tag names and that readings arrive"],
      ]
    ),

    pb(),
    h1("Appendix C: Glossary"),
    table(
      ["Term", "Definition"],
      [
        ["Asset", "A node in the hierarchy representing a site, unit, machine or measuring point"],
        ["Project", "A root-level asset"],
        ["Attribute", "A named property of an asset: static, dynamic, metric or timestamp, optionally calculated"],
        ["Device ID", "The asset identifier matched against the payload deviceId"],
        ["Template", "A reusable set of attribute definitions"],
        ["Telemetry", "Time-stamped readings"],
        ["Summary (rollup)", "15-minute or hourly count, min, average and max of readings"],
        ["Retention policy", "Rule that deletes readings older than a number of days"],
        ["Legal hold", "Protection of a range of readings from deletion"],
        ["Broker", "Configured connection to an external data source such as MQTT"],
        ["API client", "Machine credential with scopes and optional project"],
        ["Scope", "Permission granted to an API client, e.g. ingest:write"],
        ["Destination", "External endpoint that receives alarm events"],
        ["Deadband", "Margin a value must move back past before an alarm clears"],
        ["SPC line", "UCL, LCL or CL reference line on a chart"],
        ["Twin", "Visual model of a machine, process or plant linked to live data"],
        ["Module", "Area of the application with its own Read, Write and Delete access"],
        ["RBAC", "Role-based access control"],
        ["WebSocket", "Persistent connection used for live updates"],
        ["Webhook", "HTTP POST sent to an external URL when an alarm raises or clears"],
      ]
    ),

    divider(),
    p(`${PLATFORM_NAME} v${PLATFORM_VERSION_V22} - Platform Documentation`),
    p(`Generated: ${DOC_DATE_V22}`),
    p("This document describes the features available in the current platform release."),
  ];
}
