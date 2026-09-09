---
# hello-terrain-7vyy
title: Move three.js math out of CPU query/projection internals
status: in-progress
type: task
priority: low
created_at: 2026-09-04T16:41:14Z
updated_at: 2026-09-04T16:47:15Z
---

Per AGENTS.md, library internals should not use three.js. Value imports of Vector3/Ray exist in query/cpu-raycast.ts, query/cpu-terrain-cache.ts, projection/cubeSphere.ts, projection/torus.ts, and CpuSurfaceOps.surfacePosition writes into a three Vector3 (projection/types.ts). Results returned to consumers may stay Vector3, but internal math should use plain {x,y,z} / Float64 scratch, converting at the public boundary (TerrainQuery/TerrainRaycast/TerrainMesh.raycast).