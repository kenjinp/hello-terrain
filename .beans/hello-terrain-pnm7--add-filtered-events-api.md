---
# hello-terrain-pnm7
title: Add filtered events API
status: completed
type: feature
priority: normal
created_at: 2026-02-01T05:42:47Z
updated_at: 2026-02-01T05:44:37Z
---

Change graph events API to support filtered subscriptions like on("task:*", cb) and on("task:cacheHit", cb), while preserving existing on(cb) behavior for compatibility.

## Checklist
- [x] Update Graph types to add on(typeOrPattern, cb) overloads
- [x] Update graph runtime to route events to exact + wildcard listeners
- [x] Update/add tests for exact + wildcard + legacy on(cb)
- [x] Update docs/examples if needed