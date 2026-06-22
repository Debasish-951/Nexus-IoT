# Integrated Suite — Product Modernization Strategy
**Industrial IoT Platform Enhancement Roadmap**

*Prepared for: Product, Design & Engineering Teams*
*Date: June 2026 | Version: 1.0*

---

## Section 1 — Core Problem Framing

### The Situation

This platform is not a prototype. It is a functioning Industrial IoT system with real brokers, real telemetry, real alarm rules, and real users operating across at least four roles (admin, engineer, operator, viewer). Any enhancement strategy must start from that reality.

The temptation in modernization projects is to frame new work as "replacing what exists." That framing is wrong and dangerous for two reasons:

1. **Users have learned the current product.** Every familiar element you remove is a disruption, regardless of how much better its replacement is.
2. **Industrial environments demand stability.** An operator using this platform to monitor live equipment cannot tolerate a screen that disappears, moves, or breaks during a shift.

The correct framing is **progressive enhancement**: new capability is added *on top of* what exists, proven in parallel, and only elevated to primary when validated.

### What the Platform Currently Has (Baseline Assessment)

| Area | Current State |
|---|---|
| Dashboard | Ops Dashboard: status banner, KPI cards (Critical/Active Alarms, Assets, Ingest Rate), Active Alarms panel, Live Feed, Health Grid |
| Reports | 5 types: Telemetry Summary, Alarm Log, Asset Status Snapshot, Alarm Analysis (Manager), Operational Health (Executive) |
| Asset Templates | Create / Edit / Delete / Clone / Import (payload/CSV/JSON) / Export Schema |
| Alarms | Active + History views, Acknowledge, Severity filter, Webhook delivery, Rate-of-change rules |
| Visualization | Named dashboards, 11 widget types, multi-metric overlay, live WS updates, role-based access |
| Users | 4 RBAC roles, permissions map, ReadOnlyBanner, RoleGuard components |
| Brokers | MQTT / REST / Azure IoT, mapping rules, connection history timeline |
| Activity Log | Audit trail with category, actor, target, paginated, auto-refresh |
| Data Mgmt | Retention policies, storage stats, manual pruning, per-asset breakdown |
| Live Feed | /live page — per-asset metric tiles, event log, WS status, stale detection |

### The Honest Gap

What the platform does *not yet have* (and what the enhancement ideas assume):

- No live vs. target / setpoint comparison (no setpoints stored)
- No shift-based or time-of-day business context
- No OEE, availability, or production-count metrics natively
- No device registry or firmware OTA
- No scheduled or automated report delivery (PDF/email)
- No self-service user registration or SSO
- No interactive permission matrix (current: role dropdown, not per-resource)
- No explicit feature flags or A/B toggle infrastructure

These are **medium-to-long-term gaps**. They should not block near-term improvement work.

---

## Section 2 — Recommended Rollout Strategy

### Core Principle: Additive Before Replacive

Never remove a working element before its replacement is proven. The operational sequence is always:
```
Add (hidden) → Validate → Expose (opt-in) → Promote → Retire old
```

### Three Safe Rollout Patterns for This Platform

**Pattern A — Role-gated exposure**
New features visible only to `admin` and `engineer` roles first. Operators and viewers see the stable interface unchanged. This is already supported via the `can()` permission system and `RoleGuard`.

**Pattern B — Additive panel/tab**
New content added as a new tab or collapsible panel alongside existing content. The existing layout remains untouched. The new panel carries a "Beta" or "Preview" label.

**Pattern C — Separate route**
New experiences live at a new URL (e.g. `/ops-overview`, `/exec-summary`). The sidebar link appears only for selected roles. The existing `/` dashboard is completely unaffected.

All three patterns are available today using the current codebase without infrastructure changes.

---

## Section 3 — Phased Roadmap

### Phase 0 — Preserve + Assess (Weeks 1–2)

**Goal:** Establish a stable baseline. No user-visible changes.

- Audit which pages each role actually uses day-to-day (talk to at least 2 operators, 1 engineer)
- Identify which alarms are most critical (by asset, by severity, by response time)
- Identify which report types are actually downloaded vs. ignored
- Document which dashboard panels operators look at first when they log in
- Confirm current data quality: are asset `identifier` fields consistent? Do attributes have proper `tagName` values? Are alarm rules well-configured?

**Why this matters:** Many "feature" problems are actually data quality problems. A live vs. target comparison feature is worthless if half the assets don't have reliable telemetry.

**Output:** A short internal doc: "Top 3 things users need that they can't do today."

---

### Phase 1 — Safe Additions on Top of Existing Platform (Weeks 3–8)

These changes add value with minimal disruption. All are additive. None remove existing functionality.

#### 1.1 Dashboard — Critical Asset Strip (immediate)
*Already partially delivered.* The current Active Alarms panel shows top active alarms with severity, time, and acknowledge. Extend this with:
- **Filter by asset:** Let operators click a specific asset's health card to jump directly to `/assets?id=<assetId>`
- **Maintenance mode indicator:** Show a wrench icon on health cards for assets in maintenance mode (already tracked in DB)
- **Last-seen "stale" threshold tooltip:** On hover over a stale health card, show when telemetry was last received

Effort: Low (1–2 days). Data: Available now.

#### 1.2 Reports — Quick-Run Buttons for Common Reports
Add 3 "quick report" buttons at the top of the Reports page that pre-fill the most common scenarios:
- "Today's Alarm Summary" → Alarm Analysis, last 24 h
- "This Week's Operational Health" → Operational Health, last 7 d
- "Live Asset Snapshot" → Asset Status Snapshot, now

Effort: Low (< 1 day). Data: Available now.

#### 1.3 Asset Templates — Usage Count
When a template is applied to assets, show a count ("Applied to 4 assets") on the template list item. Users today have no way to know whether a template is actively in use before editing or deleting it.

Effort: Medium (requires a join query on the asset→template relationship — 1–2 days backend + 1 day frontend).

#### 1.4 Activity Log — User-Facing Action Summary
Add a compact "Recent Activity" widget to the dashboard (collapsed by default, expandable). Shows the last 5 audit events: who did what, when. Useful for admins and engineers to verify that changes are being tracked. Data source: existing `/api/activity-log` endpoint.

Effort: Low (< 1 day). Data: Available now.

#### 1.5 Brokers — Health Indicator on Dashboard
The current dashboard shows "Ingest Rate" and "N brokers connected" but does not name the brokers. Add a small broker health row below the KPI cards showing each broker's name and last-connected status (green dot / red dot). Clicking navigates to `/brokers`.

Effort: Low (fetch `/api/brokers` + display, 1 day). Data: Available now.

---

### Phase 2 — Enhanced Role-Based Experiences (Weeks 9–20)

These require moderate effort but stay within the existing data model and RBAC framework.

#### 2.1 Role-Specific Dashboard View
Today all roles see the same dashboard. Add a role-aware rendering layer:

| Role | Dashboard emphasis |
|---|---|
| Admin | Full view: all KPIs, broker health, user count, activity log |
| Engineer | Alarms + asset health + telemetry feed (current state is close) |
| Operator | Only: status banner + active alarms + single asset's health card |
| Viewer | Read-only: status banner + health grid (no alarms, no acknowledge) |

This does not require separate pages — the existing RoleGuard and `can()` system handles conditional rendering. It is primarily a *design decision* about which panels to show per role.

Effort: Medium (2–3 days design + 3–4 days implementation).

#### 2.2 Operations Overview Page (Beta Route `/ops-overview`)
A new page visible only to admin and engineer roles that shows:
- Plant-level summary: all assets, health % breakdown, alarm burden by zone/parent-asset
- Shift summary strip (manual for now: last 8 h of telemetry aggregated)
- Top 5 assets by alarm frequency (from Alarm Analysis report data)
- Quick links to relevant alarm rules and broker configs

This page is additive — it does not replace `/`. It can carry a "Preview" badge.

Effort: Medium (4–6 days). Data: Available now via existing endpoints.

#### 2.3 Scheduled Report Email Delivery
Allow users to configure a report to be emailed on a schedule (daily, weekly). Requires:
- A `scheduled_reports` database table
- A background job (cron) that runs reports and sends email via SMTP/SendGrid
- A simple UI form on the Reports page: "Schedule this report"

This is the single highest-value reporting improvement for managers and executives who do not log in daily.

Effort: High (6–10 days end-to-end). Risk: Low to Medium. Data: Available now.

#### 2.4 Alarm Escalation Rules
Currently alarms trigger and send webhooks but do not escalate if unacknowledged. Add:
- `escalation_delay_minutes` field on alarm rules
- Background job: if an alarm is not acknowledged within the delay, fire a secondary webhook or send an email
- UI: escalation config row in the alarm rules editor

Effort: High (5–8 days). Risk: Medium (touches alarm evaluation path). Recommend: feature-flag behind an admin toggle.

#### 2.5 Template Library — Categories and Search Tags
Currently templates are a flat list. Add:
- `category` and `tags[]` fields on the `asset_templates` table (a migration)
- Category filter dropdown on the template list
- Tag badges on template list items
- A "Browse by category" panel when no template is selected

This is low-risk because it is additive to the existing schema. The current Create dialog gains a Category field; existing templates just have no category until edited.

Effort: Medium (2 days DB + 2 days frontend). Risk: Low.

---

### Phase 3 — Advanced Operational Intelligence (Months 6–18)

These are strategic features that require either new data models, new architecture, or organizational buy-in to operationalize.

#### 3.1 Live vs. Target / KPI Deviation Dashboard
Requires:
- A "setpoints" concept: each asset or attribute has a target/nominal value
- A deviation metric: current value vs. setpoint, expressed as %, color-coded
- A new dashboard widget type: "KPI deviation gauge"

This is meaningless without setpoint data from customers. **Do not build the UI before the data model is validated with real users.**

#### 3.2 Device Registry and Firmware OTA
Requires a separate `devices` table (distinct from assets), firmware version tracking, OTA job management, and a connection to broker infrastructure. This is a significant architecture expansion.

#### 3.3 OEE and Production Analytics
Requires production count or cycle-time telemetry, downtime classification (planned vs. unplanned), and shift-based aggregation. This is domain-specific and requires customer collaboration to define what "availability" and "performance" mean for their equipment.

#### 3.4 Executive Analytics Layer (Real-Time Business Intelligence)
- Business-impact KPI cards (e.g. estimated revenue impact of downtime)
- Cross-asset comparison (benchmarking)
- Predictive maintenance score based on telemetry trends

Requires both new data infrastructure (likely a time-series aggregation layer or read replica) and business metric definitions from the customer.

#### 3.5 Interactive Permission Matrix (vs. Role Dropdown)
Replace the current role-based model with a per-resource, per-user permissions matrix. This is a significant UI and backend investment and should only be prioritized if customers with complex organizational structures require it.

---

## Section 4 — Dashboard Evolution Plan

### Current State (June 2026)

The Operations Dashboard is already well-positioned:
- ✅ Status banner (green/orange/red based on alarm state)
- ✅ 4 KPI cards (Critical Alarms, Active Alarms, Assets Monitored, Ingest Rate)
- ✅ Active Alarms panel with severity sorting and inline Acknowledge
- ✅ Live Data Feed with real-time WebSocket updates
- ✅ Asset Health Grid (per-asset health cards with key metrics)

### What to Keep (Do Not Touch)

All of the above. The dashboard now shows operators what matters most in the first 10 seconds of looking at it. Do not remove the health grid or the alarm panel.

### What to Deprioritize (Not Remove)

The old alarm severity bar chart (from prior versions) has been superseded by the Active Alarms list, which is more actionable. If any vestigial charts remain in the codebase, they can be quietly retired in a cleanup sprint.

### What to Add Next (Phase 1 additions to the existing dashboard)

1. **Maintenance mode indicators** on health cards (wrench icon, already in DB)
2. **Broker health row** below KPI cards (names + connected status)
3. **Recent Activity strip** (collapsed, shows last 5 audit events)
4. **Quick navigate** from a health card to the specific asset's Trends view

### What NOT to Add Yet

- Live vs. target comparison (no setpoints)
- OEE widgets (no production count data)
- "Business impact" cost cards (no cost data)
- Shift-based summaries (no shift configuration)

These would require fabricated or hardcoded data, which erodes trust. Show real data or nothing.

### Longer-Term: Dashboard Tabs (Phase 2)

Add a tab bar to the dashboard:

| Tab | Audience | Content |
|---|---|---|
| Operations (default) | All roles | Current state (status banner, alarms, health grid) |
| Analytics | Engineer + Admin | Trend charts, aggregated stats, broker stats |
| Executive Summary | Admin only | Operational health %, alarm MTTR, top problem assets |

Each tab is additive. The Operations tab is the current dashboard, unchanged.

---

## Section 5 — Asset Template Reuse — Incremental Approach

### Current State

Templates have: Create, Edit (attribute definitions with inline table), Delete, Clone, Import (payload/CSV/JSON), Export Schema.

Clone is now available (copies name + all attribute definitions). This is the most important reuse primitive.

### Safe Near-Term Additions (Before a Full Template Library)

**1. Usage count on list item** (Phase 1)
"Applied to 4 assets" shown below the template name. This prevents accidental deletion of templates that are in active use. Backend: count of assets that have had this template applied, surfaced via a new API field.

**2. "Apply again" shortcut from asset detail** (Phase 1)
On the Asset → Attributes panel, add a small "Re-apply template" button that lets engineers re-apply an existing template to pick up new attribute definitions that were added after the initial application. This is the most requested workflow in template-heavy environments.

**3. Category and tags** (Phase 2)
See Roadmap Phase 2. Adds `category` field and `tags[]` to the template. Enables filtering. Does not break any existing template.

**4. Template comparison view** (Phase 2)
Side-by-side diff of two templates' attribute definitions. Useful when deciding which template to clone or apply to a new asset type.

**5. Template library sharing (export/import pack)** (Phase 3)
Export a template (or set of templates) as a single JSON "template pack" file that can be imported into another platform instance. Useful for deploying standard equipment schemas across multiple customer sites.

### What to Avoid Building Too Early

- A full template "marketplace" or versioning system — too complex for current scale
- Template inheritance (parent/child templates) — powerful but complicated; wait until the category system proves its value

---

## Section 6 — Reporting Improvement — Incremental Approach

### Current State

5 report types with role-grouped UI:
- Engineer: Telemetry Summary, Alarm Event Log, Asset Status Snapshot
- Manager: Alarm Analysis by Asset (MTTR, frequency, severity breakdown, bar chart)
- Executive: Operational Health Report (health scores, freshness, alarm burden, pie chart)

All downloadable as CSV + JSON. All with summary KPI bar above the table.

### Near-Term Improvements (Phase 1 — Low Effort)

**1. Quick-run buttons** (pre-filled date range + report type shortcuts)
"Today's Alarm Summary", "This Week's Health", "Live Asset Snapshot" — one click, already filtered.

**2. Save report configuration**
Let users save a report configuration (type + date range + filters) as a named preset (stored in localStorage). No backend required.

**3. Comparison mode for Operational Health**
Add a "Compare to last week" toggle on the Operational Health report. Shows a delta column: freshnessScore this week vs. last week. Highlights improving vs. worsening assets.

### Medium-Term Improvements (Phase 2)

**4. Scheduled report delivery via email**
The highest-value improvement for managers/executives. See Roadmap Phase 2.3.

**5. Alarm Analysis: resolution-time trend chart**
Add a line chart showing average MTTR over time (daily buckets) on the Alarm Analysis report. Data is already available in `alarm_history`.

**6. Asset Availability % calculation**
Define "available" as: no active critical/high alarm AND telemetry freshness > 50% in the period. Compute per asset. Add as a column in Operational Health and a new chart type.

### Long-Term (Phase 3)

**7. Automated PDF report delivery**
Generate a formatted PDF (not just CSV) and email it on schedule. Requires a PDF rendering library (e.g. Puppeteer headless).

**8. Cross-period benchmarking**
Compare this month's asset performance to last month, same month last year, or a user-defined baseline period.

**9. Executive "one-page" summary view**
A non-tabular summary: bullet-point health status, top 3 problem assets, alarm trend direction, recommended actions. Designed for a 30-second executive read.

---

## Section 7 — User Access Control — Incremental Approach

### Current State

- 4 roles: admin, engineer, operator, viewer
- `can(permission)` function with a static `ROLE_PERMISSIONS` map
- `RoleGuard` for hiding/disabling UI elements
- `ReadOnlyBanner` for pages where the active role cannot make changes
- Role switching via profile switcher (sets actor headers)

### The Gap vs. Enterprise Expectations

Enterprise customers often want:
- Per-asset or per-zone access (User A can see Plant 1 but not Plant 2)
- Per-report access (User B can run Operational Health but not Alarm Analysis)
- Audit-logged permission changes (who granted access to whom)

The current model does not support per-resource permissions. This is a known architectural boundary.

### Incremental Path (Do Not Jump to a Permission Matrix)

**Phase 1 — Document the current model clearly**
Add a "Roles & Permissions" reference panel to the Users page. A table showing which role can do what. This costs zero engineering effort (it is documentation, rendered as a UI component) and dramatically reduces support questions from administrators.

**Phase 2 — Role assignment audit**
Log role changes in `activity_logs` (action: "role_changed", detail: "from engineer to viewer"). This is 2–3 lines of code in the users route. Administrators gain an audit trail for compliance.

**Phase 3 — Asset-group based access (medium effort)**
Add an optional `allowedAssetGroups[]` field on users. If set, the user only sees assets whose parentId matches one of the allowed groups. Filter applied server-side in `/api/assets`. This is a significant but contained change.

**Phase 4 — Per-report access control (medium effort)**
Add a `reportAccess[]` field to the RBAC configuration, allowing admins to disable specific report types for specific roles. Stored in app config or DB.

**Phase 5 — Full permission matrix (long-term)**
A per-user, per-resource permissions model. Do not build this until Phase 3 and 4 have been validated with real admin users. It is complex to build and even more complex to make usable.

### UI Guidance: Avoid User Confusion During Transition

- Never silently hide features that users previously had access to. If a permission is revoked, show a "Contact your administrator" message rather than a 404.
- When introducing new roles or permissions, use a 30-day notice period communicated in the app ("Permissions are changing on July 15").
- Always allow an admin to preview what another role sees, without logging in as that user.

---

## Section 8 — Prioritization Matrix

| Feature | User Value | Engineering Effort | Data Available | Risk | Priority |
|---|---|---|---|---|---|
| Maintenance mode on health cards | High | Very Low | ✅ Now | Very Low | **Do immediately** |
| Broker health row on dashboard | Medium | Low | ✅ Now | Very Low | **Do immediately** |
| Template usage count | High | Low-Medium | ✅ Now | Low | **Phase 1** |
| Quick-run report buttons | Medium | Very Low | ✅ Now | Very Low | **Phase 1** |
| Role-specific dashboard view | High | Medium | ✅ Now | Low | **Phase 1–2** |
| Save report configuration (localStorage) | Medium | Very Low | ✅ Now | Very Low | **Phase 1** |
| Ops Overview beta page | High | Medium | ✅ Now | Low | **Phase 2** |
| Scheduled email reports | Very High | High | ✅ Now | Medium | **Phase 2** |
| Template categories and tags | Medium | Medium | ✅ Now | Low | **Phase 2** |
| Alarm MTTR trend chart | High | Medium | ✅ Now | Low | **Phase 2** |
| Alarm escalation rules | High | High | ✅ Now | Medium | **Phase 2** |
| Asset-group based access | Very High | High | ✅ Now | High | **Phase 3** |
| Live vs. target comparison | Very High | Very High | ❌ Needs setpoints | High | **Phase 3** |
| OEE widgets | Very High | Very High | ❌ Needs production data | Very High | **Future vision** |
| Predictive maintenance | Very High | Extreme | ❌ Needs ML pipeline | Very High | **Future vision** |
| PDF report delivery | High | High | ✅ Now | Medium | **Phase 3** |
| Full permission matrix | High | Extreme | ✅ Now | High | **Future vision** |

**Reading the matrix:** Start from the top (Do immediately). Move down only when current-phase items are validated. Do not start Phase 3 items while Phase 1 items are still unproven.

---

## Section 9 — Rollout and Adoption Recommendations

### Validate Before Promoting

For every Phase 1 and Phase 2 feature:
1. Build it behind a role gate (visible to admin only first)
2. Run it with 1–2 real admin/engineer users for 2 weeks
3. Collect explicit feedback: "Does this help you? Would you use it daily?"
4. Only then make it visible to operator and viewer roles

### Avoiding UX Disruption During Transition

**Keep the primary nav stable.** Every page rename or nav reorder is a disruption. The sidebar structure should only change in major releases, announced in advance.

**Use inline labels for new features.** A "New" or "Beta" badge on a sidebar item or panel header signals that this is additive, not a replacement. It also sets appropriate expectations for rough edges.

**Never reduce information density for operators.** Operators scan for specific values. If you redesign a panel, preserve the number of visible data points. Do not hide information behind clicks that was previously visible at a glance.

**Feature announcements in-app.** When a new panel or report type is added, show a one-time dismissible banner: "New: Alarm Analysis by Asset is now available in Reports." This drives discovery without forcing adoption.

### Rollback Strategy

Every new feature that touches the DB schema must have a corresponding migration rollback script. Every new frontend panel should be removable with a single `can()` check or environment flag. The goal is: if a feature causes problems, it can be disabled in under 5 minutes.

---

## Section 10 — Final Recommendation: What to Do First

Based on the current platform state, user context, and the prioritization matrix, the recommended first three weeks of work are:

### Week 1: Three Zero-Risk Dashboard Improvements

1. **Maintenance mode indicator on health cards** — Show a 🔧 icon on assets where `maintenanceMode = true`. One condition in `AssetHealthCard`. 2 hours of work.

2. **Broker health row on dashboard** — Fetch broker list, display name + connection status below the KPI cards. Clicking navigates to `/brokers`. Half a day.

3. **"Re-apply template" button on asset attributes panel** — Add a small button to apply an existing template again to pick up new attribute definitions. One day.

### Week 2: Report Usability

4. **Quick-run report buttons** — Three pre-configured buttons above the report type selector: "Today's Alarms", "This Week's Health", "Asset Snapshot Now". Two hours.

5. **Save report config to localStorage** — Let users save a named preset (type + date range + filters). No backend. One day.

6. **Template usage count in list** — Show "Applied to N assets" on each template. One backend query + frontend display. Two days.

### Week 3: Validate and Decide Phase 2

- Review with at least 2 real users (admin + engineer) whether the Week 1–2 changes helped
- Make the explicit decision: **Does the platform need role-specific dashboard views, or is the current single-view sufficient?**
- If yes: begin Phase 2.1 (role-aware dashboard rendering)
- If no: begin Phase 2.3 (scheduled email report delivery — the highest-value medium-term feature)

---

### Closing Note on Discipline

The biggest risk in an enhancement program is *scope creep from excitement*. The features in Phase 3 are compelling. The temptation is to start building them before Phase 1 and 2 are solid.

The platform already has a strong operational foundation. The job now is to make what exists *better used*, not to make it *bigger*. Every Phase 1 improvement that is actually adopted by operators creates more organizational trust for Phase 2 investments. Every Phase 3 feature built before Phase 1 is validated creates technical debt and confused users.

**Ship small. Validate early. Expand what works.**

---

*Document owner: Product & Engineering*
*Next review: End of Phase 1 (Week 8)*
