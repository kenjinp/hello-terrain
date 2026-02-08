---
name: Split compute dispatches
overview: Modify `compileComputePipeline` to automatically split stages into separate GPU dispatches when the tile grid exceeds the workgroup size (innerSegments > 13), fixing the cross-workgroup race condition while preserving the fused single-dispatch path for smaller tiles.
todos:
  - id: refactor-fused
    content: Extract the current fused kernel logic in `compileComputePipeline` into a `compileFusedPipeline` helper function (pure refactor, no behavior change)
    status: pending
  - id: add-split
    content: Add `compileSplitPipeline` that compiles each stage as a separate kernel and dispatches them sequentially
    status: pending
  - id: add-router
    content: Make `compileComputePipeline` check `width > WORKGROUP_X` and delegate to the fused or split path accordingly
    status: pending
isProject: false
---

# Split Compute Dispatches for Large Tiles

## Problem

When `innerSegments > 13` (edgeVertexCount > 16), the 17x17 vertex grid requires multiple 16x16 workgroups per tile. The `workgroupBarrier()` between the heightmap and normalmap stages only synchronizes within a workgroup, so the normalmap stage can read stale heightmap values written by a neighboring workgroup.

## Approach

All changes are confined to a single file: [packages/three/src/compute/gpu.ts](packages/three/src/compute/gpu.ts). The change is transparent to all callers -- the `compileComputePipeline` return type stays the same.

```mermaid
flowchart TD
    Entry["compileComputePipeline(stages, width)"]
    Check{"width > WORKGROUP_X?"}
    Fused["compileFusedPipeline: single kernel, workgroupBarrier between stages"]
    Split["compileSplitPipeline: one kernel per stage, separate renderer.compute() calls"]
    ExecFused["execute: 1x renderer.compute()"]
    ExecSplit["execute: Nx renderer.compute() with implicit GPU barriers"]

    Entry --> Check
    Check -->|"no (width <= 16)"| Fused --> ExecFused
    Check -->|"yes (width > 16)"| Split --> ExecSplit
```



## Implementation

Refactor `compileComputePipeline` into a router that delegates to one of two internal functions:

- `**compileFusedPipeline**` -- the current implementation, unchanged. All stages in a single kernel with `workgroupBarrier()` between them. Used when `width <= WORKGROUP_X && width <= WORKGROUP_Y`.
- `**compileSplitPipeline**` -- new. Compiles each stage callback as its own compute kernel. The `execute` function dispatches them sequentially via separate `renderer.compute()` calls. WebGPU guarantees an implicit storage buffer barrier between dispatches.

Key details for `compileSplitPipeline`:

- Share a single `uInstanceCount` uniform across all kernels (same `UniformNode` referenced in each `Fn` closure, so the renderer binds the same GPU buffer)
- Each kernel gets the same workgroup size (16x16) and dispatch dimensions
- Each kernel has its own bounds check and stage invocation -- structurally identical to the fused kernel but with only one stage per kernel and no `workgroupBarrier()`
- The `execute` function loops over the compiled kernels and calls `renderer.compute()` for each

```ts
// Pseudocode for the split path
function compileSplitPipeline(stages, width, bindings) {
  const uInstanceCount = uniform(0, "uint");
  const kernels = stages.map(stage =>
    Fn(() => {
      // same preamble as fused kernel (globalId, bounds check, etc.)
      If(inBounds, () => {
        stage(nodeIndex, globalIndex, localUVCoords, localCoordinates, texelSize);
      });
    })().computeKernel(workgroupSize)
  );

  return {
    execute(renderer, instanceCount) {
      uInstanceCount.value = instanceCount;
      for (const kernel of kernels) {
        renderer.compute(kernel, [dispatchX, dispatchY, instanceCount]);
      }
    }
  };
}
```

## What does NOT change

- `ComputePipeline` type stays `ComputeStageCallback[]`
- `compileComputeTask`, `executeComputeTask`, `createComputePipelineTasks` -- unchanged
- `heightmapStageTask`, `normalmapStageTask` -- unchanged
- The scene file -- unchanged
- The accumulation pattern for user-extensible pipelines -- unchanged

