---
# hello-terrain-kxgx
title: Change work() invariant to single-call
status: completed
type: task
priority: normal
created_at: 2026-02-01T13:39:58Z
updated_at: 2026-02-01T13:44:04Z
---

Update graph runtime: remove invariant that task compute must return work() value; instead throw if task calls work() more than once per compute.

## Checklist
- [x] Update graph work() implementation to throw on 2nd call
- [x] Remove return-value invariant check
- [x] Update graph tests accordingly
- [x] Run work package tests