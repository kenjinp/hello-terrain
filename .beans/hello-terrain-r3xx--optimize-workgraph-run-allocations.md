---
# hello-terrain-r3xx
title: Optimize workgraph run() allocations
status: completed
type: task
priority: normal
created_at: 2026-01-31T16:17:42Z
updated_at: 2026-01-31T16:19:03Z
---

Reduce GC churn in per-frame WorkGraph.run() without changing public API.

## Checklist
- [x] Avoid allocating new task refs array when run() targets omitted
- [x] Reuse per-run maps/sets/queues when runs don’t overlap
- [x] Cache per-lane semaphores across runs
- [x] Keep behavior identical; run existing package tests