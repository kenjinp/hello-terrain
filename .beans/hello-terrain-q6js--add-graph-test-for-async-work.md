---
# hello-terrain-q6js
title: Add graph test for async work()
status: completed
type: task
priority: normal
created_at: 2026-02-03T00:11:52Z
updated_at: 2026-02-03T00:13:11Z
---

Add a regression test proving task compute can await an async `work()` callback, and that dependency reads (`get()`) must occur before calling `work()`.

## Checklist
- [x] Add graph test for async work() callback
- [x] Run packages/work tests