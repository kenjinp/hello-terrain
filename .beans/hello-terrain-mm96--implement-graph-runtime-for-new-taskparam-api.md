---
# hello-terrain-mm96
title: Implement graph runtime for new task/param API
status: completed
type: task
priority: normal
created_at: 2026-02-01T01:17:12Z
updated_at: 2026-02-01T01:43:26Z
---

Add a new graph runtime that works with the new param() and task() node factories.

## Checklist
- [x] Define graph public types (Graph, RunReport, events)
- [x] Implement graph with add/get/peek/on/run using implicit deps + caching
- [x] Update package exports to expose graph/param/task
- [x] Update/replace old tests to cover new graph and keep suite green

### Notes
- Implemented Option B: tasks can use `work(() => ...)` to ensure side-effectful work executes at most once per run even if dependency discovery causes task body re-entry.