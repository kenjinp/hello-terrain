---
# hello-terrain-dsgl
title: Implement next dirty-visible GPU update slice
status: completed
type: task
priority: normal
created_at: 2026-06-27T03:18:19Z
updated_at: 2026-06-27T22:52:33Z
---

Continue the culling-aware incremental update implementation by moving beyond telemetry toward dirty-visible GPU work where safe. Inspect current compute/storage addressing, implement the smallest correct slice, validate with type/tests/GPU smoke, and document any remaining blockers.

## Checklist

- [x] Inspect compute, field storage, bounds, and sampler addressing assumptions.
- [x] Choose the smallest safe next implementation slice.
- [x] Implement dirty-visible or prerequisite slot-addressed GPU plumbing.
- [x] Expose/verify telemetry and dispatch behavior in the GPU lab.
- [x] Run focused validation and update results.

## Selected Slice

Implement Phase 2 slot-addressed storage plumbing:

- Persistent slot metadata in `TileSlotCacheState`.
- Dense visible draw index to field-slot mapping for rendering.
- Spatial index values point to field slots.
- Compute/readback still run a conservative active slot prefix, not dirty-only dispatch yet.

## Results

- Added persistent slot tile metadata and visible draw index to field-slot GPU indirection.
- Changed CPU/GPU spatial index values to field slots.
- Render now maps `instanceIndex -> fieldSlot` before reading tile metadata and terrain fields.
- Compute, tile bounds reduction, and readback now use `activeSlotCount` as a conservative slot prefix.
- GPU lab telemetry now reports `activeSlotCount`.

## Verification

- `CI=true pnpm --filter @hello-terrain/three run typecheck`
- `CI=true pnpm --filter @hello-terrain/three exec vitest run src/quadtree/tileSlotCache.test.ts src/quadtree/leafIndex.test.ts src/quadtree/visibility.test.ts`
- `CI=true pnpm --filter @hello-terrain/docs run typecheck`
- `CI=true pnpm exec oxlint packages/three/src/types.ts packages/three/src/gpu/leafStorage.ts packages/three/src/gpu/worldPosition.ts packages/three/src/gpu/tile.ts packages/three/src/quadtree/tileSlotCache.ts packages/three/src/quadtree/tileSlotCache.test.ts packages/three/src/quadtree/leafIndex.ts packages/three/src/quadtree/leafIndex.test.ts packages/three/src/tasks/quadtree.task.ts packages/three/src/tasks/graph.ts packages/three/src/tasks/graph.types.ts packages/three/src/tasks/positions.task.ts packages/three/src/tasks/compute.task.ts packages/three/src/tasks/tile-bounds.task.ts packages/three/src/tasks/terrain-query.task.ts apps/docs/src/components/GpuAgentLab/GpuAgentLab.tsx scripts/run-gpu-agent-lab.js`
- `CI=true pnpm --filter @hello-terrain/docs run build`
- `node scripts/run-gpu-agent-lab.js --url http://127.0.0.1:3000/agent-gpu-lab.html --scenario earth-sphere-surface-load --warmup-frames 1 --measure-frames 2 --max-nodes 1024 --inner-tile-segments 61 --summary`
- `git diff --check`

## Remaining

- Phase 3 still needs dirty-visible-slot indirect dispatch so compute work follows `dirtyVisibleCount` instead of `activeSlotCount`.
