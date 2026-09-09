---
# hello-terrain-qacq
title: Stop sharing the quadtreeUpdate default object across terrain graphs
status: in-progress
type: bug
priority: high
created_at: 2026-09-04T16:41:14Z
updated_at: 2026-09-04T16:47:14Z
---

graph.set() binds a param graph-locally, but the initial bound value is `paramRef.get()` — the same module-level object for every graph. The documented pattern `graph.set(quadtreeUpdate, prev => { prev.cameraOrigin.x = ...; return prev })` (README, blog, packages/react/src/useTerrainRunner.ts:96) therefore mutates one shared object. quadtreeUpdateTask (packages/three/src/tasks/quadtree.task.ts:53) also assigns `tileElevationRange` onto it, so two terrains share one camera origin and the last terrain's elevation cache wins. Verified with two graphs: both read x=222 after A set 111 and B set 222.

## Checklist
- [ ] In @hello-terrain/work, clone/structured-copy object initials when binding, or require params to declare an `initial: () => T` factory
- [ ] Make quadtreeUpdateTask stop mutating the param object; keep tileElevationRange in task-local state passed to update()
- [ ] Update useTerrainRunner, READMEs, blog post to use immutable updates (`{ ...prev, cameraOrigin: {...} }`) or a dedicated cameraOrigin param
- [ ] Add a work test: two graphs binding the same object param do not alias