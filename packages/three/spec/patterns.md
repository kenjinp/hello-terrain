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
