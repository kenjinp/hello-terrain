---
# hello-terrain-791z
title: Optimize terrain stamp sampling performance
status: completed
type: task
priority: normal
created_at: 2026-03-19T12:52:24Z
updated_at: 2026-03-19T12:54:50Z
---

Investigate the FPS drop after adding terrain stamps to the raycast character controller scene and implement practical optimizations to reduce the runtime cost.

## Checklist
- [x] Inspect current terrain stamp sampling path and identify likely hot spots
- [x] Implement a lower-cost stamp composition approach for the scene
- [x] Verify touched files with lint diagnostics

## Notes

- The main runtime cost was that the elevation callback sampled one terrain stamp texture per active stamp for every terrain sample.
- Replaced that with a precomposed stamp field built in JS from only the scene's referenced assets, then sampled that field once in the elevation callback.
- Kept Suspense gating in place so the scene still waits for the referenced source stamp assets before composing the field.
- The current scene now pays the expensive multi-stamp composition cost once per stamp-layout change instead of on every terrain sample.
- `ReadLints` reported no diagnostics for the touched files.