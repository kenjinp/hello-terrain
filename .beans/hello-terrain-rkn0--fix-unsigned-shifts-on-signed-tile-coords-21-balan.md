---
# hello-terrain-rkn0
title: Fix unsigned shifts on signed tile coords (2:1 balance, seams, elevation pyramid)
status: completed
type: bug
priority: high
created_at: 2026-09-04T16:41:13Z
updated_at: 2026-09-04T17:00:00Z
---

Tile x/y are signed Int32 (infinite flat topology uses negative root coords), but ancestor lookups use `>>>`, which wraps negatives to huge uint32 values. Verified: with createInfiniteFlatTopology and camera at x=-500, 100 2:1-balance violations vs 0 at x=+500.

Sites:
- packages/three/src/quadtree/balance2to1.ts:61-62 (`leafX >>> shift`)
- packages/three/src/quadtree/seams.ts:63-64, 88-89
- packages/three/src/query/tile-elevation-pyramid.ts:149-150 (keysX is Uint32; must reinterpret as int32 before shifting, then wrap with >>> 0 for the hash)

## Checklist
- [x] Replace with arithmetic shift (`(x | 0) >> shift`) and re-wrap to uint32 only for hashing
- [x] Add infiniteFlat.test.ts covering negative quadrants: 2:1 balance holds, pyramid ancestor lookup succeeds
- [x] Re-run Quadtree.bench.ts to confirm no perf regression — not applicable: `benchmarks/Quadtree.bench.ts` imports modules that no longer exist, so it cannot run. The fix swaps `>>>` for `>>` (same cost) and adds two `| 0` reinterpretations per leaf in the pyramid build; no allocations were introduced.

## Resolution

- `balance2to1.ts`: ancestor tile coords now use `leafX >> shift` / `leafY >> shift` so negative leaves resolve to their real ancestors (`-8 >> 2 === -2`) and too-coarse neighbors are actually found and split.
- `seams.ts`: parent coords use `x >> 1` / `y >> 1` for the coarser-neighbor path. The finer-neighbor child coords drop the redundant `>>> 0` (`<< 1` is sign-preserving and `lookupSpatialIndexRaw` wraps to uint32 for hashing anyway).
- `tile-elevation-pyramid.ts`: leaf keys read back from `SpatialIndex.keysX/keysY` (stored as wrapped uint32) are reinterpreted as int32 via `| 0` before the arithmetic ancestor shift; `mergeRange` / `lookupTileElevationRange` continue to wrap with `>>> 0`, so signed callers (e.g. `cpu-terrain-cache`) and the build path agree on keys.
- Tests: `quadtree/topology/infiniteFlat.test.ts` (neighbors, negative roots, 2:1 balance in ±quadrants, mirror-symmetric leaf counts), `quadtree/seams.test.ts` (coarser/finer paths with negative coords, mirrored positive layout, mirror-symmetric seam tables), and a negative-coord ancestor case in `query/tile-elevation-pyramid.test.ts`. On the unfixed code these produce 5 failures (140 balance violations, 60 vs 168 leaves, missing coarser seam, missing pyramid ancestors).
