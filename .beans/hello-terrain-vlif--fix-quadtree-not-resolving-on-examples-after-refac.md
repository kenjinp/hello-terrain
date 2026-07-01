---
# hello-terrain-vlif
title: Fix quadtree not resolving on /examples after refactor
status: in-progress
type: bug
priority: high
created_at: 2026-07-01T01:20:53Z
updated_at: 2026-07-01T01:27:01Z
---

## Root cause

The refactor added an `equals` change-detection gate to params (`packages/work` `param.set` + `graph.setParam`) and introduced the `cameraView` param with `equals: cameraViewEquals`.

All manual-graph docs scenes drive it with a reused scratch:
`g.set(cameraView, readCameraView(camera, scratchRef.current))`.

`graph.setParam` stores the caller object as the comparison baseline (`node.bound.value = next`). Because `readCameraView` mutates that same scratch in place every frame, on frame 2+ `prev === next` (same mutated object), so `cameraViewEquals(prev, next)` always returns `true` -> version never bumps -> the quadtree freezes after frame 1. With `<Bounds fit observe>` moving the camera, the terrain never resolves for the actual view.

The React runner has a milder variant of the same bug: it shares the `viewProjectionMatrix` array across frames, so pure camera rotation (origin unchanged) is not detected.

Frustum-culling demos use continuously-translating cameras, so origin always changes -> masked the bug.

## Fix

Add an optional `copy` to param options so `equals`-gated params keep an independent snapshot as their comparison baseline, immune to caller-owned scratch mutation. Wire `cameraView` (deep copy) and `residencyAnchors` (clone) to use it.

## Checklist
- [ ] Add `copy` to `ParamOptions`/`ParamRef` (work param.types)
- [ ] Use `copy` in standalone `param.set`/`reset`
- [ ] Use `copy` in `graph.setParam`/`resetBoundParam` and check equals before overwriting baseline
- [ ] Add `cloneCameraView` and set `copy` on `cameraView` param
- [ ] Set `copy: cloneResidencyAnchors` on `residencyAnchors` param
- [ ] Add regression tests (param + graph scratch-reuse)
- [ ] Run work + three + react test suites