---
# hello-terrain-eenh
title: Add graph work() single-execution test
status: completed
type: task
priority: normal
created_at: 2026-02-01T05:20:02Z
updated_at: 2026-02-01T05:20:18Z
---

Add vitest coverage in packages/work/src/graph/graph.test.ts for the invariant: work() executes at most once per task per computeTask() call.

## Checklist
- [x] Add test that calls work() multiple times and asserts underlying function runs once
- [x] Assert behavior across multiple runs with cache: none