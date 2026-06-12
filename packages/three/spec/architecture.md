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

4. `tasks/`  
   Reactive task-graph orchestration: params, stages, dependencies, and execution lanes.

5. `mesh/` and `geometry/`  
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
2. Graph runs quadtree selection (with 2:1 balance) and uploads leaf storage,
   including the per-leaf coarse-neighbor edge mask packed into slot 3 for seam
   stitching.
3. Graph runs compute stages to produce elevation field and derived buffers.
4. Graph exposes render nodes (position/normal related); the vertex shader
   stitches odd boundary vertices on coarse-facing edges.
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
