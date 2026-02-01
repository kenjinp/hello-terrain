---
# hello-terrain-0gm5
title: Implement task() node factory
status: in-progress
type: task
created_at: 2026-02-01T01:08:04Z
updated_at: 2026-02-01T01:08:04Z
---

Implement a first-class task node factory (similar to param()) that supports implicit dependency graphs via a typed get(ref) function, and exposes output typing to the TS server/linter.

## Checklist
- [x] Define task types (TaskRef, NodeRef, Getter, TaskDef)
- [x] Implement task() with fluent configuration (lane/cache/tags/displayName)
- [ ] Export task API from package entrypoint (if appropriate)
- [x] Add minimal tests for runtime shape (kind/id/name/options storage)
- [ ] Ensure work package tests pass