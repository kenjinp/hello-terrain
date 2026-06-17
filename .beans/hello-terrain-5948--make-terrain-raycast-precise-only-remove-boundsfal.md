---
# hello-terrain-5948
title: Make terrain raycast precise-only; remove boundsFallback option
status: completed
type: task
priority: normal
created_at: 2026-06-17T18:02:59Z
updated_at: 2026-06-17T18:06:21Z
---

Follow-up to hello-terrain-6ylt. Decision: raycast.pick should be precise-only everywhere. Remove the boundsFallback option and the coarse bounding-shell fallback entirely (callers that need a result before the query is ready should gate on terrain.ready).

## Checklist
- [x] Remove boundsFallback from RaycastOptions (query/types.ts)
- [x] flat.ts raycast: precise-only (return null when no terrainQuery/precise miss); drop cpuRaycastBoundsOnly import
- [x] cubeSphere.ts raycast: precise-only; drop cubeSphereRaycastBoundsOnly import
- [x] torus.ts raycast: precise-only; drop torusRaycastBoundsOnly import
- [x] Remove cpuRaycastBoundsOnly / cubeSphereRaycastBoundsOnly / torusRaycastBoundsOnly from cpu-raycast.ts (dead code)
- [x] TerrainMesh.raycast: plain pick(ray); update comment
- [x] Update SurfaceProjectionCpu.raycast doc comment (projection/types.ts)
- [x] Docs: remove boundsFallback from projection.mdx + raycasting.mdx
- [x] typecheck + lint + tests (three: typecheck/lint clean, 62 tests pass; docs typecheck pass)