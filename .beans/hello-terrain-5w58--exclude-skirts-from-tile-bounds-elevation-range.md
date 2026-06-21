---
# hello-terrain-5w58
title: Exclude skirts from tile bounds elevation range
status: completed
type: bug
priority: normal
created_at: 2026-06-20T22:48:37Z
updated_at: 2026-06-20T22:49:47Z
---

The tile bounds reduction kernel (packages/three/src/tasks/tile-bounds.task.ts) computed per-tile min/max elevation by iterating over ALL vertices per node, including the outermost skirt ring (ix/iy at 0 or edgeVertexCount-1). Skirt vertices sample elevation OUTSIDE the real tile area, inflating the elevation range used to build the LOD split bounding sphere (topology.tileBounds). Fixed by skipping the skirt ring in the reduction so the (min,max) reflects only the real surface relief.

## Checklist
- [x] Update buildReductionKernel to skip the skirt ring (border vertices) when reducing min/max
- [x] Verify vertex ordering: globalIndex = nodeIndex*verticesPerNode + iy*edge + ix
- [x] Run typecheck/tests (62 passed)
- [x] Update docs (how-it-works.mdx bounds reduction section)