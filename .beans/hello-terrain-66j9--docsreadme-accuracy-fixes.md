---
# hello-terrain-66j9
title: Docs/README accuracy fixes
status: in-progress
type: task
priority: normal
created_at: 2026-09-04T16:41:15Z
updated_at: 2026-09-04T16:47:15Z
---

- Root README.md and packages/three/README.md list 'terrain holes, texture painting, overlays, colors, and wetness' — none exist in packages/three/src. Remove or move to a roadmap section.
- apps/docs/content/docs/docs/core/params.mdx: table rows for `topology` and `terrainFieldFilter` have broken columns (unescaped `|` in the type).
- core/elevation-function.mdx refers to `Param<...>`; exported type is `ParamRef`.
- packages/work/README.md 'Semantics' bullet contains literal \\n.
- quadtreeUpdate default distanceFactor is 1.5 in params but criteria.ts falls back to 2 — document/align.
- Undocumented consumer APIs: createTerrainQuery/createTerrainSurfaceQuery/createTerrainRaycast, createComputePipelineTasks (custom compute stages), getDeviceComputeLimits, field storage backends, vElevation/vGlobalVertexIndex varyings.
- React: re-export TerrainSurfaceQuery type (runtime.surfaceQuery uses it).