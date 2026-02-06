---
# hello-terrain-20g9
title: Document laneConcurrency defaults
status: completed
type: task
priority: normal
created_at: 2026-02-05T00:40:44Z
updated_at: 2026-02-05T00:43:43Z
---

Update work package docs to reflect new laneConcurrency behavior: semaphores are only used when laneConcurrency is provided and non-empty.

## Checklist
- [x] Update packages/work/README.md with lanes + laneConcurrency section and example
- [x] Update apps/docs work docs with same semantics + example
- [x] Run a quick docs/work check (docs dev compilation)