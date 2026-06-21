---
# hello-terrain-iyg3
title: Inverted cube-sphere raycast/query picks land on the opposite side
status: completed
type: bug
priority: normal
created_at: 2026-06-21T01:07:14Z
updated_at: 2026-06-21T01:07:14Z
---

User report: raycasting demos for cube-sphere/torus 'don't seem to work'. Investigation (faithful repro of the projection.cpu.raycast demo path) shows the DEFAULT (non-inverted) cube-sphere and torus pick paths are correct — center and off-center rays land precisely on the displaced surface, and the React <Terrain> integration wires terrainRaycast correctly.

Real bug found: inverted cube-sphere (invert: true). packages/three/src/projection/cubeSphere.ts surfaceOps stored the INWARD shading normal in SurfaceKey.dir (dir = n * dirSign). Then:
- surfacePosition reused key.dir as the radial direction -> reconstructed the hit at center + (-n)*(radius-elev), i.e. MIRRORED to the opposite side of the planet.
- surfaceNormal fed the inward dir to directionToFaceUV(key.space, dir), but space was computed from the OUTWARD normal -> wrong face/uv -> wrong neighbor sampling -> wrong normal.

Torus invert is correct (surfacePosition recomputes from u,v, not dir).

Fix: keep SurfaceKey.dir as the OUTWARD geometric radial direction. surfacePosition (center + dir*r) and directionToFaceUV(dir) are now correct on the same side; surfaceNormal flips the oriented normal inward for invert to match the GPU. Non-inverted path unchanged. Added regression test in cubeSphere-query.test.ts. All three-package tests + workspace typecheck green.

NOTE: could not reproduce a DEFAULT-config failure; if the user sees broken picking with invert OFF, the cause is likely environmental (WebGPU/query snapshot not populating) rather than the raycast math.