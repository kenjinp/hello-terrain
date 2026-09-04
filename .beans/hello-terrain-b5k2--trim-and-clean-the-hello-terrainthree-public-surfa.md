---
# hello-terrain-b5k2
title: Trim and clean the @hello-terrain/three public surface
status: completed
type: task
priority: normal
created_at: 2026-09-04T16:41:14Z
updated_at: 2026-09-04T18:35:00Z
---

index.ts does `export * from ./quadtree` and `./tasks`, leaking generic internals: update, createState, beginUpdate, Dir, U32_EMPTY, allocLeafSet, buildSeams2to1 (only used in tests), NodeFlags/isLive (unused), plus every task symbol. Naming issues: terrainTasks.createTileNodes -> tileNodesTask; createTerrainFieldTextureTask returns TerrainFieldStorage; elevationFn lacks .displayName; heightmap* exports violate naming-conventions.md (use elevation*); createComputePipelineTasks always names tasks compileComputeTask/executeComputeTask so user pipelines collide in inspect(); stale doc comment on terrainFieldStageTask (packHalf2x16/normal field).

## Checklist
- [x] Replace `export *` with explicit named exports; prefix or drop internals
- [x] Rename tileNodesTask/createTerrainFieldTextureTask (or the terrainTasks keys) for consistency
- [x] Rename tsl/heightmap.ts API to elevation* (sampleElevationTextureMeters etc.) with deprecation aliases
- [x] Accept a name/prefix in createComputePipelineTasks
- [x] Add `sideEffects: false`; reconsider shipping a CJS build since three/webgpu is ESM-only (CJS build kept as-is for now)
- [x] Update apps/docs for any renamed symbols

## Resolution

Branch `refactor/b5k2-public-surface`.

**Removed from the `@hello-terrain/three` public surface** (quadtree/task internals that leaked via `export *`):
- `update`, `createState`, `beginUpdate`
- `allocLeafSet`, `resetLeafSet`, `allocSeamTable`, `resetSeamTable`, `buildSeams2to1`, type `SeamTable`
- `buildLeafIndex`, `createSpatialIndex`
- `U32_EMPTY`
- `runTileBoundsReduction`

**Deleted dead code:** `NodeFlags`, `isLive`, `NodeStore.flags`, `NodeStore.roots` in `quadtree/nodeStore.ts` (`createNodeStore` no longer takes `spaceCount`).

**Kept exported on purpose:** `Dir` (part of the public `Topology.neighborSameLevel` contract, shown in `core/topology.mdx`), all `*Task` refs (docs peek `leafGpuBufferTask`, `leafStorageTask`, `quadtreeConfigTask`, `instanceIdTask`, `createTerrainFieldStorageTask`), all topology factories and cube-sphere / torus math helpers, all `Context` / `State` / `Params` types, `createTerrainUniforms`.

**Renames (old names kept as `@deprecated` aliases for one release):**
- `sampleHeightmapMeters` → `sampleElevationTextureMeters`
- type `HeightmapTexture` → `ElevationTexture` (module `tsl/heightmap.ts` → `tsl/elevationTexture.ts`)
- `createTerrainFieldTextureTask` → `createTerrainFieldStorageTask`
- `terrainTasks.createTerrainFieldTexture` → `terrainTasks.createTerrainFieldStorage` (key renamed outright)
- `terrainTasks.createTileNodes` → `terrainTasks.tileNodes` (key renamed outright)

**Other:** `createComputePipelineTasks(leaf, { name })` derives `${name}CompileTask` / `${name}ExecuteTask`; `elevationFn` has `.displayName("elevationFn")`; `terrainFieldStageTask` doc comment rewritten for the RGBA `[normalizedHeight, Nx, Ny, Nz]` pack; `"sideEffects": false` on three/react/work; unused `leafGpuBufferTask` import removed from `tile-bounds.task.ts`. Docs: changelog entry, new "Elevation textures" and "Custom compute stages" sections in `core/elevation-function.mdx`, spec updates (`naming-conventions.md`, `architecture.md`, `terrain-data-model.md`).
