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
