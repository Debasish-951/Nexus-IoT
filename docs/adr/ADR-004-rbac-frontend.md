# ADR-004: Frontend-Only RBAC

**Status:** Accepted (with known limitation)  
**Date:** 2025-04-27  
**Confidence:** High

---

## Context

The platform needs role-based access control to prevent operators from performing actions beyond their permission level (e.g., deleting assets, managing users). The question is where to enforce these rules — in the API layer, the UI layer, or both.

---

## Decision

Implement RBAC **in the frontend UI only** using `UserContext`, `RoleGuard`, `ReadOnlyBanner`, and `can()` permission checks.

Machine clients (API key consumers) are governed by **scopes** on their API client record.

---

## Rationale

The platform's primary users are trusted industrial operators within the same organisation. The "threat model" at initial release assumes:
- No hostile users with direct network access to the API
- No cross-tenant data isolation requirements
- Machine API consumers are controlled via client credentials with scopes

Implementing server-side role enforcement would require:
- A session or JWT per human user (no login system exists)
- Middleware on every write endpoint checking the role header
- Trust in `X-Actor-Role` header (which is client-controllable — not suitable for security enforcement)

---

## Alternatives Considered

| Approach | Reason Not Chosen |
|----------|------------------|
| Full server-side RBAC | Requires authentication system (login/session) which is not in scope for v1 |
| JWT per user | Adds complexity; requires token issuance, refresh, storage |
| Both client + server | Ideal but deferred to v2 with proper auth system |

---

## Tradeoffs

| Pro | Con |
|-----|-----|
| Simple to implement and reason about | Any user can switch to admin profile — no access control at the API level for humans |
| No session management overhead | API endpoints are effectively open to anyone with network access |
| Fast iteration — add permissions without API changes | Does not satisfy IEC 62443 or SOC 2 authentication requirements |

---

## Consequences

- `UserContext.can(permission)` is the enforcement point in the UI
- `RoleGuard mode="hide"` removes elements from DOM; `mode="disable"` grays them out
- `X-Actor-*` headers are used for **audit attribution only** — not for authorization
- This decision must be revisited before any public-facing deployment

---

## Future State

Replace with Replit Auth (OpenID Connect) or Clerk to tie roles to authenticated identities. Server-side middleware can then validate the user's role from a trusted JWT claim rather than a client-supplied header.
