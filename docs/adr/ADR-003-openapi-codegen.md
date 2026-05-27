# ADR-003: Contract-First API with OpenAPI Codegen

**Status:** Accepted  
**Date:** 2025-04-27  
**Confidence:** High

---

## Context

The platform has a React frontend that consumes a Node.js REST API. Keeping the client and server in sync requires either runtime validation, manual synchronisation, or code generation.

---

## Decision

Use an **OpenAPI 3.1 specification** as the contract, with **Orval** for code generation of:
- TanStack Query v5 React hooks (`lib/api-client-react`)
- Zod validation schemas (`lib/api-zod`)

---

## Alternatives Considered

| Approach | Reason Not Chosen |
|----------|------------------|
| Manual types | Error-prone; drifts over time |
| tRPC | Tight coupling between client/server packages; breaks REST conventions needed for external consumers |
| GraphQL | Overkill for this domain; no existing GraphQL client infrastructure |
| Swagger Codegen (Java-based) | Heavy toolchain; not TypeScript-native |
| openapi-typescript | Generates types but not hooks; would still need manual React Query wiring |

---

## Tradeoffs

| Pro | Con |
|-----|-----|
| Single source of truth for API contract | OpenAPI spec must be kept in sync with route handlers manually |
| Generated hooks have consistent error handling | Regeneration required after every spec change |
| External consumers get a standard OpenAPI spec | `orval` config complexity for multiple output targets |
| Zod schemas reused for runtime validation | |

---

## Consequences

- `lib/api-spec/src/openapi.yaml` must be updated whenever routes change
- `pnpm --filter @workspace/api-spec run codegen` must be run after spec changes
- `lib/api-zod/src/index.ts` must only contain `export * from "./generated/api";`
- `info.title` in the spec controls generated filenames — do not change it
- Generated files in `lib/api-client-react/src/generated/` must not be manually edited
