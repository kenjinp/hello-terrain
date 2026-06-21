---
# hello-terrain-dcmq
title: 'API cleanup: unify tile bounds, consolidate radius/center, tidy UpdateParams'
status: completed
type: task
priority: normal
created_at: 2026-06-21T00:31:16Z
updated_at: 2026-06-21T00:41:51Z
---

Post-camera-offset-removal API improvements (no back-compat required).

## Checklist
- [x] #1 Removed dead Topology.center/radius fields; consolidated onto SurfaceProjection (terrain-query.task reads projection.radius)
- [x] #2 Extracted shared boundingSphereFromPoints helper (centroid + max-distance); used in flat, infiniteFlat, cubeSphere, torus tileBounds (eliminates flat datum bug class structurally)
- [x] #3 UpdateParams.tileElevationRange takes TileId; provider built once (not per-frame) in quadtreeUpdateTask
- [x] #4 LodCriteria discriminated union for distance vs screen; removed dead UpdateParams.hysteresis + screen fallback
- [x] Updated flat.test.ts expectation (tight sqrt(halfDiag^2 + halfSpan^2) radius); cubeSphere/torus tests use projection.radius
- [x] Updated docs (topology.mdx Topology type, terrain-query.mdx tileElevationRange signature)
- [x] Typecheck (all packages) + quadtree/tasks tests green

Follow-up: hello-terrain-9ai9 (unify origin param and curved-surface center).