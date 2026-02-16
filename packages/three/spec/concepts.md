# Core Concepts

## Surface

Defines terrain topology and bounds behavior for LOD decisions.

- Flat surface: one root space.
- Multi-space surfaces (future): cube-sphere faces, etc.

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
