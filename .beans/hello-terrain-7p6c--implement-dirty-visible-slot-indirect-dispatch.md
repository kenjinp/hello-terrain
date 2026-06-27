---
# hello-terrain-7p6c
title: Implement dirty-visible-slot indirect dispatch
status: completed
type: task
priority: normal
created_at: 2026-06-27T22:52:33Z
updated_at: 2026-06-27T23:17:27Z
---

Implement Phase 3 dirty-visible compute dispatch now that slot-addressed storage plumbing exists. Add an internal compute pipeline instance source for dirty-visible slots, upload dirty visible slot IDs to GPU, dispatch standard terrain compute and tile bounds over dirtyVisibleCount, preserve correctness for readback/query snapshots, and validate with focused tests plus GPU lab scenarios.

## Checklist

- [x] Add a dirty-visible slot GPU storage/upload task.
- [x] Add an internal compute pipeline instance source for dirty-visible slots.
- [x] Switch standard terrain compute to dispatch `dirtyVisibleCount` and map dispatch index to `fieldSlot`.
- [x] Update tile bounds reduction for dirty-visible slots or document the conservative fallback.
- [x] Validate cold, drift, and teleport scenarios in the GPU lab.

## Results

- Added dirty-visible slot GPU storage and upload tasks, exposed through `terrainTasks`.
- Added an internal dirty-visible-slot instance source to the compute pipeline, so dispatch index maps through the uploaded dirty slot list before writing tile field storage.
- Switched standard terrain field compute to run only when `dirtyVisibleCount > 0`.
- Switched tile bounds reduction to dispatch over the dirty visible slot list and write bounds back to the real field slot.

## Verification

- `CI=true pnpm --filter @hello-terrain/three run typecheck`
- `CI=true pnpm exec oxlint packages/three/src/gpu/compute.ts packages/three/src/gpu/leafStorage.ts packages/three/src/tasks/quadtree.task.ts packages/three/src/tasks/compute.task.ts packages/three/src/tasks/tile-bounds.task.ts packages/three/src/tasks/graph.ts packages/three/src/tasks/graph.types.ts`
- `CI=true pnpm --filter @hello-terrain/three run build`
- `CI=true pnpm --filter @hello-terrain/docs run build`
- GPU lab cold/teleport smoke: `earth-sphere-surface-load --warmup-frames 0 --measure-frames 1 --max-nodes 1024 --inner-tile-segments 61 --summary` passed with `dirtyVisibleCount=768`, terrain dispatch `[12288,1,1]`, bounds dispatch `[1,1,768]`, and `gpuComputeMs.mean=2.69`.
- GPU lab warm reuse smoke: `earth-sphere-surface-load --warmup-frames 1 --measure-frames 2 --max-nodes 1024 --inner-tile-segments 61 --summary` passed with `dirtyVisibleCount=0`, no compute passes, and no GPU timing samples.
- GPU lab drift smoke: `earth-sphere-orbit-surface-center --warmup-frames 1 --measure-frames 3 --max-nodes 1024 --inner-tile-segments 61 --summary` passed with `dirtyVisibleCount.max=1`, terrain dispatch `[16,1,1]`, bounds dispatch `[1,1,1]`, and `gpuComputeMs.mean=0.096`.
- GPU lab 4098-node mini-suite: center and edge orbit-to-surface cases passed with terrain dispatches matching dirty counts (`480 -> [7680,1,1]`, `141 -> [2256,1,1]`). Corner failed only the existing `samples-valid` assertion because all fixed sample points were outside the visible/cached set when culling was active; dirty dispatch still matched its dirty count (`89 -> [1424,1,1]`).
