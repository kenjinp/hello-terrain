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

## Import three.js Only Through Public Entry Points

### Problem

three.js exposes the same code through more than one module specifier: the
public builds (`three`, `three/tsl`, `three/webgpu`) and the raw source tree
(`three/src/*`). Importing a runtime **value** from a deep source path pulls
three's node/TSL system in as a _separate module instance_ from the public
build.

Example anti-pattern (the cause of a real "terrain doesn't render" bug):

```ts
// ❌ value import from a deep source path
import { Fn } from "three/src/nodes/TSL.js";
```

TSL node graphs rely on class identity (`instanceof` / `isNode`). A node minted
by the `three/src` copy is not recognized by a `NodeBuilder` from the public
`three/webgpu` build, so the generated **node material silently fails to compile
and the terrain never renders** — while the rest of the scene (built from the
public build) looks fine.

This is amplified across a `link:` / workspace boundary. When a consumer pins a
different three version, its bundler resolves the library's `three/src` import to
the library's _own_ three, producing a second TSL instance that survives even
`resolve.dedupe` and a `three` alias (the alias targets the public specifiers,
not `three/src/*`).

### Required Pattern

- **Runtime/value imports of three must use public entry points only:**
    - `three` — math/util/scene classes (`Vector3`, `BufferGeometry`, …)
    - `three/tsl` — TSL builders and node functions (`Fn`, `float`, `vec3`, …)
    - `three/webgpu` — renderer/material/storage classes (`MeshStandardNodeMaterial`, `StorageTexture`, …)
- **Never import runtime values from `three/src/*` or `three/build/*`.**
- **Type-only imports from `three/src/*` are acceptable** (they are erased at
  build) — but write them explicitly as `import type` / inline `type` so a strict
  setting (`verbatimModuleSyntax`) can never emit them as runtime imports:

```ts
// ✅ value from the public entry, type from source is fine when erased
import { Fn } from "three/tsl";
import type Node from "three/src/nodes/core/Node.js";
```

### Why This Matters

- Guarantees a single three node/TSL instance, so generated node graphs compile
  against the consumer's renderer.
- Prevents "everything renders except the terrain" failures that only surface
  when the package is linked/consumed — isolated package builds and unit tests
  won't catch them.
- Keeps the peer-dependency contract honest: the consumer supplies exactly one
  three, deduped by their bundler.

> Worth enforcing mechanically: an oxlint `no-restricted-imports` rule banning
> value imports from `three/src/*` would fail the build instead of relying on
> review.
