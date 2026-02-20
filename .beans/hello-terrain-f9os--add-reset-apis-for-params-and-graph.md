---
# hello-terrain-f9os
title: Add reset APIs for params and graph
status: completed
type: feature
priority: normal
created_at: 2026-02-20T08:26:26Z
updated_at: 2026-02-20T08:27:47Z
---

Implement param.reset() and graph.reset(param?) in @hello-terrain/work with owned-only graph reset semantics, throw-on-missing targeted graph reset, test coverage, and docs updates.

## Checklist
- [x] Add reset() to ParamRef types
- [x] Implement param.reset() runtime behavior
- [x] Add graph.reset(param?) signatures to Graph type
- [x] Implement graph.reset(param?) runtime behavior
- [x] Add param reset tests
- [x] Add graph reset tests
- [x] Update work param documentation
- [x] Run targeted tests and lints