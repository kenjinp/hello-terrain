---
# hello-terrain-msav
title: Remove cameraSurfaceOffset double-count in LOD distance
status: completed
type: bug
priority: high
created_at: 2026-06-20T23:23:27Z
updated_at: 2026-06-20T23:25:53Z
---

update() pushed the camera toward the surface by the camera-point elevation (cameraSurfaceOffset), but tileBounds already places each tile bounding sphere at its real per-tile elevation range. The two stacked: every tile was measured ~elevation closer than it really is, so refinement scaled with terrain height (quadtree thought the camera was closer than it was). The per-tile elevation range supersedes the single global camera offset and is strictly more accurate, so the redundant mechanism was removed.

## Checklist
- [x] Remove cameraSurfaceOffset call + cam save/restore in update.ts
- [x] Remove elevationAtCameraXZ computation from quadtree.task.ts (and now-unused Vector3/query refs)
- [x] Remove cameraSurfaceOffset from SurfaceProjectionCpu interface
- [x] Remove cameraSurfaceOffset impl from flat/cubeSphere/torus projections
- [x] Remove elevationAtCameraXZ from UpdateParams
- [x] Update docs (projection.mdx, topology.mdx, terrain-query.mdx) and spec/concepts.md
- [x] Typecheck (three + react) + tests (63 passed)