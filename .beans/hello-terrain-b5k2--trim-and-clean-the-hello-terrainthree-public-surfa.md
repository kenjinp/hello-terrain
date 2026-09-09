---
# hello-terrain-b5k2
title: Trim and clean the @hello-terrain/three public surface
status: in-progress
type: task
priority: normal
created_at: 2026-09-04T16:41:14Z
updated_at: 2026-09-04T16:47:15Z
---

index.ts does `export * from ./quadtree` and `./tasks`, leaking generic internals: update, createState, beginUpdate, Dir, U32_EMPTY, allocLeafSet, buildSeams2to1 (only used in tests), NodeFlags/isLive (unused), plus every task symbol. Naming issues: terrainTasks.createTileNodes -> tileNodesTask; createTerrainFieldTextureTask returns TerrainFieldStorage; elevationFn lacks .displayName; heightmap* exports violate naming-conventions.md (use elevation*); createComputePipelineTasks always names tasks compileComputeTask/executeComputeTask so user pipelines collide in inspect(); stale doc comment on terrainFieldStageTask (packHalf2x16/normal field).

## Checklist
- [ ] Replace `export *` with explicit named exports; prefix or drop internals
- [ ] Rename tileNodesTask/createTerrainFieldTextureTask (or the terrainTasks keys) for consistency
- [ ] Rename tsl/heightmap.ts API to elevation* (sampleElevationTextureMeters etc.) with deprecation aliases
- [ ] Accept a name/prefix in createComputePipelineTasks
- [ ] Add `sideEffects: false`; reconsider shipping a CJS build since three/webgpu is ESM-only
- [ ] Update apps/docs for any renamed symbols