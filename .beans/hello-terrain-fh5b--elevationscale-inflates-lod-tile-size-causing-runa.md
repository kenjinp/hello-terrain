---
# hello-terrain-fh5b
title: elevationScale inflates LOD tile size, causing runaway subdivision
status: completed
type: bug
priority: high
created_at: 2026-06-20T21:48:46Z
updated_at: 2026-06-20T21:52:38Z
---

## Problem

`topology.tileBounds()` produced a single bounding radius `r` that contains the displaced geometry (corners on both the min and max elevation shells, scaled by `elevationScale`). That same `r` was the *only* value consumed by `shouldSplit` (criteria.ts) as the LOD subdivision-size metric — no frustum culling uses it.

Result: vertical relief drove horizontal subdivision. A tile with a small footprint but deep relief got a large `r`, so `shouldSplit` (threshold = r * distanceFactor) kept subdividing past what its footprint warranted, blowing the maxNodes budget. `elevationScale: 1` only masked it by flattening terrain.

## Fix (done)

Decoupled the two concerns in `TileBounds`:
- `r` stays the conservative bounding radius (includes displaced geometry — forward-looking for culling).
- New `lodRadius`: horizontal footprint radius (datum shell), excludes vertical relief.
- `shouldSplit` now uses `lodRadius` (distance + screen modes).
- flat/cubeSphere/torus topologies compute `lodRadius` from the datum footprint.

When no elevation range is supplied, `lodRadius === r`, so existing behavior is unchanged (verified by tests).

## Checklist
- [x] Add `lodRadius` to `TileBounds` (quadtree/types.ts) + scratch in state.ts
- [x] `shouldSplit` uses `lodRadius` (criteria.ts)
- [x] flat.ts tileBounds sets lodRadius (footprint half-diagonal)
- [x] cubeSphere.ts tileBounds computes footprint lodRadius
- [x] torus.ts tileBounds computes footprint lodRadius
- [x] Update tests (flat/cubeSphere/torus topology tests, incl. new relief-decoupling assertions)
- [x] Update docs (topology.mdx Elevation-aware LOD bounds + Topology type, quadtree README)
- [x] Run lint + typecheck + tests (64 passing) + build dist