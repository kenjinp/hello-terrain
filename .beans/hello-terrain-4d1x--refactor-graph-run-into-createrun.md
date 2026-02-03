---
# hello-terrain-4d1x
title: Refactor graph run into createRun
status: in-progress
type: task
created_at: 2026-02-02T18:00:55Z
updated_at: 2026-02-02T18:00:55Z
---

Extract graph run scheduler into `packages/work/src/graph/run.ts` via `createRun(deps)`, consolidate topo caching, and fix internal inconsistencies in `graph.ts` (missing `topoOrder`/helpers).

## Checklist
- [x] Define GraphState + cached topoOrder and fix compile helper
- [x] Add `graph/run.ts` with `createRun(deps)`
- [x] Wire `graph.ts` to delegate to `createRun`
- [x] Add/clean up missing helpers and naming mismatches
- [x] Run tests