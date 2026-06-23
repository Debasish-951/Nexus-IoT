---
name: Local dev empty-DB UX break
description: Why "half the menus don't work" when cloning and running locally — and the fix.
---

## The rule
Always run `pnpm --filter @workspace/db run seed` after `push` when setting up locally.
Without it the users table is empty, `currentUser` is null, `can()` returns false for every
permission check, and all RoleGuard-gated elements (create/edit/delete buttons, forms, etc.)
are hidden — making ~half the UI appear broken.

## Why
`UserContext.tsx` calls `useListUsers()` on startup. If the DB has no users → `users = []`
→ `currentUser` stays `null` → `can(permission)` always returns `false`.
The default context has `can: () => true`, but the Provider overrides that.
Sidebar navigation links are NOT permission-gated so they still work, creating the
illusion that "half" of things work.

## How to apply
- Seed script: `lib/db/src/seed.ts` (idempotent, uses fixed UUIDs with ON CONFLICT DO NOTHING)
- npm script: `pnpm --filter @workspace/db run seed`
- README local setup step 5 explains this with a plain-language note
- Affects any fresh clone — Replit has pre-seeded data so it's invisible there
