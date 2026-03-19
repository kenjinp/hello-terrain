---
# hello-terrain-qode
title: Reduce quadtree update churn
status: completed
type: task
priority: normal
created_at: 2026-03-19T11:32:20Z
updated_at: 2026-03-19T11:32:59Z
---

Reduce unnecessary quadtree invalidation in the raycast character controller example.

## Checklist
- [x] Add movement hysteresis before updating quadtree origin
- [x] Quantize the origin slightly to reduce churn while walking
- [x] Verify lint diagnostics for the scene file

## Notes

- Added `QUADTREE_ORIGIN_HYSTERESIS = 0.35` so the scene only calls `g.set(quadtreeUpdate, ...)` after the snapped player origin moves far enough.
- Added `QUADTREE_ORIGIN_SNAP = 0.25` so tiny per-frame motion does not constantly invalidate the quadtree.
- This keeps `g.run()` every frame, but avoids re-setting `quadtreeUpdate` every frame.