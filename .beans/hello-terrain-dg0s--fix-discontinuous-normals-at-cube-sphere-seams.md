---
# hello-terrain-dg0s
title: Fix discontinuous normals at cube-sphere seams
status: completed
type: bug
priority: high
created_at: 2026-06-12T03:12:48Z
updated_at: 2026-06-12T03:19:07Z
---

Shading is discontinuous across cube-face seams (and tile edges) in the cube-sphere topology. The elevation field is already continuous across seams (apron texels use unclamped face UVs and the elevation fn is a function of direction), so the artifact is purely in normal derivation.

## Root cause
1. Normals were computed as central differences in face-local (u,v) parametric space, scaled by a single scalar step (tileSize/innerSegments). The cube->sphere (gnomonic) map is non-uniform, so equal (u,v) steps are unequal arc lengths; the Jacobian is ignored, and is wrong by a different factor on each side of a seam.
2. The packed (nx,nz) were interpreted in each face's own (right,up) tangent frame and rotated to world via sphereTangentFrameNormal. Adjacent faces have rotated bases, so identical world slopes decompose/reconstruct into mismatched world normals at the seam. (The sphere tangent frame is also not exactly orthonormal, so a decompose->reconstruct round-trip is not identity.)

## Fix
Store TRUE world-space surface normals in the terrain field (RGBA = [height, Nx, Ny, Nz]).
- cube-sphere: compute the normal from the cross product of neighbor world positions (dir*(radius + h*scale)), which is automatically metric- and curvature-correct and frame-independent. Both faces at a seam evaluate the same physical neighbor points -> same normal.
- flat: existing normalize(-dhdx, 1, -dhdz) already is the world normal; store all three components.
- render (worldPosition.ts) and GPU query (terrain-sampler.ts) read the world normal directly (drop unpackTangentNormal / sphereTangentFrameNormal at those call sites).
- CPU mirror (cpu-terrain-cache.computeSphereNormal) recomputed with the same world cross-product approach for parity.

## Checklist
- [x] Change terrain field packing to store world normal (Nx,Ny,Nz) in terrainFieldStorage.ts
- [x] Compute world-space normal in terrain-field.task.ts (cube-sphere cross product; flat full normal)
- [x] Render: read world normal directly in worldPosition.ts
- [x] GPU query: read world normal directly in terrain-sampler.ts
- [x] CPU: world cross-product normal in cpu-terrain-cache.ts computeSphereNormal
- [x] Build + lint clean (typecheck all packages, 46 three tests pass, oxlint clean for edited files)
- [x] Update docs (elevation-stage blog note + query/how-it-works + spec concepts/data-model)