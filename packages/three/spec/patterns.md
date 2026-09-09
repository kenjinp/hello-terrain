# Terrain Task Patterns

This document captures recurring implementation patterns for `@hello-terrain/three` task graph code.

## Create/Update Task Pair for Stateful Buffers

### Problem

In the task graph, the `task((get, work) => ...)` getter function can run each graph execution when dependencies are invalidated. Any mutable local variable declared inside that getter is therefore not stable runtime state.

Example anti-pattern:

- A per-frame task declares `let scratch: Float32Array | undefined` in the getter.
- The getter runs again next frame.
- `scratch` is reset and reallocated, defeating reuse and causing subtle bugs/perf regressions.

### Required Pattern

When mutable state must persist across frame updates:

1. Create a `create*Task` that allocates and returns the long-lived state object.
2. Create an `update*Task` that depends on the create task and mutates the returned object in `work(...)`.
3. Downstream per-frame tasks depend on `update*Task` and consume the updated state object.

This mirrors the existing uniforms pattern (`createUniformsTask` + `updateUniformsTask`).

### Why This Matters

- Preserves allocation-free hot paths.
- Prevents accidental state resets when dependencies update.
- Keeps task responsibilities explicit:
  - create tasks own lifecycle/allocation
  - update tasks own frame mutation
  - sink tasks own upload/application

## Runtime publication boundaries

Create/update task pairs now live inside an instance-owned backend slot. A candidate slot can mutate its own buffers; the published slot remains stable until successful publication and completion of pending copies. Retired slots can be reused after GPU completion. Configuration and view inputs are copied before graph binding. Material context nodes are per runtime and shared between that runtime's slots so user material composition survives publication.

Never use a timer as a GPU retirement fence. Retire replaced binding geometry/attributes after submitted draws finish, and release slot-owned compute/storage resources through the Three backend. CPU leases own independent immutable records and survive runtime teardown until release. Arbitrary advanced graph consumers own their own equivalent lifetime protocol.

## Select targets before invalidating GPU production

A changed camera is an input to selection, not proof that elevation or mesh data changed. Run the retained selection graph with `targets: [quadtreeUpdateTask]`, compare the selected tile identities with the published layout, and request candidate production only when needed. Keep allocation tasks such as `quadtreeLeavesTask` dependent on capacity, not camera position.

Do not evaluate this selection pass by mutating the currently published graph: its CPU leaf records must keep matching the visible GPU buffers and deferred readback source. A separate retained CPU graph provides cached selection without disturbing publication ownership.
