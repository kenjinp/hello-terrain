---
# hello-terrain-832g
title: Fix terrain array texture write layer for Three r182
status: completed
type: bug
priority: normal
created_at: 2026-09-06T20:41:06Z
updated_at: 2026-09-06T21:16:31Z
---

The new WebGPU gym reproduced invalid WGSL: textureStore omitted the array layer because a vec3 UV is truncated by Three r182 StorageTextureNode. Set a separate depth node before appending the store. Verify with the real browser scenario.