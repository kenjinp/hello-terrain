---
# hello-terrain-6ylt
title: 'Pointer picking: drop bounds-only phantom hits; support onPointerDown on <Terrain>'
status: completed
type: feature
priority: normal
created_at: 2026-06-17T16:32:20Z
updated_at: 2026-06-17T16:36:47Z
---

Two related asks from the torus example user report:

1. Clicking near (but not on) the torus drops a sphere on the invisible bounding shell. If the ray does not meet the actual surface, nothing should be placed. Root cause: projection.cpu.raycast falls back to the coarse bounds-only shell even when the precise surface query exists and genuinely missed.

2. Make onPointerDown work directly on the <Terrain> component (so the example no longer needs an invisible enclosing pick sphere).

Findings:
- TerrainMesh already implements a custom raycast() that routes R3F pointer rays through terrainRaycast.pick, and Terrain spreads primitive props (incl. R3F handlers) onto the mesh. So onPointerDown on <Terrain> already works; TerrainRaycastHoverScene already uses onPointerMove + event.point. The missing piece is that pick returns a phantom bounds-only hit on a miss.

Plan / Checklist:
## Checklist
- [x] Add boundsFallback?: boolean to RaycastOptions (default true = current behavior)
- [x] Honor it in flat, cubeSphere, torus projection raycast (return null instead of bounds-only when false)
- [x] TerrainMesh.raycast passes { boundsFallback: false } so pointer events only fire on real surface hits
- [x] Torus example: remove invisible pick sphere, attach onPointerDown to <Terrain>, use event.point
- [x] Cube-sphere example: same treatment for consistency
- [x] Update apps/docs to reflect onPointerDown-on-Terrain pattern + boundsFallback option (raycasting.mdx, projection.mdx)
- [x] Typecheck / lint (three + docs typecheck pass, three lint clean, 62 tests pass)