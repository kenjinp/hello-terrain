# Terrain Architecture

## Layered Design

The terrain library is organized in layers from pure logic to runtime integration.

1. `quadtree/`  
   CPU-side LOD topology and leaf selection. No renderer ownership.

2. `tsl/`  
   Shader utility functions and callback types (pure TSL abstractions).

3. `gpu/`  
   GPU resource and compute helpers:
   - compute pipeline compilation
   - storage/buffer helpers
   - tile/elevation field math
   - world-position assembly

4. `query/`  
   CPU snapshot sampling: the terrain cache, flat/surface/sphere query objects,
   raycasting, and the GPU sampler.

5. `projection/`  
   Surface-projection strategies (`SurfaceProjection`) that are *injected* into a
   topology. Each projection wires the shape-specific `gpu` builders (from `gpu/`
   + `tsl/`) and `cpu` query/raycast/LOD hooks (from `query/`) so the pipeline
   never branches on a projection kind. Built-ins: `flat`, `cubeSphere`, `torus`.

6. `tasks/`  
   Reactive task-graph orchestration: params, stages, dependencies, and execution lanes.

7. `mesh/` and `geometry/`  
   Three.js scene primitives (`TerrainMesh`, `TerrainGeometry`).

## Ownership Boundaries

- React (or app layer) owns scene object lifecycle:
  - create/dispose `TerrainMesh`, materials, refs
  - mount/unmount behavior
- Task graph owns terrain dataflow:
  - quadtree updates
  - compute stages
  - generated nodes and GPU state
- Optional sink task pattern:
  - graph task may *apply* graph outputs to externally owned mesh/material
  - graph still does not own lifecycle/disposal of scene objects

## Data Flow (Per Frame)

1. App updates params (camera origin, scales, etc.).
2. Graph runs quadtree selection and uploads leaf storage.
3. Graph runs compute stages to produce elevation field and derived buffers.
4. Graph exposes render nodes (position/normal related).
5. App (or sink task) applies results to mesh/material for rendering.

## Public API Shape

- High-level defaults should be easy:
  - `terrainGraph()`
  - `TerrainMesh`
  - core params
- Advanced APIs should be explicit:
  - individual task refs
  - custom compute stages
  - low-level helpers in `gpu/` and `tsl/`

## Compute and fragment contracts

- A `ComputePipeline` remains an ordered array of callable stages. The optional `needsTileBounds` property identifies a consumer, not a separate dispatch stage.
- `createComputePipelineTasks` reduces bounds once before the first marked callback (or after the whole pipeline if none is marked). The reduction requires separate GPU submissions; small tiles cannot fuse across this host hook.
- Custom elevation/erosion stages belong before terrain-field pack. Later field stages may read geometry without moving the reduction or running elevation again.
- `tileIndex()` produces a signed integer leaf/storage index from `instanceIndex`, passed to fragments with flat interpolation only when consumed. It is not a persistent quadtree ID, nor does flat interpolation make a branch derivative-uniform.
- The unassigned `vGlobalVertexIndex` and `vElevation` exports are removed. There is no elevation varying without a consumer contract.

