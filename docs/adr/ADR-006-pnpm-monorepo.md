# ADR-006: pnpm Monorepo with Shared Libraries

**Status:** Accepted  
**Date:** 2025-04-27  
**Confidence:** High

---

## Context

The platform has a frontend and backend that share type definitions, validation schemas, and a database client. These need to be co-located and versioned together to prevent drift.

---

## Decision

Use a **pnpm workspace monorepo** with the following package structure:
- `artifacts/*` — deployable applications (leaf packages)
- `lib/*` — shared libraries (composite TypeScript packages)
- `scripts/` — utility scripts

---

## Alternatives Considered

| Approach | Reason Not Chosen |
|----------|------------------|
| Separate repositories | Type drift between client and server; complex versioning |
| npm workspaces | pnpm is faster, has better disk efficiency (content-addressable store) |
| Turborepo | Additional abstraction not needed for 2-artifact monorepo |
| Nx | Heavy; better for large orgs with many teams |

---

## Tradeoffs

| Pro | Con |
|-----|-----|
| Shared types across packages without publishing | Codegen step required after API spec changes |
| Single `pnpm install` for all packages | Build order must be managed (TypeScript composite project references) |
| `catalog:` pins shared dependency versions | More complex `tsconfig.json` hierarchy |
| Supply-chain protection via `minimumReleaseAge` | |

---

## Consequences

- `lib/*` packages use `composite: true` in `tsconfig.json` — emit declarations via `tsc --build`
- `artifacts/*` packages are leaf nodes — use `tsc --noEmit` only; never emit declarations
- Root `tsconfig.json` is a solution file listing only `lib/*` packages
- `artifacts/*` must never import from each other — only from `lib/*`
- Adding a new shared lib requires adding it to root `tsconfig.json` references
