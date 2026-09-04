---
# hello-terrain-vz0t
title: Remove module-scope shared state (seams scratch, uniforms Vector3, default material, varyings)
status: completed
type: task
priority: normal
created_at: 2026-09-04T16:41:14Z
updated_at: 2026-09-04T17:10:00Z
---

Violations of the 'no module-scope variables' rule:
- packages/three/src/quadtree/seams.ts:5-9 module scratch tiles (not re-entrant)
- packages/three/src/tasks/uniforms/uniforms.task.ts:8 shared scratchVector3
- packages/three/src/mesh/TerrainMesh.ts:23-28 defaultTerrainMeshParams allocates one MeshStandardNodeMaterial at import time, shared by every TerrainMesh that omits `material`
- packages/three/src/tsl/varyings.ts module-level varyingProperty nodes

## Checklist
- [x] Move seams scratch into a createSeamsScratch()/state object (or delete seams.ts if buildSeams2to1 stays unused outside tests)
- [x] Allocate scratch inside createUniformsTask work() and store on the context
- [x] Lazily create the default material per mesh in the constructor
- [x] Decide whether varyings must be shared across materials; if not, create per graph

## Resolution

Branch: `refactor/vz0t-no-module-scope-state`.

- **seams.ts** — `SeamTable` gained a `scratch: SeamTableScratch` (four `TileId`s) allocated by
  `allocSeamTable`; `buildSeams2to1` destructures `outSeams.scratch` instead of module-level tiles.
  `buildSeams2to1` stays exported (public API, used by `update.test.ts`). `quadtree/README.md`
  updated with the correct signature and the scratch ownership note.
- **uniforms.task.ts** — dropped `scratchVector3` and the `three` import. `uRootOrigin.value` is
  already a per-graph `Vector3` created in `createTerrainUniforms`, so `updateUniformsTask` now
  writes into it with `.value.set(x, y, z)`. This also fixes a latent aliasing bug: every graph's
  `uRootOrigin.value` used to point at the one shared `Vector3`.
- **TerrainMesh.ts** — `defaultTerrainMeshParams` no longer holds a material (typed
  `Omit<TerrainMeshParams, "material">`); the constructor does `material ?? new MeshStandardNodeMaterial()`.
  `TerrainMeshParams.material` is now optional and documented. The deferred `setTimeout` geometry
  dispose was kept (extracted to `disposeGeometryAfterFrame`) with a comment: the setters are driven
  from `useFrame` and could be called from `onBeforeRender`, where a synchronous dispose could free
  buffers still referenced during the current frame.
- **varyings.ts** — kept at module scope, documented. Conclusion: sharing is safe. In three r182,
  `varyingProperty(type, name)` returns a `PropertyNode` with `global = true` and no `.value`; all
  per-compile artifacts (the `NodeVarying`, generated names, usage counts) are stored on the
  `NodeBuilder` via `builder.getDataFromNode(node)` / `builder.getVaryingFromNode(node)`, i.e. per
  material build, never on the node. three itself declares `diffuseColor`, `roughness`, `metalness`,
  etc. as module-level `PropertyNode`s. Additionally `vElevation` / `vGlobalVertexIndex` are not
  referenced anywhere inside `packages/three/src`; they are declarations exported for consumers.
- **torus.ts** — `ZERO_CENTER` is `Object.freeze`d and typed `Readonly<Vec3Like>`; verified
  `torusUVToPoint` only reads `center`.
- **tests/no-module-scope-state.test.ts** — scans `packages/three/src/**/*.ts` (non-test) for
  top-level `let`/`var` and `const x = new (Vector*|Matrix*|TypedArray|Map|Set|WeakMap)(`, with an
  (empty) allowlist and a stale-allowlist check.
- **apps/docs** changelog updated under the alpha.14 "Under the hood" section.
