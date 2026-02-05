---
# hello-terrain-0akv
title: Skip semaphores when laneConcurrency unset
status: completed
type: task
priority: normal
created_at: 2026-02-05T00:37:28Z
updated_at: 2026-02-05T00:39:49Z
---

Change @hello-terrain/work lane scheduling so tasks do not acquire lane semaphores when run options omit laneConcurrency or provide an empty object. Preserve current behavior when laneConcurrency has values.

## Checklist
- [x] Update run context/execution to skip semaphore permitting when laneConcurrency absent/empty
- [x] Add tests: (1) omitted laneConcurrency => no concurrency cap; (2) empty laneConcurrency => no concurrency cap; (3) laneConcurrency provided => concurrency cap still enforced
- [x] Run @hello-terrain/work test suite