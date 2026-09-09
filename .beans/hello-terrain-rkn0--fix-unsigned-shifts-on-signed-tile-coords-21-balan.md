---
# hello-terrain-rkn0
title: Fix unsigned shifts on signed tile coords (2:1 balance, seams, elevation pyramid)
status: in-progress
type: bug
priority: high
created_at: 2026-09-04T16:41:13Z
updated_at: 2026-09-04T16:47:14Z
---

Tile x/y are signed Int32 (infinite flat topology uses negative root coords), but ancestor lookups use `>>>`, which wraps negatives to huge uint32 values. Verified: with createInfiniteFlatTopology and camera at x=-500, 100 2:1-balance violations vs 0 at x=+500.

Sites:
- packages/three/src/quadtree/balance2to1.ts:61-62 (`leafX >>> shift`)
- packages/three/src/quadtree/seams.ts:63-64, 88-89
- packages/three/src/query/tile-elevation-pyramid.ts:149-150 (keysX is Uint32; must reinterpret as int32 before shifting, then wrap with >>> 0 for the hash)

## Checklist
- [ ] Replace with arithmetic shift (`(x | 0) >> shift`) and re-wrap to uint32 only for hashing
- [ ] Add infiniteFlat.test.ts covering negative quadrants: 2:1 balance holds, pyramid ancestor lookup succeeds
- [ ] Re-run Quadtree.bench.ts to confirm no perf regression