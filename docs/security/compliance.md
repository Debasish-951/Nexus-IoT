# Compliance

**Confidence: Low** — compliance posture is inferred from implementation; no formal compliance assessment has been performed.

---

## Compliance Assumptions

This document describes the platform's current security controls and their alignment with common industrial and data protection frameworks. It is not a formal compliance certification.

---

## Controls Inventory

| Control | Requirement | Implemented? | Notes |
|---------|------------|-------------|-------|
| Access control | All frameworks | Partial | UI-layer RBAC; no server-side enforcement |
| Authentication | All frameworks | No | No login system; profile switcher only |
| Audit logging | IEC 62443, SOC 2, ISO 27001 A.8.15, 21 CFR Part 11 | Partial | `activity_logs`: actor from the session, IP, device, request id, outcome, field-level before/after; hash chain with an integrity check (keyed HMAC from `SECRETS_ENC_KEY` for new entries, plain SHA-256 for older ones), append-only triggers, hourly chain-head anchors kept outside the database, sensitive-action alerts. Tamper-evident, not tamper-proof: the guarantees against someone holding the application's database login apply only when the application uses a separate login limited by `audit-guard --runtime-role` and a key is set; in the default single-login install that login can switch the triggers off. No electronic signatures, so not a 21 CFR Part 11 control on its own (docs/features/audit-log.md) |
| Data encryption at rest | GDPR, ISO 27001 | Partial | DB encryption is managed by the database host; secrets not encrypted at app level |
| Data encryption in transit | All frameworks | Yes | HTTPS/TLS via the reverse proxy |
| Session management | OWASP | No | No sessions; localStorage-based |
| Input validation | OWASP | Partial | Zod on selected endpoints |
| Vulnerability management | ISO 27001 | Partial | `minimumReleaseAge` supply-chain protection; no CVE scanning |
| Incident response | SOC 2, ISO 27001 | No | No formal incident response process |
| Data retention | GDPR | Partial | Configurable retention policies for telemetry; audit log kept at least 365 days (configurable, pruned with a chain checkpoint) |
| Data minimisation | GDPR | No | All telemetry stored indefinitely without default limits |
| Right to erasure | GDPR | No | No user data deletion workflow. Deleting a user does not remove their audit log entries (append-only, kept until retention) |

---

## IEC 62443 Alignment (Industrial Cybersecurity)

| Requirement Area | Status | Gap |
|-----------------|--------|-----|
| 6.1 — Identification & Authentication | Partial | No formal user authentication |
| 6.2 — Use Control | Partial | RBAC implemented UI-side only |
| 6.3 — System Integrity | No | No integrity checks on telemetry data |
| 6.4 — Data Confidentiality | Partial | TLS in transit; secrets not encrypted at rest |
| 6.5 — Restricted Data Flow | No | Open CORS; no network segmentation |
| 6.6 — Timely Response to Events | Yes | Alarm engine + webhooks |
| 6.7 — Resource Availability | No | No rate limiting at infrastructure level |

---

## GDPR Considerations

If this platform is used to process data about individuals (e.g., operator activity logs, user accounts):

| Requirement | Current State | Action Needed |
|------------|--------------|---------------|
| Lawful basis for processing | Not documented | Define and document |
| Data subject access | Not implemented | Build user data export |
| Right to erasure | Not implemented | Build user data deletion. Audit log entries cannot be erased early (append-only); document this in the privacy notice |
| Data retention limits | Partial (telemetry only) | Extend to activity_logs, user records |
| Data breach notification | Not automated | Define incident response process |

---

## Third-Party Data Transfer: AI Advisor (Groq)

AI Advisor (the Advisor chat and AI Reports) sends plant data to an external AI service,
Groq (`api.groq.com`, through `GROQ_API_KEY`). This is a transfer of customer data to a third
party and must be covered by the customer's agreement. Nothing is sent when `GROQ_API_KEY` is
not set; AI Reports then show the computed figures only.

What is sent:

- **Advisor chat:** the question (at most 2,000 characters), up to four earlier messages of the
  conversation (each cut to 1,000 characters), the selected time range and time zone, the name
  of the selected project or asset, and the results of the read-only lookups the model asks for:
  asset ids, names and device identifiers, metric names, readings and statistics, alarm names,
  messages, severities and times, alarm rule limits, asset attribute values, platform counts
  (number of assets, users and connected brokers, shown only to roles that see them elsewhere)
  and configuration change records from the audit log (what changed, when, and the **display
  name and role** of who changed it; URL, key, token, secret and password fields are hidden).
- **AI Reports:** the computed figures of the report (asset, metric and alarm names and the
  numbers, no asset ids), the list of the report's assets with their ids, and the results of the
  same read-only lookups, kept to the report's assets and period.

What is not sent: usernames, email addresses, passwords, session or CSRF tokens, API client
secrets, webhook URLs and other credentials, and the security log. Who asked is not sent either.

Every transfer is recorded in the Activity Log (`ai.question` with the question's length and the
lookups used, not its text; `ai.report` with scope, period, mode and lookups). Text inside the
data (asset, alarm and metric names typed by users or devices) is marked to the model as
untrusted data that must not be followed as instructions. See `docs/features/ai-report.md`.

---

## Recommended Compliance Actions

**Immediate:**
1. Implement proper authentication (SSO via OIDC or SAML) — closes the largest compliance gap
2. Hash API client secrets — closes data confidentiality gap

**30–90 Days:**
3. Restrict CORS to known origins
4. Add server-side role enforcement on write endpoints
5. Add retention policies for `activity_logs` and `alarm_history`
6. Document data processing purposes

**180 Days:**
7. Perform a formal IEC 62443 gap assessment
8. Implement HMAC signing on webhook deliveries
9. Add automated dependency vulnerability scanning (Snyk, npm audit)
