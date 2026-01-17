---
# hello-terrain-i6lj
title: Add vitest suite for TerrainGeometry
status: completed
type: task
priority: normal
created_at: 2026-01-16T03:25:34Z
updated_at: 2026-01-16T03:28:40Z
---

Add a focused test suite for packages/three/src/geometry/TerrainGeometry.ts.\n\n## Checklist\n- [ ] Validate constructor input constraints (NaN/0/float/Infinity)\n- [ ] Validate attribute sizes/types and index length invariants for a few innerSegments\n- [ ] Validate positions range and skirt clamping behavior\n- [ ] Validate normals (interior up, edges outward, corners diagonal)\n- [ ] Validate UV generation for extendUV true vs false\n- [ ] Validate index winding/diagonal flip for a tiny grid via exact expected indices\n- [ ] Ensure tests run via pnpm -F @hello-terrain/three test
Add a focused test suite for `packages/three/src/geometry/TerrainGeometry.ts`.

## Checklist
- [x] Validate constructor input constraints (NaN/0/float/Infinity)
- [x] Validate attribute sizes/types and index length invariants for a few innerSegments
- [x] Validate positions range and skirt clamping behavior
- [x] Validate normals (interior up, edges outward, corners diagonal)
- [x] Validate UV generation for extendUV true vs false
- [x] Validate index winding/diagonal flip for a tiny grid via exact expected indices
- [x] Ensure tests run via pnpm -F @hello-terrain/three test