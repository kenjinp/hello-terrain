# Naming Conventions

## Core Rule

Prefer names that reflect **what data is** and **how it is stored**.

## Map vs Field vs Buffer

- `*Map`
  - Authored/sampled texture-like data source.
  - Example: normal map texture.
- `*Field`
  - Computed spatial dataset (scalar/vector) in terrain domain.
  - Example: `elevationField`.
- `*Buffer` / `*Storage`
  - Concrete GPU container that stores a field.
  - Example: `elevationFieldBuffer`, `elevationFieldStorage`.

## Elevation Terminology

- Use `elevation*` for user-facing terrain height control.
- Avoid mixing `heightmap*` and `elevation*` in API surface.
- Preferred examples:
  - `elevationScale`
  - `uElevationScale`
  - `ElevationFieldContext`
  - `createElevationFieldContextTask`
  - `elevationFieldStageTask`

## Topology Terminology

- Use `Topology` (not `Surface`) for the pluggable adapter that defines tile
  topology: root tiles, same-level neighbors (including cross-face edges),
  conservative bounds, and the injected `projection`. This avoids confusion with
  the geometric "terrain surface" and with texturing.
- Use `SurfaceProjection` (with a `kind` of `flat` | `cubeSphere` | `torus` | …)
  for the injected strategy that assembles GPU positions/normals and powers the
  CPU query/raycast/visibility/LOD. The pipeline must never branch on a
  projection kind — call into the projection's `gpu` / `cpu` hooks instead.
  `ProjectionKind` is the identifier type and is for debugging, telemetry, and
  cache identity only.
- Preferred examples:
  - `Topology` (the adapter type), `SurfaceProjection`, `ProjectionKind`
  - `createFlatTopology`, `createInfiniteFlatTopology`, `createCubeSphereTopology`,
    `createTorusTopology`
  - `createFlatProjection`, `createCubeSphereProjection`, `createTorusProjection`
  - `FlatTopologyConfig`, `InfiniteFlatTopologyConfig`, `CubeSphereTopologyConfig`,
    `TorusTopologyConfig`
  - the `topology` param and `topologyTask`
- Use `TerrainSurfaceQuery` for the generic closed-surface query (position-keyed)
  and `TerrainSphereQuery` (which extends it) for the cube-sphere direction/lat-long
  keys.
- Reserve `surface` wording for the actual displaced terrain surface, e.g.
  geometric query results (`TerrainSurfaceSample`) and "surface normal".

## Task Naming

- Task symbols should end with `Task`.
- `displayName()` should match symbol name exactly.
- Recommended pattern:
  - `{domain}{action}Task`
  - Examples: `quadtreeUpdateTask`, `elevationFieldStageTask`, `positionNodeTask`.

## Type Naming

- Use `Context` for grouped runtime references.
- Use `Params` for user-configurable input objects.
- Use precise suffixes:
  - `Ref` for references
  - `State` for mutable runtime state
  - `Config` for mostly static setup

## File Naming

- Keep file names aligned with primary export name.
- For multi-concept files, prefer domain grouping by folder and specific file names.
