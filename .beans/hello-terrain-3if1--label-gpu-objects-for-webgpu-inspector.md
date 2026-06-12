---
# hello-terrain-3if1
title: Label GPU objects for WebGPU Inspector
status: completed
type: task
priority: normal
created_at: 2026-06-12T02:40:27Z
updated_at: 2026-06-12T02:41:54Z
---

GPU buffers/textures created by @hello-terrain/three showed up unlabelled in the WebGPU Inspector. three.js derives WebGPU `label` from object names. Added names to all GPU objects we create.

## Checklist
- [x] leafStorage attribute name
- [x] gpuSpatialIndex attribute name
- [x] elevation field attribute + node name
- [x] tile bounds attribute + node name
- [x] terrainFieldStorage textures (array + atlas) name
- [x] TerrainGeometry position/normal/uv/index attribute names
- [x] TerrainMesh instanceMatrix/instanceColor names
- [x] compute uInstanceCount uniform name
- [x] typecheck/lint/tests pass