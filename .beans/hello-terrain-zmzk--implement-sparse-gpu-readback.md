---
# hello-terrain-zmzk
title: Implement sparse GPU readback
status: completed
type: task
priority: normal
created_at: 2026-06-27T23:29:29Z
updated_at: 2026-06-27T23:48:59Z
---

Implement the next incremental GPU update phase: keep CPU terrain query/readback snapshots coherent while avoiding full active-slot elevation and tile-bounds readback on clean frames. Add focused validation through type checks and the GPU lab.

## Checklist

- [x] Add compact range readback support for storage buffers.
- [x] Extend terrain snapshots to merge dirty slots while preserving clean resident slot data.
- [x] Wire dirty-visible slot metadata through `terrainReadbackTask`.
- [x] Validate clean, dirty, and orbit-to-surface GPU lab cases.

## Results

- Added compact float32 range readback for WebGPU storage buffers, allowing many dirty slot ranges to be copied into one staging buffer and scattered into CPU snapshot storage.
- Changed terrain snapshots so clean frames promote the cloned spatial index without touching GPU buffers.
- Changed dirty frames to read only dirty visible slot ranges, copy clean currently-visible slot data from the previous front snapshot, then promote the merged back snapshot.
- Passed dirty slot metadata from `terrainReadbackTask` into the CPU terrain cache.

## Verification

- `CI=true pnpm --filter @hello-terrain/three run typecheck`
- `CI=true pnpm exec oxlint packages/three/src/gpu/bufferReadback.ts packages/three/src/query/terrain-snapshot.ts packages/three/src/query/cpu-terrain-cache.ts packages/three/src/tasks/terrain-query.task.ts`
- `CI=true pnpm --filter @hello-terrain/three run build`
- `CI=true pnpm --filter @hello-terrain/docs run build`
- `CI=true pnpm --filter @hello-terrain/three exec vitest run src/quadtree/tileSlotCache.test.ts src/query/tile-elevation-pyramid.test.ts src/query/cubeSphere-query.test.ts src/query/torus-query.test.ts`
- GPU lab cold dirty readback: `earth-sphere-surface-load --warmup-frames 0 --measure-frames 1 --max-nodes 1024 --inner-tile-segments 61 --summary` passed with `dirtyVisibleCount=768` and no failed assertions.
- GPU lab warm clean readback: `earth-sphere-surface-load --warmup-frames 1 --measure-frames 2 --max-nodes 1024 --inner-tile-segments 61 --summary` passed with `dirtyVisibleCount=0`, no compute passes, and no failed assertions.
- GPU lab partial dirty drift: `earth-sphere-orbit-surface-center --warmup-frames 1 --measure-frames 3 --max-nodes 1024 --inner-tile-segments 61 --summary` passed with `dirtyVisibleCount.max=1`, terrain dispatch `[16,1,1]`, bounds dispatch `[1,1,1]`, and no failed assertions.
- GPU lab 4098-node regression: `earth-sphere-orbit-surface-center --warmup-frames 1 --measure-frames 3 --max-nodes 4098 --inner-tile-segments 61 --summary` passed with `dirtyVisibleCount.p50=480`, terrain dispatch `[7680,1,1]`, bounds dispatch `[1,1,480]`, and no failed assertions.
