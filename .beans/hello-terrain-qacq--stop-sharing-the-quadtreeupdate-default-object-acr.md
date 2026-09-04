---
# hello-terrain-qacq
title: Stop sharing the quadtreeUpdate default object across terrain graphs
status: completed
type: bug
priority: high
created_at: 2026-09-04T16:41:14Z
updated_at: 2026-09-04T17:05:00Z
---

graph.set() binds a param graph-locally, but the initial bound value is `paramRef.get()` — the same module-level object for every graph. The documented pattern `graph.set(quadtreeUpdate, prev => { prev.cameraOrigin.x = ...; return prev })` (README, blog, packages/react/src/useTerrainRunner.ts:96) therefore mutates one shared object. quadtreeUpdateTask (packages/three/src/tasks/quadtree.task.ts:53) also assigns `tileElevationRange` onto it, so two terrains share one camera origin and the last terrain's elevation cache wins. Verified with two graphs: both read x=222 after A set 111 and B set 222.

## Checklist
- [x] In @hello-terrain/work, clone/structured-copy object initials when binding, or require params to declare an `initial: () => T` factory
- [x] Make quadtreeUpdateTask stop mutating the param object; keep tileElevationRange in task-local state passed to update()
- [x] Update useTerrainRunner, READMEs, blog post to use immutable updates (`{ ...prev, cameraOrigin: {...} }`) or a dedicated cameraOrigin param
- [x] Add a work test: two graphs binding the same object param do not alias

## Resolution

- `@hello-terrain/work`: `graph.set()` now seeds the graph-local binding through `cloneParamInitial()`
  (`src/utils.ts`), which deep-copies plain objects/arrays and leaves functions, class instances,
  typed arrays, Maps, etc. by reference. Both the reset baseline and the live value are separate
  copies, and `graph.reset()` hands out a fresh copy again. Tests cover two-graph isolation,
  takeover-from-subscription, reset, plain-array vs typed-array handling, function params, and
  that `set(p, prev => prev)` still bumps the version / dirties downstream.
- `@hello-terrain/three`: `quadtreeUpdateTask` builds a task-local
  `UpdateParams = { ...quadtreeUpdateConfig, tileElevationRange }` instead of writing the
  cache-capturing closure onto the param value. `UpdateParams.tileElevationRange` JSDoc marks it
  graph-managed.
- `@hello-terrain/react`: `useTerrainRunner` uses an immutable `{ ...prev, cameraOrigin: { x, y, z } }`
  update and reuses a ref-held scratch `Vector3` instead of allocating per frame; hysteresis is unchanged.
- Docs: `packages/three/README.md`, `packages/work/README.md`, `apps/docs` work `param.mdx` /
  `graph.mdx`, the hello-world / elevation-stage blog posts, `elevation-function.mdx`, the three
  Sandpack components and all example scenes now use the immutable update pattern.
