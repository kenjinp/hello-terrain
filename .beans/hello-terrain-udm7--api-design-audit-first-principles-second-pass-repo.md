---
# hello-terrain-udm7
title: 'API design audit (first-principles, second pass): report and proposed target API'
status: completed
type: task
priority: normal
created_at: 2026-09-06T17:17:44Z
updated_at: 2026-09-06T17:21:48Z
---

Fresh first-principles audit of the @hello-terrain/three, @hello-terrain/react and @hello-terrain/work public API (2026-09-06). Builds on hello-terrain-rsua. Full report below so it survives the chat session.

## Checklist
- [x] Read specs, public entrypoints, params, query, react wrapper, docs examples
- [x] Write audit report (findings + proposed target API)
- [x] Record report in bean body

## Verdict

The engine underneath is well layered (quadtree -> projection -> gpu -> tasks -> mesh) but the *consumer-facing* API is the task graph itself. There is no product-level entrypoint, so every consumer (README vanilla example, every docs scene, the React package) re-implements the same ~40 lines of graph plumbing. Most other problems (shared params, duplicated shape config, nullable query trio, leaked internals) are downstream of that missing layer.

## Findings (ranked)

### 1. No high-level imperative entrypoint
`terrainGraph()` returns a bare work `Graph`. To render, a user must import param tokens + task refs, write a `task()` sink to copy `positionNode` into a material and `leafSet.count` into `mesh.count`, mutate `quadtreeUpdate` every frame, and `await graph.run({ resources: { renderer } })`. `@hello-terrain/react` (useTerrainRunner, runtimeTasks, syncTerrainMesh) is a 300-line reimplementation of this loop. Proposal: `createTerrain(options)` handle (see target API).

### 2. Params are module-scope singletons with two different semantics
- `graph.set` seeds the graph-owned copy with `paramRef.get()` (the *reference*). Object params (`quadtreeUpdate`, `origin`, `topology`) are therefore shared across graphs; the recommended `prev => { prev.cameraOrigin.x = ...; return prev }` mutates the global (bean qacq). `quadtreeUpdateTask` also writes `tileElevationRange` onto the param object.
- A task `get(param)` without a prior `graph.set` subscribes to the global value, so `innerTileSegments.set(80)` changes every graph, but after any `graph.set` it is isolated. Same token, two behaviours.
- `TerrainMesh` defaults read `innerTileSegmentsParam.get()` (global), not the graph's value; docs tell users to do the same.
Proposal: instance-scoped options; params created per terrain; `set` is replace-only with copied vector values.

### 3. Duplicated sources of truth for shape
- `rootSize`/`origin`/`radius` are params *and* topology-config fields. Earth example passes `radius` twice (topology + `radius` option). `terrainQueryTask` does `projection.radius ?? radiusValue`; `updateUniformsTask` always uses the param. Torus has no radius param, so `uRadius` silently stays 1000.
- `innerTileSegments`/`maxNodes` live in params, in `TerrainMesh`, and twice in React props (`TerrainPropsWithHandle` re-accepts them); React polls uniforms each frame to keep the mesh in sync.
Proposal: topology owns all geometry (size/origin/radius/center); the mesh derives resolution/capacity from the terrain handle.

### 4. Public surface is undifferentiated
`export *` from quadtree/tasks/projection/tsl/gpu leaks `Dir`, `U32_EMPTY`, `allocLeafSet`, `beginUpdate`, `buildSeams2to1`, `createState`, `update`, `CUBE_FACES`, `wrap01`, 24 task refs, `TILE_BOUNDS_*` offsets, module-scope varyings (`vElevation`, `vGlobalVertexIndex`) and `TASK_DEF`. `heightmap*` violates naming-conventions.md; `elevationFn` has no displayName; `terrainTasks.createTileNodes` -> `tileNodesTask`; `createTerrainFieldTextureTask` returns a `TerrainFieldStorage`. No `sideEffects: false`; ships CJS although three/webgpu is ESM-only. Public-API test only checks `TerrainGeometry`. Proposal: explicit exports + subpaths (`.`, `/tsl`, `/graph`, `/quadtree`) + an export-snapshot test. (Overlaps bean b5k2.)

### 5. Elevation callback contract is flat-centric and unit-ambiguous
- `ElevationParams` = `worldPosition, rootSize, rootUV, tileUV, tileLevel, tileSize, tileOriginVec2, nodeIndex`. On a cube-sphere `worldPosition` is ~6.37e6 m in float32 (ULP ~0.5 m); the Earth example caps `maxLevel` at 14 because of it. The natural curved-surface inputs (unit direction / datum normal, `(space,u,v)`, tile-local offset) are not provided.
- Return value is "raw" then multiplied by `elevationScale` in the position stage. CPU `getElevation` returns `originY + raw*scale`; GPU `sampler.sampleElevation` returns raw (docs example does `.mul(elevationScale)` by hand); `sampleHeightmapMeters` returns metres that then get scaled again.
- `sampler.evaluateElevation` fabricates flat `rootUV/tileUV`, `tileLevel: 0`, so it is wrong on curved surfaces.
Proposal: `ElevationInput { position (tileOrigin + local, high precision), normal (datum), surface: {space,u,v}, tile: {level,size} }`; output = metres of displacement along the datum normal everywhere; every read path (CPU query, GPU sampler, tile bounds) returns the same unit.

### 6. Three parallel nullable query interfaces
`TerrainQuery` (x,z) / `TerrainSurfaceQuery` (Vector3) / `TerrainSphereQuery` (direction, lat/long): 3 nullable fields on `TerrainQueryContext` and `TerrainRuntime`, ~25 methods, consumer must branch on which is non-null. A controller written against `query` (flat) does not run on a planet; flat has no position-keyed API at all. Proposal: one position-keyed `TerrainQuery` for every topology (`sample(position, out?)`, `sampleBatch`, `tileAt`, `elevationRange`, `generation`), key converters (`latLongToPosition`, `directionToPosition`) as sphere-topology helpers, allocation-free `out` params. Keep `TerrainRaycast.pick(ray)` and the `TerrainMesh.raycast` override.

### 7. Compute-stage extension model
`ComputeStageCallback` is a 5-positional-arg function; pipelines are arrays accumulated by "get upstream, spread, append". `createComputePipelineTasks(leaf)` creates a *second* compile/execute pair while the default `executeComputeTask` remains registered, so both pipelines run unless the user knows to restrict `targets`. Terrain-field pack must stay last by convention (bean yt2u); compile tasks all share the displayName `compileComputeTask`. Proposal: `stages: TerrainStage[]` option, `{ name, phase: "beforeElevation" | "afterElevation" | "afterField", run(ctx) }`, one pipeline owned by the terrain.

### 8. Lifecycle
`graph.dispose()` only unsubscribes params. Terrain-field textures, storage buffers and readback staging (`cache.dispose()` exists but is never called) leak. `TerrainMesh` setters dispose old geometry via `setTimeout`. `defaultTerrainMeshParams.material` is a module-scope `MeshStandardNodeMaterial` shared by every mesh (bean vz0t). Proposal: `terrain.dispose()` tears down graph + GPU resources + geometry.

### 9. Per-frame update contract
Camera update = mutate `quadtreeUpdate` + `await graph.run({ targets, resources })`. LOD criteria are bundled into the same per-frame param (Earth example merges `{...prev, ...lod}` in an effect). `mode: "screen"` needs the user to compute `projectionFactor` from fov/viewport by hand. Hysteresis/reentrancy is left to the caller (React runner has abort controllers + generation counters for this). Proposal: `terrain.update(camera)` with built-in hysteresis and single-flight; `lod: { mode: "screen", targetPixels }` derives the projection factor from the camera.

### 10. React
- `useTerrain` memoises the graph on `options.tasks` identity: an inline `tasks={[...]}` (or un-memoised `topology`) recreates the graph and all GPU resources every render.
- Render-prop `children` is mandatory even for the trivial case; the material is remounted via `key` when `positionNode` identity changes.
- `TerrainRuntime` is a mutable object written by a task, so React cannot react to changes (only `ready`); `terrain.tasks` is just the global `terrainTasks`.
Proposal: `<Terrain {...options}><meshStandardNodeMaterial/></Terrain>` with position node injected; `useTerrainQuery()`; dev-mode warning on unstable identities; `tasks` -> `stages`.

### 11. Naming
`innerTileSegments` (+3 rule) -> `tileResolution`; `maxNodes` -> `tileBudget`; `skirtScale` is a length -> `skirtDepth`; `origin`/`rootOrigin`/`uRootOrigin` vs `center`; `quadtreeUpdate` (param) vs `quadtreeUpdateTask`; `Terrain` / `TerrainMesh` / `terrainGraph` three nouns for one thing; `terrainFieldFilter` -> `fieldFilter`.

### 12. @hello-terrain/work leakage
Work types (`Task<unknown, string, { renderer }>`, `TaskRef`, `Graph<L, Res>`) appear in React public types. Fine as an escape hatch (`terrain.graph`), not as the default path. Shared-by-default `param()` plus `graph.set` ownership is the root of finding 2; consider graph-owned params as the only mode.

## Proposed target API

```ts
import { createTerrain, cubeSphere } from "@hello-terrain/three";

const terrain = createTerrain({
  renderer,
  topology: cubeSphere({ radius: 6_371_000 }),          // flat({ size }), infiniteFlat({ tileSize }), torus({...})
  elevation: ({ position, normal, surface, tile }) => fbm(normal.mul(4)).mul(10_000), // metres
  lod: { mode: "screen", targetPixels: 16 },             // or { mode: "distance", factor: 1.5 }
  tiles: { budget: 1024, resolution: 64, maxLevel: 14 },
  skirtDepth: 2000,
  stages: [erosionStage],
});

scene.add(terrain.mesh);
terrain.mesh.material = new MeshStandardNodeMaterial({ positionNode: terrain.nodes.position });

renderer.setAnimationLoop(() => {
  terrain.update(camera);       // hysteresis + single-flight run + mesh sync
  renderer.render(scene, camera);
});

terrain.query.sample(point, out);   // identical on every topology
terrain.raycast.pick(ray);
terrain.sampler.sampleTerrain(worldPos);   // TSL
terrain.set({ elevation: next });          // partial reconfigure
terrain.dispose();
terrain.graph;                              // escape hatch
```

```tsx
<Terrain topology={topology} elevation={elevation} lod={{ mode: "screen", targetPixels: 16 }}>
  <meshStandardNodeMaterial colorNode={colorNode} />
</Terrain>
const { query, raycast, ready } = useTerrainContext();
```

Subpaths: `@hello-terrain/three` (createTerrain, topologies, types), `/tsl` (voronoi, skirt, materials, elevation helpers), `/graph` (tasks + params for power users), `/quadtree` (pure CPU, no three dependency).

## Suggested sequencing
1. Bugs first: per-instance params / copy on `set`, `dispose()` releasing GPU resources, shared default material.
2. Add `createTerrain` as a layer over the existing graph (non-breaking); port README + docs scenes + React onto it.
3. Unify the query API; make elevation units consistent across CPU/GPU paths.
4. Explicit exports + subpaths + export snapshot test.
5. New `ElevationInput` + `stages` (breaking, acceptable in alpha).
