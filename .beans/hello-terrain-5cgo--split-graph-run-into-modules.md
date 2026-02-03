---
# hello-terrain-5cgo
title: Split graph run into modules
status: completed
type: task
priority: normal
created_at: 2026-02-02T20:57:55Z
updated_at: 2026-02-02T22:22:36Z
---

Refactor packages/work/src/graph/run.ts into smaller modules under packages/work/src/graph/run/ for legibility (context, discovery, compiled, executeTask, getters, memo, types).\n\n## Checklist\n- [x] Create run/ folder and types/context modules\n- [x] Extract discovery phase\n- [x] Extract compiled phase\n- [x] Extract shared executeTask/get/work helpers\n- [x] Replace run.ts with thin re-export barrel\n- [x] Run @hello-terrain/work tests + lints