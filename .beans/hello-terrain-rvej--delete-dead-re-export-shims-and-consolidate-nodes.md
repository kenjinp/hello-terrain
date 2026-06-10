---
# hello-terrain-rvej
title: Delete dead re-export shims and consolidate nodes/ into tsl/
status: todo
type: task
created_at: 2026-06-10T02:13:15Z
updated_at: 2026-06-10T02:13:15Z
---

From the terrainGraph review: the spec names the shader layer tsl/, but implementations live in nodes/ with tsl/* files as one-line export shims (except tsl/elevation.ts which is real while nodes/elevation/elevation.ts shims back to it).

Entirely dead files (nothing imports them): compute/gpu.ts, nodes/tile/ (all 3 files), nodes/elevation/ (all 3 files), nodes/library/index.ts.

Also dead exports: createTileRender (gpu/tile.ts), readElevationFieldVertex / readElevationFieldAtPositionLocal (gpu/elevation-field.ts), sampleTerrainFieldNormal + placeholder Texture3DBackend (gpu/terrainFieldStorage.ts), unused gpu/worldPosition.ts exports, TerrainElevationSample (query/types.ts).

Move implementations from nodes/ into tsl/ per spec/architecture.md, delete nodes/, update ~5 internal imports (gpu/worldPosition.ts, gpu/tile.ts, query/terrain-sampler.ts, query/gpuSpatialIndex.ts, tests/skirt.test.ts).