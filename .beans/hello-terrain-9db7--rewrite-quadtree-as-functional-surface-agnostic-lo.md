---
# hello-terrain-9db7
title: Rewrite quadtree as functional, surface-agnostic LOD
status: completed
type: feature
priority: normal
created_at: 2026-02-04T03:09:07Z
updated_at: 2026-02-04T03:28:55Z
---

Implement the new functional quadtree API directly in packages/three/src/quadtree/ (replacing old API), optimized for hot loops and Earth-scale, with 2:1 balancing and fixed-width seam buffers. Add Vitest tests adjacent to each module.\n\n## Checklist\n+- [x] Define core types and exported functional API (TileId, LeafSet SoA, SeamTable, Surface interface)\n+- [x] Implement NodeStore typed-array layout (firstChild contiguity, generation stamping, iterative stack scratch)\n+- [x] Implement LOD criteria (distanceSq + optional screen-space) without allocations\n+- [x] Implement iterative refine traversal producing LeafSet (SoA)\n+- [x] Implement leaf spatial index for (space,level,x,y)->leafIndex (Earth-scale safe, no packed u32 key)\n+- [x] Implement 2:1 balancing loop using Surface topology + leaf index\n+- [x] Implement fixed-width seam/neighbor table (4 edges x 2) for balanced leaves\n+- [x] Implement FlatSurface (neighbor mapping + conservative camera-relative bounds)\n+- [x] Add CubeSphereSurface stub (topology hooks) to localize future planet work\n+- [x] Add adjacent Vitest tests per module (refine invariants, 2:1 invariant, index correctness, seam table shape)\n+- [x] Ensure package build/tests pass (pnpm -F @hello-terrain/three test)