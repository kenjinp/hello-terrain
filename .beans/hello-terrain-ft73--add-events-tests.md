---
# hello-terrain-ft73
title: Add events tests
status: completed
type: task
priority: normal
created_at: 2026-02-01T02:43:23Z
updated_at: 2026-02-01T02:44:25Z
---

Add vitest coverage for the work package events API and emitted graph events.

Note: `packages/work/src/events.ts` is not present; events are emitted via `graph.on()` as `GraphEvent`.

## Checklist
- [x] Inspect existing event emitters
- [x] Add tests verifying key graph events (run start/finish, task start/finish, cacheHit)
- [x] Add error/cancel event coverage if applicable