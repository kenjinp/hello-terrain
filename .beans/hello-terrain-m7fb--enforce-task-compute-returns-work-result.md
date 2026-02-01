---
# hello-terrain-m7fb
title: Enforce task compute returns work() result
status: completed
type: task
priority: normal
created_at: 2026-02-01T13:32:39Z
updated_at: 2026-02-01T13:34:05Z
---

Make graph runtime enforce that task compute functions return the value produced by work(() => ...). This prevents returning stale values or bypassing the work boundary.

## Checklist
- [x] Add runtime invariant check in graph
- [x] Add/adjust tests to cover invariant
- [x] Run work package tests