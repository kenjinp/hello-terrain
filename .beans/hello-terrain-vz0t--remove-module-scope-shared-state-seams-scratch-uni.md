---
# hello-terrain-vz0t
title: Remove module-scope shared state (seams scratch, uniforms Vector3, default material, varyings)
status: in-progress
type: task
priority: normal
created_at: 2026-09-04T16:41:14Z
updated_at: 2026-09-04T16:47:15Z
---

Violations of the 'no module-scope variables' rule:
- packages/three/src/quadtree/seams.ts:5-9 module scratch tiles (not re-entrant)
- packages/three/src/tasks/uniforms/uniforms.task.ts:8 shared scratchVector3
- packages/three/src/mesh/TerrainMesh.ts:23-28 defaultTerrainMeshParams allocates one MeshStandardNodeMaterial at import time, shared by every TerrainMesh that omits `material`
- packages/three/src/tsl/varyings.ts module-level varyingProperty nodes

## Checklist
- [ ] Move seams scratch into a createSeamsScratch()/state object (or delete seams.ts if buildSeams2to1 stays unused outside tests)
- [ ] Allocate scratch inside createUniformsTask work() and store on the context
- [ ] Lazily create the default material per mesh in the constructor
- [ ] Decide whether varyings must be shared across materials; if not, create per graph