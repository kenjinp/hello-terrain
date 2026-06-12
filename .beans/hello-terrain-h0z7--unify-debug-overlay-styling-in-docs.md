---
# hello-terrain-h0z7
title: Unify debug overlay styling in docs
status: completed
type: task
priority: normal
created_at: 2026-06-12T03:29:54Z
updated_at: 2026-06-12T03:56:16Z
---

Unify styling across docs debug overlays (font size AND spacing).

Root causes:
1. SVG text scaled with viewBox width (differing widths) -> inconsistent font px. Fixed by rendering panel text as HTML px text; SVG/CSS only for graphics.
2. RunTimingBars rows lacked an explicit line-height so they inherited the blog article relaxed line-height, producing oversized vertical gaps vs the DebugStatRows panels (which set leading-4). Fixed by giving RunTimingBars rows a fixed 16px (h-4 + leading-4) rhythm matching DebugStatRows, and a non-wrapping tabular-nums value column.

## Checklist
- [x] Shared debug-overlay tokens + DebugStatRows component (apps/docs/src/lib/debug-overlay.tsx)
- [x] TerrainFieldTextureDebug uses shared tokens
- [x] FpsDebug: HTML rows + sparkline-only SVG
- [x] TerrainTileDebug: HTML rows + CSS fill bar
- [x] RunTimingBars: HTML labels/values + CSS bar segments, consistent 16px row rhythm
- [x] typecheck passes