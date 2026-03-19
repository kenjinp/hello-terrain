---
# hello-terrain-vpr4
title: Fix fragment sampler limit in texturing scene
status: completed
type: bug
priority: normal
created_at: 2026-03-18T22:18:15Z
updated_at: 2026-03-18T22:18:48Z
---

TerrainTexturingScene exceeds WebGPU fragment sampled texture limit (17 > 16). Reduce sampled textures by limiting scene material set to textures actually used by textureControlFn and remap control IDs accordingly.