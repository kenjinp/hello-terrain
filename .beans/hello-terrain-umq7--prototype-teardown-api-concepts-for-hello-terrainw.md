---
# hello-terrain-umq7
title: Prototype teardown API concepts for @hello-terrain/work
status: completed
type: task
priority: normal
created_at: 2026-11-16T04:10:38Z
updated_at: 2026-11-16T05:23:26Z
---

Game out several API concepts for tearing down values created by tasks (fluent .teardown, ctx.onTeardown, Disposable protocol, resource() helper, manual baseline) plus timing policies (deferred, blocking, eager, exclusive).

## Checklist
- [x] Implement the concepts in packages/work on branch proto/work-teardown
- [x] General (non three.js) scenarios and vitest coverage
- [x] Benchmarks against a baseline copy of src
- [x] Reviewer committee critique
- [x] Final API design doc (packages/work/teardown-lab/DESIGN.md)