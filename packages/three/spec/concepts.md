# Core Concepts

## Topology

Defines terrain topology and bounds behavior for LOD decisions.

- Flat topology: one root space.
- Infinite flat topology: one space, camera-centered root grid.
- Cube-sphere topology: six root spaces (cube faces) wrapped onto a sphere.
- Torus topology: one root space, periodic (wrapping) in both axes.

A topology carries an injected `SurfaceProjection` (see below) and, for curved
surfaces, a `radius`/`center`. The projection — not a branch on a projection
kind — selects how the GPU assembles world positions and normals.

Cross-face topology (`neighborSameLevel`) for the cube-sphere is derived
numerically from a shared face basis (`CUBE_FACES`) so the CPU LOD topology and
the GPU geometry agree, including the rotated edges near the poles. The same
basis is consumed by the GPU helpers in `tsl/cubeSphere`. The torus topology
wraps tile coordinates modulo the level resolution on both axes.

## Surface Projection

The injected strategy a topology carries (`SurfaceProjection`, in
`projection/`). It encapsulates everything shape-specific so the GPU pipeline,
the CPU terrain cache, the query objects, the raycaster, and the LOD camera
offset never branch on a projection kind — they call into the projection's
`gpu` and `cpu` hooks. `kind` (`flat` | `cubeSphere` | `torus` | …) is an
identifier for debugging only.

- `flat` (`createFlatProjection`): tiles lie in the XZ plane; elevation
  displaces along `+Y`. No closed-surface query.
- `cubeSphere` (`createCubeSphereProjection`): each tile vertex maps from its
  face-local `(u, v)` onto the cube, normalizes to the unit sphere, scales by
  `radius`, and displaces radially by elevation.
- `torus` (`createTorusProjection`): `(u, v)` map around the major circle and the
  tube cross-section; elevation displaces along the outward tube normal.

For all curved projections, normals are derived in world space from the cross
product of the four cardinal neighbors' displaced world positions — continuous
across seams (no per-tile tangent-frame rotation). Adding a new surface shape is
done by implementing one `SurfaceProjection` plus a small `Topology`; the torus
is the reference example.

## Quadtree

Selects active terrain leaves based on camera-relative criteria and balancing rules.

- Input: camera and refinement params.
- Output: active leaves for compute/render.
- LOD distance is measured relative to the terrain surface, not the datum: the
  previous frame's elevation beneath the camera offsets the camera toward the
  surface during refinement. The projection owns this offset
  (`cpu.cameraSurfaceOffset`) — `+Y` for flat surfaces, the radial up-direction
  for cube spheres, and the outward tube normal for the torus.

## Elevation Function

User-provided callback that defines terrain height behavior per sample.

- Lives in TSL callback API.
- Produces values that populate the elevation field.

## Elevation Field

Computed terrain elevation dataset derived from the elevation function.

- Used to build world positions.
- Used as input for derived data (for example normals).

## Normal Derivation

Normals are generated from neighbor sampling over the elevation field. For flat
surfaces the central-difference gradient is taken directly. For the cube-sphere,
the four cardinal neighbors are lifted to their displaced world positions
(`direction * (radius + elevation)`) and the surface normal is the cross product
of the spanning tangents — metric-correct, curvature-aware, and frame-independent,
so it remains continuous across cube-face seams. The resulting **unit world-space
normal** is stored directly in the terrain field (`[height, Nx, Ny, Nz]`) and read
back as-is by both the render path and the CPU query mirror.

## Terrain Query

Synchronous CPU sampling backed by an async readback of the elevation field.

- `flat`: keyed on world `(x, z)`; elevation is a world-`Y` value, exposed via
  the flat `TerrainQuery`.
- Closed surfaces: the projection injects `CpuSurfaceOps` into the terrain cache
  (`positionToKey`, `surfacePosition`, `surfaceNormal`). A world point is mapped
  to a surface key `(space, u, v)`, then to a quadtree tile via the shared
  `(space, level, x, y)` spatial index used for rendering. Results report a world
  `position` on the displaced surface and a world-space normal from the neighbor
  cross product, mirroring the GPU assembly. Every closed surface exposes a
  generic position-keyed `TerrainSurfaceQuery` (`null` on flat). The cube-sphere
  additionally exposes a `TerrainSphereQuery` (which **extends**
  `TerrainSurfaceQuery`) with `ByDirection` / `ByLatLong` keys. Raycasts
  (`cpu.raycast`) intersect the surface's bounding shell and march in signed
  distance (radial for the sphere, tube-relative for the torus).

## Task Graph

Coordinates pipeline stages through explicit dependencies.

- Handles invalidation, recompute, and execution order.
- Receives runtime resources (renderer and optional external objects).

## React Integration

React owns scene objects. Graph owns data production.

- Mesh/material lifecycle in React.
- Graph outputs are applied from app code or sink tasks.
