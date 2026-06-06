# Core Concepts

## Surface

Defines terrain topology and bounds behavior for LOD decisions.

- Flat surface: one root space.
- Infinite flat surface: one space, camera-centered root grid.
- Cube-sphere surface: six root spaces (cube faces) wrapped onto a sphere.

A surface declares an optional `projection` (`"flat"` by default, or
`"cubeSphere"`) and, for spheres, a `radius`. The projection selects how the GPU
assembles world positions and normals:

- `flat`: tiles lie in the XZ plane; elevation displaces along `+Y`.
- `cubeSphere`: each tile vertex maps from its face-local `(u, v)` onto the cube,
  normalizes to the unit sphere, scales by `radius`, and displaces radially by
  elevation. Normals are rebuilt in the per-vertex sphere tangent frame.

Cross-face topology (`neighborSameLevel`) for the cube-sphere is derived
numerically from a shared face basis (`CUBE_FACES`) so the CPU LOD topology and
the GPU geometry agree, including the rotated edges near the poles. The same
basis is consumed by the GPU helpers in `tsl/cubeSphere`.

## Quadtree

Selects active terrain leaves based on camera-relative criteria and balancing rules.

- Input: camera and refinement params.
- Output: active leaves for compute/render.

## Elevation Function

User-provided callback that defines terrain height behavior per sample.

- Lives in TSL callback API.
- Produces values that populate the elevation field.

## Elevation Field

Computed terrain elevation dataset derived from the elevation function.

- Used to build world positions.
- Used as input for derived data (for example normals).

## Normal Derivation

Normals are generated from neighbor sampling over the elevation field and then packed/unpacked for GPU usage.

## Task Graph

Coordinates pipeline stages through explicit dependencies.

- Handles invalidation, recompute, and execution order.
- Receives runtime resources (renderer and optional external objects).

## React Integration

React owns scene objects. Graph owns data production.

- Mesh/material lifecycle in React.
- Graph outputs are applied from app code or sink tasks.
