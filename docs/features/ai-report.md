# AI Reports (AI Advisor)

AI Advisor is a menu group with two pages: **Advisor** (`/ai-copilot`, the question modes)
and **AI Reports** (`/ai-reports`). AI Reports writes one report for an asset, a project or
all assets the user can see, over the last 24 hours, 7 days, 30 days or a custom range (at
most 92 days). It runs on demand only; there is no scheduled or emailed report yet.

AI Advisor is a licensed feature and needs an internet connection: the written insight comes
from an external model (Groq today, through `lib/llm.ts` so the provider can be changed).

**Required approach.** A report is built from the database only, never from Visualization or
dashboard data: first the figures are computed in code (the trusted base), then the AI
investigates the database with read-only tools kept to the report's scope and period, and
only then writes. Keep new report work to this approach.

## Who gets which report

The report is written for the reader's level, decided on the server from the user's role
(`REPORT_LEVEL_BY_ROLE` in `artifacts/api-server/src/lib/ai-report.ts`). There is no level
picker and no report-type list; the page names the level ("Report for: Executive") and says
it comes from the role.

| Level | Roles | Why |
|---|---|---|
| Executive | `super_admin`, `company_admin`, `project_manager` | The people who answer for the plant and present it |
| Manager | `admin`, `team_lead`, `viewer`, and any role not listed | Those who run teams or administer the system; read-only viewers get a summary, not a technical dump |
| Engineer | `engineer`, `developer`, `operator` | The people who work on the equipment and the data |

## What each level contains

**Executive** (1-2 pages; the PDF stops at 5):
- a headline sentence and a 2-4 sentence summary
- 4-6 key figure cards against the previous period of the same length, each marked better,
  worse or about the same: plant health score, data availability, critical and high alarms,
  all alarms, mean time to clear, energy used (kWh counters), mean time to acknowledge
- top 3 risks: what, why it matters to the business, likely cause, recommended decision
- what improved, decisions needed, outlook for the next period
- asset status bar, alarms by severity now and before, assets needing attention

**Manager**:
- summary and the key figure cards
- problem areas ranked by impact, with issue, impact and likely cause
- assets with most alarms (critical / high / other) and alarms by hour of day, with the
  busiest three-hour window
- response performance: alarms, MTTA, MTTR and still open, now and in the previous period,
  with the AI's reading of the trend
- patterns (repeat alarms, time concentration, maintenance, data gaps) and the repeat-alarm table
- team priorities in order, each with a suggested owner role
- assets needing attention and assets in maintenance

**Engineer**:
- summary and the key figure cards
- diagnosis per asset: observation, related signals, likely root cause, confidence (low,
  medium, high)
- trend charts of the four biggest changes
- signals that changed before alarms, metrics that moved together
- alarm sequence and sensor/data issues (AI) with the alarm timeline (latest 40, facts)
- maintenance actions with urgency (immediate, this week, planned)
- stale assets, low coverage, possibly stuck sensors, and every metric

## How a report is made

1. **Figures (code, not AI).** The server computes every number from the database, limited
   to the selected asset's subtree and to the caller's projects:
   - assets reporting, stale, silent, in maintenance; readings; data coverage (hours with data
     / hours in the period); the same for the previous period
   - per metric: min, average, max, previous average and change; the biggest changes and
     their trends (the period split into about 48 buckets of whole hours, at least one hour each)
   - energy used: the rise of kWh counters (MWh converted)
   - **plant health score** (0-100) = 40 x availability (share of monitored assets that sent
     data) + 30 x data coverage + 30 x 1 / (1 + weighted alarms per asset per day), with
     weights critical 3, high 2, medium 1, low and info 0.5. Monitored assets are those not in
     maintenance that have sent data at some time. Without alarm access the first two parts
     are scaled to 100. The previous period's score uses the same formula.
   - asset status at the period end: in alarm (an alarm of the period still open), stale,
     no data this period, in maintenance, healthy
   - **metrics that moved together**: Pearson correlation of the bucket averages of two
     metrics of the same asset, at least 8 shared buckets, |r| of 0.7 or more, top 10
   - **signals before alarms**: for each alarm name on an asset, the metric whose value in the
     last full bucket before the alarm was furthest from its normal (z-score of 2.5 or more,
     or 1.5 or more across two or more alarms)
   - **repeat alarms**: the same alarm on the same asset 3 or more times, with the median gap
   - **alarm timing** by hour of day and weekday in the reader's time zone (sent by the
     browser), the busiest three-hour window (6+ alarms) and weekday (about a week of data)
   - alarms by severity, still open, MTTA, MTTR, the assets and alarms that occur most, and
     the same counts for the previous period
   - maintenance time in the period (from the asset's "maintenance since" time)
   - possibly stuck sensors: 20 or more readings, all the same value

   Alarm figures are included only when the user has the Alarms module.
2. **Investigation (AI, read-only database tools).** The figures the level needs are sent to
   the AI service, without asset ids, wrapped as untrusted data (asset, metric and alarm names
   are written by devices and users, so text inside them is never followed as an instruction).
   The model picks the 2-4 most important problems or changes and investigates them in the
   database with the same read-only tools as the Advisor chat (`lib/ai-report-agent.ts`):
   - telemetry: find assets and metrics by name, latest readings, a metric's history and
     statistics, a metric compared across machines (over more than two days these read the
     hourly summaries plus the raw head and tail, so long periods do not time out);
   - alarms: current alarms, alarm history, **alarm rules and limits** (`get_alarm_rules`);
   - the asset: health, **attributes** such as rated values and set points
     (`get_asset_attributes`);
   - **recent configuration changes** from the audit log for the asset and the assets beneath
     it in the period: who changed which rule, attribute or maintenance setting
     (`get_recent_changes`; URL, key and secret fields are hidden).

   Every tool is limited to the report's assets (refused for any other asset id), the report
   period and the user's modules (alarm tools need Alarms, attributes need Assets, changes need
   Audit Log). The model must base each finding on a figure or a tool result, phrase causes as
   hypotheses and never invent or recalculate numbers.
3. **Narrative.** The model then answers with the level's JSON.
4. **Checks.** The answer must be the level's JSON, or it is discarded. Numbers in the text
   that are found neither in the figures nor in a tool result (allowing rounding; dates, tag
   numbers and small counts are ignored) are listed on the page and in the PDF as "check
   before sharing".

**Budgets.** At most 8 tool calls, 6 model turns and about 38 seconds for the investigation
(12 seconds of it kept for the final answer); all AI work of a report ends within 48 seconds,
so the request stays under nginx's default 60 s timeout (the deployment guide also raises it
for `/api/ai/`).

**Token cost.** Every investigation turn resends the figures and the lookups so far, so a report uses roughly 3-5 times the tokens of a single call (about 10-20k). On Groq's free tier, whose per-minute token limit is close to that, the investigation often hits the limit after one or two lookups and the text is then written by the single call (or, if that is limited too, the report shows the figures only). Use a paid tier for regular use. Short waits for the limit are retried up to twice within the time budget.

**Fallbacks.** If the investigation fails or runs out of time, one call writes the narrative
from the figures alone; if that fails too, the report is the figures without a narrative
(below). A usage limit hit during the investigation also falls back to the single call, which
needs far fewer tokens; a usage limit there is reported ("try again in about N seconds").

**How this report was investigated.** The page shows a collapsible list of the lookups (tool
and a short summary), how the text was written (`investigated`, `single` or `none`), the
number of lookups and the time taken. The PDF ends with the same list as an "Investigation"
appendix.

AI-written sections are marked **AI-generated**. **Edit text** turns them into text boxes
(items can be added and removed) before export. **PDF** exports the report with the edited
text, in English (the AI writes English, and the standard PDF fonts cover Latin-1 only, so
other characters such as Japanese asset names print as "?"). **CSV** exports every figure.

## Without the AI service

When no provider is configured (`GROQ_API_KEY`), the report still shows every figure, card,
chart and table with the note "AI insights are not available right now (AI Advisor needs its
licence and an internet connection)" (`narrativeStatus: "unavailable"`). When the service
fails, is rate limited or answers with something unreadable (`failed`, `rate_limited`,
`unreadable`), the page says so and offers **Retry**.

## Access, privacy and limits

- Route `POST /api/ai/report`, module **AI Advisor** (read). The route applies the project
  scope itself; an asset outside the caller's projects is refused with `project_forbidden`.
  The menu group is hidden from project-restricted users, like the rest of AI Advisor.
- Rate limited per user with the same limits as AI chat (`AI_RL_MAX`, `AI_RL_WINDOW_MINUTES`).
- Queries are bounded and run one at a time, so a report never holds several database
  connections: at most 92 days, 20 000 alarms per period, 80 000 bucket rows per part.
  Telemetry figures come from the hourly summaries (`telemetry_rollups`) for every whole hour
  before the summaries' watermark; raw telemetry is read only for the first partial hour and
  the recent hours after the watermark (`lib/report-telemetry.ts`). With summaries switched
  off (`TELEMETRY_ROLLUPS=false`) or not built yet, the whole period is read from raw
  telemetry, which can hit the statement timeout for large projects and long periods.
- Each report is written to the Activity Log (`ai.report`) with the scope, level, period,
  asset count, how the text was written (`mode`), the tools used and the narrative status.
- What leaves the server: the computed figures (asset and metric names, no ids), and the
  results of the investigation's lookups: asset ids and names, metric names and bucketed or
  summary values, alarm names and messages, alarm limits, attribute values, and change
  records with the user name and role of whoever made them. Never secrets, URLs or keys.

## Older pages and links

- The classic report builder (`pages/Reports.tsx`: Telemetry Summary, Alarm Event Log, Asset
  Status Snapshot, Alarm Analysis by Asset, Operational Health) is no longer in the menu. It
  still opens at `/reports` for users with the Reports module, and returns to Data Studio
  when the web application is built with `VITE_CLASSIC_REPORTS=true`. Its **Generate AI
  summary** button opens AI Reports with the same asset and period.
- `/ai-copilot?action=report&...` (the earlier fifth card) forwards to `/ai-reports` with the
  same parameters. A `focus` parameter is accepted and ignored.

## Files

| File | What it holds |
|---|---|
| `artifacts/api-server/src/lib/ai-report.ts` | Role to level mapping, figures, health score, model input per level, narrative checks, request checks (pure, unit-tested) |
| `artifacts/api-server/src/lib/ai-report-agent.ts` | The investigation: tool loop, budgets, fallback chain (unit-tested with a fake model) |
| `artifacts/api-server/src/lib/llm.ts` | The AI provider seam (Groq today): single completion and tool-calling turn |
| `artifacts/api-server/src/lib/report-telemetry.ts` | Reads a period from hourly summaries plus short raw spans, and merges them (split and merge unit-tested) |
| `artifacts/api-server/src/routes/ai.ts` | `POST /ai/report`: database queries, the read-only tools (shared with the chat), the investigation's tool runner, activity log |
| `artifacts/api-server/src/tests/ai-report.test.ts` | Tests for levels, figures, correlation, timing, narrative checks and the fallback |
| `artifacts/api-server/src/tests/ai-report-agent.test.ts` | Tests for the investigation: budgets, deadline, fallback chain, verified numbers, tool scope and module gating |
| `artifacts/iot-platform/src/features/aiReport/` | AI Reports page (`AiReportsPage.tsx`), types, PDF and CSV export |
