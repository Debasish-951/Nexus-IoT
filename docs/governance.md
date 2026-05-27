# Documentation Governance

---

## Principles

1. **Documentation is treated as code.** Docs live in the same repository as the source code and are reviewed alongside it.

2. **Update docs whenever implementation changes.** No code change that affects behaviour, API contracts, schema, or security is complete until the relevant documentation is updated.

3. **Never document assumptions as facts.** Use the confidence rating system — mark uncertain sections clearly.

4. **Prefer actual implementation over inferred behaviour.** If you cannot verify something from the source code, mark it with `**Confidence: Low**` and explain why.

5. **Generate diagrams from code where possible.** Use Mermaid diagrams embedded in Markdown. Prefer Mermaid over external tools (Lucidchart, draw.io) to keep diagrams version-controlled.

6. **Maintain a changelog.** All significant documentation updates should be recorded in `DOCUMENTATION_STATUS.md`.

---

## Confidence Rating System

Every document section should carry a confidence rating at the top:

| Rating | Meaning |
|--------|---------|
| **Confidence: High** | Derived directly from implemented and verified source code |
| **Confidence: Medium** | Mostly correct; some aspects inferred or extrapolated from patterns |
| **Confidence: Low** | Aspirational, estimated, or not directly verifiable from code |

---

## Document Ownership

| Document Area | Owner Role |
|--------------|-----------|
| API Reference | Controls Engineer / Developer who changes routes |
| Data Model | Developer who changes Drizzle schema |
| Security Architecture | Administrator / Security Architect |
| ADRs | Architect / Lead Engineer (whoever makes the decision) |
| Runbook | Operations Lead |
| Test Strategy | QA Lead / Developer |

---

## Update Triggers

| Event | Documents to Update |
|-------|-------------------|
| New API route added | `docs/api/api-reference.md`, OpenAPI spec |
| Schema table added/changed | `docs/data/data-model.md`, `docs/data/data-architecture.md` |
| New integration | `docs/api/integration-architecture.md`, `docs/overview/system-landscape.md` |
| Security control changed | `docs/security/security-architecture.md`, `docs/security/threat-model.md` |
| Deployment configuration changed | `docs/architecture/08-deployment-architecture.md`, `docs/operations/runbook.md` |
| New architectural decision | New `docs/adr/ADR-XXX-*.md` |
| Technical debt resolved | Update `docs/review/technical-debt-register.md` |
| New feature added | `docs/overview/project-overview.md`, `docs/review/requirements-traceability.md` |

---

## Document Review Process

1. Docs can be updated by any contributor as part of a code change PR.
2. Significant architecture changes require a new ADR reviewed by the lead architect.
3. The `DOCUMENTATION_STATUS.md` is updated on each significant documentation pass.
4. Outdated sections must be flagged with:

```markdown
> ⚠️ **Outdated:** This section was last verified against code on YYYY-MM-DD. It may not reflect current implementation.
```

---

## Prohibited Practices

- Do not document TODO items as if they are implemented features.
- Do not copy-paste from external sources without attribution and verification against actual implementation.
- Do not leave diagrams that contradict the code — either fix the code, fix the diagram, or flag the discrepancy.
- Do not document internal implementation details that are likely to change frequently in high-level architecture docs; instead, link to the source code.

---

## Diagram Standards

- All architecture diagrams: **Mermaid** (flowchart, sequenceDiagram, erDiagram, C4Context, C4Container, C4Component)
- ER diagrams: Mermaid `erDiagram`
- Sequence diagrams: Mermaid `sequenceDiagram`
- C4 diagrams: Mermaid C4 syntax
- External diagrams (if needed): stored in `docs/diagrams/` as PNG with a corresponding `.mmd` source file

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| May 2026 | Architecture Agent | Initial documentation package created (v1.0) — all docs/overview, docs/architecture, docs/data, docs/api, docs/operations, docs/security, docs/adr, docs/review, README.md |
