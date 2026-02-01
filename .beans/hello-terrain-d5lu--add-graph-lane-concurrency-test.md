---
# hello-terrain-d5lu
title: Add graph lane concurrency test
status: completed
type: task
priority: normal
created_at: 2026-02-01T02:41:28Z
updated_at: 2026-02-01T02:41:44Z
---

Add a vitest case in packages/work/src/graph/graph.test.ts covering lanes and laneConcurrency behavior.

## Checklist
- [x] Add deterministic test for same-lane concurrency cap
- [x] Add deterministic test for cross-lane concurrency
- [x] Keep it timing-free (use deferred promises)