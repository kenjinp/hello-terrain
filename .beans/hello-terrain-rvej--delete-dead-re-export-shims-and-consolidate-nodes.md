---
# hello-terrain-rvej
title: Delete dead re-export shims and consolidate nodes/ into tsl/
status: completed
type: task
priority: normal
created_at: 2026-06-10T02:13:15Z
updated_at: 2026-06-10T02:34:35Z
---

From the terrainGraph review: the spec names the shader layer tsl/, but implementations live in nodes/ with tsl/* files as one-line export shims (except tsl/elevation.ts which is real while nodes/elevation/elevation.ts shims back to it).

## Checklist

- [x] Move implementations from nodes/ into tsl/ (cubeSphere, skirt, materials, varyings, voronoi)
- [x] Update internal imports (gpu/tile, gpu/worldPosition, query/terrain-sampler, query/gpuSpatialIndex, tests/skirt.test)
- [x] Delete nodes/ folder and compute/gpu.ts
- [x] Remove dead exports: createTileRender, readElevationFieldVertex/AtPositionLocal, sampleTerrainFieldNormal, Texture3DBackend (public), worldPosition internal helpers, TerrainElevationSample
- [x] Verify: lint clean, 120 tests pass, packages build
