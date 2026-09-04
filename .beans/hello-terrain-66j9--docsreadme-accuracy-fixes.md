---
# hello-terrain-66j9
title: Docs/README accuracy fixes
status: completed
type: task
priority: normal
created_at: 2026-09-04T16:41:15Z
updated_at: 2026-09-04T17:30:00Z
---

- Root README.md and packages/three/README.md list 'terrain holes, texture painting, overlays, colors, and wetness' — none exist in packages/three/src. Remove or move to a roadmap section.
- apps/docs/content/docs/docs/core/params.mdx: table rows for `topology` and `terrainFieldFilter` have broken columns (unescaped `|` in the type).
- core/elevation-function.mdx refers to `Param<...>`; exported type is `ParamRef`.
- packages/work/README.md 'Semantics' bullet contains literal \\n.
- quadtreeUpdate default distanceFactor is 1.5 in params but criteria.ts falls back to 2 — document/align.
- Undocumented consumer APIs: createTerrainQuery/createTerrainSurfaceQuery/createTerrainRaycast, createComputePipelineTasks (custom compute stages), getDeviceComputeLimits, field storage backends, vElevation/vGlobalVertexIndex varyings.
- React: re-export TerrainSurfaceQuery type (runtime.surfaceQuery uses it).

## Checklist

- [x] Rewrite the "Features" lists in `README.md` and `packages/three/README.md` to match `packages/three/src`; move holes / painting / wetness to a "Roadmap (not yet implemented)" list.
- [x] Fix the `topology` and `terrainFieldFilter` rows in `core/params.mdx` (escape `\|`), re-check every row has 4 cells, verify defaults against `tasks/params.ts`.
- [x] Replace `Param<...>` with `ParamRef<...>` in `core/elevation-function.mdx` (only file in `apps/docs/content` that used it).
- [x] Reformat the `cache: "none"` bullet in `packages/work/README.md` as real nested bullets.
- [x] Add `DEFAULT_DISTANCE_FACTOR = 1.5` in `quadtree/criteria.ts`, use it for the `shouldSplit` fallback and the `quadtreeUpdate` param default; document the value in `core/params.mdx` and `core/topology.mdx`.
- [x] Document `createComputePipelineTasks` + custom compute stages in `core/elevation-function.mdx`.
- [x] Document `createTerrainQuery` / `createTerrainSurfaceQuery` (terrain-query.mdx) and `createTerrainRaycast` (raycasting.mdx) as low-level factories.
- [x] Add `advanced/gpu-resources.mdx` (`getDeviceComputeLimits`, `createTerrainFieldStorage` + backends + TSL field helpers) and register it in `advanced/meta.json`.
- [x] Document the `vElevation` / `vGlobalVertexIndex` varyings in `core/nodes/materials.mdx` (noting the library does not write them).
- [x] Re-export `TerrainSurfaceQuery` from `@hello-terrain/react`; document `runtime.surfaceQuery` / `runtime.sphereQuery` in `react/context-and-runtime.mdx` and `react/use-terrain.mdx`.
- [x] Glossary: add `Topology`, `Surface Projection`, and `Elevation Field` entries per `spec/naming-conventions.md` (no stray "Surface"-as-topology usage was found).
- [x] Verify: `pnpm typecheck`, `pnpm lint`, `vitest run` for `@hello-terrain/three`, docs `next build`.

## Resolution

Docs and READMEs now describe only APIs that exist in `packages/three/src/index.ts`, `packages/react/src/index.tsx`, and `packages/work/src/index.ts`. The one behavioral code change is the `distanceFactor` fallback in `quadtree/criteria.ts` (`2` → `DEFAULT_DISTANCE_FACTOR = 1.5`), which now matches the `quadtreeUpdate` param default. `TerrainSurfaceQuery` is re-exported from `@hello-terrain/react`. `vElevation` / `vGlobalVertexIndex` are exported varying handles that the terrain `positionNode` does not currently assign; the docs say so explicitly rather than implying automatic population.
