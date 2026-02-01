---
# hello-terrain-f5wm
title: Overlay work graph stats in WorkHero
status: completed
type: task
priority: normal
created_at: 2026-02-01T06:01:24Z
updated_at: 2026-02-01T06:02:42Z
---

Add an overlay on the WorkHero canvas showing live graph statistics (last run status/duration/taskCount/cacheHits, plus event counts).

## Checklist
- [x] Capture last RunReport from g.run() and display it
- [x] Track per-run task events via g.on("task:*", ...) and display counts
- [x] Keep overlay lightweight and readable