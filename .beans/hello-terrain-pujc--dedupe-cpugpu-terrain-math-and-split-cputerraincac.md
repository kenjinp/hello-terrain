---
# hello-terrain-pujc
title: Dedupe CPU/GPU terrain math and split CpuTerrainCache
status: completed
type: task
priority: normal
created_at: 2026-06-10T02:13:01Z
updated_at: 2026-06-10T02:28:31Z
---

Refactor @hello-terrain/three to remove duplicated terrain math and split the 821-line cpu-terrain-cache.ts. Public query API stays unchanged.

Hard rule: never merge across the CPU/TSL boundary. TSL stays TSL, CPU stays plain numbers. CPU<->TSL mirrors are only co-located with shared constants, Mirrors: cross-reference comments, and CPU-side parity tests.

## Checklist

- [x] Co-locate CPU + TSL field UV / sphere arc math in gpu/tile.ts; replace copies in cpu-terrain-cache
- [x] Extract TSL helpers: decodeLeafTile, faceUVFromTileLocal, unpackTangentNormal, sphereTangentFrameNormal; refactor worldPosition + sampler
- [x] Unify sampler builders, cache terrainSampleAt result, pass maxLevel through task params
- [x] Extract generic marchSignedDistance loop in cpu-raycast.ts
- [x] Split cpu-terrain-cache.ts into snapshot, tile-lookup, and field-sampling modules
- [x] Run tests, typecheck three/react/docs, update spec references and docs if needed

## Outcome

- New modules: query/terrain-snapshot.ts, query/tile-lookup.ts, query/elevation-field-sampling.ts; cpu-terrain-cache.ts is now a ~520-line assembler.
- gpu/tile.ts gained shared constants (HALF_PI, FIELD_INNER_TEXEL_OFFSET, FIELD_EDGE_EXTRA_TEXELS), CPU variants (tileLocalToFieldUVNumber, sphereTileArcLength), and TSL helpers (decodeLeafTile, faceUVFromTileLocal) + parity tests in gpu/tile.test.ts.
- nodes/cubeSphere.ts gained unpackTangentNormal + sphereTangentFrameNormal (TSL), used by gpu/worldPosition.ts and query/terrain-sampler.ts.
- cpu-raycast.ts march/bisect loops merged into marchSignedDistance.
- terrain-sampler no longer reads the module-scope maxLevel param; CreateTerrainSamplerParams.maxLevel passed from createTerrainSamplerTask.
- spec/terrain-data-model.md documents the new query/ module layout.
- All 120 repo tests pass; packages build; docs unaffected (sampler only consumed via task).