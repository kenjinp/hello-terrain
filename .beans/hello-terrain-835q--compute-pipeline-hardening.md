---
# hello-terrain-835q
title: Compute pipeline hardening
status: in-progress
type: task
priority: low
created_at: 2026-09-04T16:41:15Z
updated_at: 2026-09-04T16:47:15Z
---

packages/three/src/gpu/compute.ts:
- single-kernel path never invokes midPipelineExecute, so if a caller passes preferSingleKernelWhenPossible: true the tile-bounds reduction is skipped and pack bounds stay zero. Either run it between stages or reject the option when midPipelineExecute is set.
- `type CompiledKernel = any`.
- getDeviceComputeLimits() is called every execute(); cache per renderer.
- ElevationParams.tileUV (localCoordinates / (segments+3)) and the stage `uv` arg never reach 1 and include skirts, unlike tileFaceUV ((ix-1)/segments); document or unify.
- quadtree: ensureChildren allocates 4 object literals per split in an otherwise allocation-free path; add an allocNodeRaw(space, level, x, y).