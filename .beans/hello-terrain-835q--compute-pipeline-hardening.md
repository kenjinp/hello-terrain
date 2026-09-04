---
# hello-terrain-835q
title: Compute pipeline hardening
status: completed
type: task
priority: low
created_at: 2026-09-04T16:41:15Z
updated_at: 2026-09-04T17:05:00Z
---

packages/three/src/gpu/compute.ts:
- single-kernel path never invokes midPipelineExecute, so if a caller passes preferSingleKernelWhenPossible: true the tile-bounds reduction is skipped and pack bounds stay zero. Either run it between stages or reject the option when midPipelineExecute is set.
- `type CompiledKernel = any`.
- getDeviceComputeLimits() is called every execute(); cache per renderer.
- ElevationParams.tileUV (localCoordinates / (segments+3)) and the stage `uv` arg never reach 1 and include skirts, unlike tileFaceUV ((ix-1)/segments); document or unify.
- quadtree: ensureChildren allocates 4 object literals per split in an otherwise allocation-free path; add an allocNodeRaw(space, level, x, y).

## Checklist

- [x] `compileComputePipeline`: never take the single-kernel path when `midPipelineExecute` is set; document in `CompileComputePipelineOptions` JSDoc (incl. explicit default of `preferSingleKernelWhenPossible`)
- [x] `CompiledKernel` typed as `ComputeNode` instead of `any`
- [x] Cache `getDeviceComputeLimits` per renderer (closure-scoped `WeakMap`)
- [x] Deduplicate `buildSingleKernel` / `buildStagedKernels` via `buildInvocationContext`
- [x] Document UV semantics on `ElevationParams` and `ComputeStageCallback` (no numeric change)
- [x] Docs: parameter reference table in `core/elevation-function.mdx`; corrected `tileUV`, `tileOriginVec2`, `tileLevel`, `nodeIndex` descriptions
- [x] Unit test pinning grid-uv / inner-local / field-uv relationships (`gpu/tile.test.ts`)
- [x] `allocNodeRaw` in `quadtree/nodeStore.ts`; `ensureChildren` uses it; negative-coordinate split test
- [x] Remove unused `leafGpuBufferTask` import in `tasks/tile-bounds.task.ts`
- [x] Rewrite `benchmarks/Quadtree.bench.ts` against the current quadtree API; `pnpm --filter @hello-terrain/three bench` runs
- [x] Changelog entry (Unreleased)

## Resolution

- `compileComputePipeline` computes `canUseSingleKernel = preferSingleKernelWhenPossible && !midPipelineExecute && canRunSingleKernel(...)`, so a mid-pipeline hook always gets its dispatch boundary. Device limits are memoised per renderer in a closure-scoped `WeakMap`; kernels are typed as `ComputeNode`; both kernel builders share `buildInvocationContext(width, uInstanceCount)` + `runStage`.
- UV conventions were documented rather than unified to avoid changing user elevation functions: `tileUV` / stage `uv` = `(ix, iy) / (innerTileSegments + 3)` over the skirted grid (max `(w-1)/w`), `rootUV` / `tileFaceUV` = inner grid `[0, 1]`, `tileLocalToFieldUV` = texel-centred field UV (grid uv + half texel). A test in `gpu/tile.test.ts` pins these offsets.
- `allocNodeRaw(store, space, level, x, y)` is the allocation-free primitive; `allocNode(store, tile)` delegates to it.
- Verified: `pnpm typecheck` (all packages pass; `apps/docs` fails only on Next.js generated types missing in a fresh worktree), oxlint 0 warnings (baseline had 1), vitest three 74/74, work 70/70, react 4/4, bench runs.
