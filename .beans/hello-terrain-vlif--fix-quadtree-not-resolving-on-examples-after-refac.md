---
# hello-terrain-vlif
title: Fix quadtree not resolving on /examples after refactor
status: completed
type: bug
priority: high
created_at: 2026-07-01T01:20:53Z
updated_at: 2026-07-01T01:46:06Z
---

## Root cause

The param refactor added an equality gate to `graph.set()` (`param equals`) and introduced the `cameraView` param with `equals: cameraViewEquals`. The docs scenes drove it with a reused scratch: `g.set(cameraView, readCameraView(camera, scratchRef.current))`.

`graph.setParam` retains the caller object as its comparison baseline (`node.bound.value = next`). Because `readCameraView` mutated that same scratch in place each frame, on frame 2+ `prev === next` (same mutated object), so `cameraViewEquals` always returned true -> the quadtree froze after frame 1. With `<Bounds fit observe>` moving the camera, the terrain never resolved on /examples.

## Fix (no per-frame allocation, no changes to @hello-terrain/work)

Keep the allocation-free "fill a reused scratch and push it every frame" contract
and make the change-detector handle it. `createCameraViewEquals` is now a stateful
comparator that keeps its own snapshot of the last accepted value:

- When the same object instance is pushed again (`prev === next`, the reused-scratch
  case), it compares the live contents against that snapshot instead of against
  itself, so mutations (including rotation-only changes) are detected.
- Snapshots live in a `WeakMap` keyed by the pushed object's identity, so distinct
  terrain instances never share change-detection state (respects the no-module-state
  rule) and nothing leaks once a scratch is GC'd.
- When two independent objects are compared (`prev !== next`), `prev` is already a
  stable baseline, so it falls back to a direct field comparison and retains no
  snapshot.
- Each scratch allocates exactly one snapshot for its lifetime — never one per frame.

`readCameraView(camera, out, cameraOrigin?)` keeps filling the caller's scratch. The
React runner now hands its persistent scratch straight to `graph.set(cameraView, ...)`
instead of allocating a wrapper object each frame (fixes the runner's rotation-only
freeze too). Also removed the invalid leftover `copy:` param options and the stale
`cloneCameraView` import/export from the earlier attempt.

## Verification
- New unit test `cameraView.test.ts` locks in reused-scratch detection, per-instance
  isolation, direct-object comparison, and hysteresis
- typecheck: three + react + docs pass
- tests: three 90, react 11 pass
- Visual: /examples quadtree resolves into multiple LOD tiles (tile-colors on)

## Checklist
- [x] Stateful WeakMap comparator handles reused scratch (no per-frame alloc)
- [x] readCameraView keeps the scratch (`out`) signature
- [x] React runner pushes persistent scratch (no per-frame wrapper alloc)
- [x] Remove dead copy options + stale cloneCameraView refs
- [x] Add cameraView equals unit test
- [x] Typecheck + tests + visual verification