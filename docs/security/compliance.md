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
| Audit logging | IEC 62443, SOC 2, ISO 27001 A.8.15, 21 CFR Part 11 | Yes | `activity_logs`: actor from the session, IP, device, request id, outcome, field-level before/after; append-only trigger and SHA-256 hash chain with an integrity check; sensitive-action alerts (docs/features/audit-log.md) |
| Data encryption at rest | GDPR, ISO 27001 | Partial | DB encryption is managed by the database host; secrets not encrypted at app level |
| Data encryption in transit | All frameworks | Yes | HTTPS/TLS via the reverse proxy |
| Session management | OWASP | No | No sessions; localStorage-based |
| Input validation | OWASP | Partial | Zod on selected endpoints |
| Vulnerability management | ISO 27001 | Partial | `minimumReleaseAge` supply-chain protection; no CVE scanning |
| Incident response | SOC 2, ISO 27001 | No | No formal incident response process |
| Data retention | GDPR | Partial | Configurable retention policies for telemetry; audit log kept at least 365 days (configurable, pruned with a chain checkpoint) |
| Data minimisation | GDPR | No | All telemetry stored indefinitely without default limits |
| Right to erasure | GDPR | No | No user data deletion workflow |

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
| Right to erasure | Not implemented | Build user data deletion |
| Data retention limits | Partial (telemetry only) | Extend to activity_logs, user records |
| Data breach notification | Not automated | Define incident response process |

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
