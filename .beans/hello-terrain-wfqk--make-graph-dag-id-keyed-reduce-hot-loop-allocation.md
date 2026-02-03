---
# hello-terrain-wfqk
title: Make graph DAG id-keyed + reduce hot-loop allocations
status: completed
type: task
priority: normal
created_at: 2026-02-02T22:51:28Z
updated_at: 2026-02-02T23:23:12Z
---

Implement DAG-as-source-of-truth with id-keyed dag(), add mitata benchmarks for graph hot loop, and reduce allocations/object creation in the hot path (deps tracking, scheduler scratch reuse, fast paths).

## Checklist
- [x] Add mitata benchmark harness for graph (packages/work/benchmarks)
- [x] Refactor dag() to be id-keyed and support removeEdge/topologicalSortIds
- [x] Update graph + run to use dag ids as topology source of truth
- [x] Add per-run computed epoch so cache:none tasks are readable within-run
- [x] Reduce per-task allocations (deps scratch, fewer closures)
- [x] Add dispose() for param subscriptions
- [x] Run tests and compare mitata before/after