---
# hello-terrain-djjh
title: Fix character grounding and camera collision
status: completed
type: bug
priority: normal
created_at: 2026-03-19T10:48:07Z
updated_at: 2026-03-19T10:49:29Z
---

Resolve issues in the docs raycast character controller example.

## Checklist
- [x] Fix character vertical grounding offset so the model does not sink into terrain
- [x] Add terrain-aware camera collision/clearance so the camera does not pass through terrain
- [x] Fix walk and sprint animations so they continue looping while moving
- [x] Verify lint diagnostics for touched files

## Notes

- Restored a Sketchbook-like ride height above terrain by snapping the controller origin to `terrainY + 0.57 + clearance` instead of almost directly to the surface.
- Moved the shadow marker down to the feet plane and removed the extra positive Y offset on the GLTF tilt container so the Boxman root aligns with the controller origin more cleanly.
- Added terrain-aware camera collision using `terrainRaycast.pick(ray)` along the target-to-camera segment, plus a terrain-query floor clamp at the resolved camera XZ.
- Fixed looping locomotion clips by using `LoopRepeat` with infinite repetitions instead of a single repetition count.