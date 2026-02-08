---
# hello-terrain-db5g
title: Add normal map reader to TerrainHeightmapScene
status: completed
type: task
priority: normal
created_at: 2026-02-08T04:29:46Z
updated_at: 2026-02-08T04:30:42Z
---

Fill in the normalMapNode Fn body to read packed normals from the normalmap storage buffer, unpack them, reconstruct the Z component, and return the vec3 normal.