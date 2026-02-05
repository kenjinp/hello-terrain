---
# hello-terrain-j5ll
title: Add RunReport overlay bars component
status: in-progress
type: feature
created_at: 2026-02-05T01:44:39Z
updated_at: 2026-02-05T01:44:39Z
---

Create a small, out-of-the-way React component for apps/docs that visualizes a graph.run() RunReport as 3 stacked segmented bars: current frame, previous frame (n-1), and per-task maximum observed while mounted. Requirements: stable color per task, tooltips using displayName when present, efficient per-frame updates (rAF polling via getter).

## Checklist
- [x] Inspect RunReport/task timing shape in packages/work
- [x] Implement generic overlay component (SVG or canvas) with stable task colors + tooltips
- [x] Track previous frame breakdown and per-task max while mounted
- [x] Wire into an existing docs scene/example to demonstrate usage
- [ ] Run typecheck/lints for touched files (tsc currently fails in docs due to TS version / `moduleResolution: "bundler"` + `const` type params in `Metrics.tsx`)