# Core Concepts

## Topology

Defines terrain topology and bounds behavior for LOD decisions.

- Flat topology: one root space.
- Infinite flat topology: one space, camera-centered root grid.
- Cube-sphere topology: six root spaces (cube faces) wrapped onto a sphere.

A topology declares an optional `projection` (`"flat"` by default, or
`"cubeSphere"`) and, for spheres, a `radius`. The projection selects how the GPU
assembles world positions and normals:

- `flat`: tiles lie in the XZ plane; elevation displaces along `+Y`.
- `cubeSphere`: each tile vertex maps from its face-local `(u, v)` onto the cube,
  normalizes to the unit sphere, scales by `radius`, and displaces radially by
  elevation. Normals are derived in world space from the cross product of the
  four cardinal neighbors' displaced world positions, which is continuous across
  cube-face seams (no per-face tangent-frame rotation).

Cross-face topology (`neighborSameLevel`) for the cube-sphere is derived
numerically from a shared face basis (`CUBE_FACES`) so the CPU LOD topology and
the GPU geometry agree, including the rotated edges near the poles. The same
basis is consumed by the GPU helpers in `tsl/cubeSphere`.

## Quadtree

Selects active terrain leaves based on camera-relative criteria and balancing rules.

- Input: camera and refinement params.
- Output: active leaves for compute/render.
- LOD distance is measured relative to the terrain surface, not the datum: the
  previous frame's elevation beneath the camera offsets the camera toward the
  surface during refinement — along `+Y` for flat surfaces and along the radial
  up-direction (from the planet center) for cube spheres.

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

- `flat`: keyed on world `(x, z)`; elevation is a world-`Y` value.
- `cubeSphere`: keyed on a **direction** from the planet center. A world point
  maps to a direction via `normalize(p - center)`, then to a cube face and
  face-local `(u, v)` (`directionToFace` / `directionToFaceUV` in
  `quadtree/topology/cubeSphereInverse`), then to a quadtree tile keyed by face
  (`space`). The same `(face, level, x, y)` spatial index used for rendering is
  reused for lookup. Results report a world `position` on the displaced sphere
  and a world-space normal from the neighbor cross product, mirroring the GPU
  position/normal assembly. Cube-sphere sampling lives on a separate `TerrainSphereQuery`
  (exposed alongside the flat `TerrainQuery`, `null` on flat surfaces) with
  explicit `ByDirection` / `ByPosition` / `ByLatLong` variants rather than
  overloading the flat query. Raycasts intersect the planet's bounding shell and
  march in radial signed distance.

## Task Graph

Coordinates pipeline stages through explicit dependencies.

- Handles invalidation, recompute, and execution order.
- Receives runtime resources (renderer and optional external objects).

## React Integration

React owns scene objects. Graph owns data production.

- Mesh/material lifecycle in React.
- Graph outputs are applied from app code or sink tasks.
