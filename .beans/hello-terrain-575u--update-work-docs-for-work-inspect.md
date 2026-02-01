---
# hello-terrain-575u
title: Update work docs for work() + inspect()
status: completed
type: task
priority: normal
created_at: 2026-02-01T14:33:15Z
updated_at: 2026-02-01T15:03:07Z
---

Update docs examples to use the current task API pattern: call get() first, call work() exactly once, return the work() result. Also document graph.inspect() and show a basic example.

## Checklist
- [x] Find all work docs/examples that call task() without work()
- [x] Update examples to use single work() call pattern
- [x] Add graph.inspect() section + example
- [x] Verify docs build/lint if available