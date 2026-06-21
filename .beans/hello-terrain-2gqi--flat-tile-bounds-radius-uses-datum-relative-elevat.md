---
# hello-terrain-2gqi
title: Flat tile bounds radius uses datum-relative elevation extent
status: completed
type: bug
priority: high
created_at: 2026-06-20T23:08:18Z
updated_at: 2026-06-20T23:08:55Z
---

In flat and infiniteFlat topologies, tileBounds placed the bounding-sphere center at mid-elevation (origin.y + (min+max)/2) but computed the radius using vertExtent = max(|min|,|max|) — the extent from the DATUM, not the half-span around the center. This inflated the radius by roughly the tile absolute height above the datum, so elevated tiles split from far away and the LOD detail focus drifted toward high-elevation terrain instead of tracking camera distance. Cube-sphere and torus avoid this via a true centroid + max-distance over displaced corners.

Fixed: radius vertical contribution is now the half-span (max-min)/2 around the mid-elevation center.

## Checklist
- [x] Fix flat.ts tileBounds radius (use (max-min)*0.5)
- [x] Fix infiniteFlat.ts tileBounds radius (same)
- [x] Add regression test for the elevation-range path in flat.test.ts
- [x] Run typecheck + tests (63 passed)