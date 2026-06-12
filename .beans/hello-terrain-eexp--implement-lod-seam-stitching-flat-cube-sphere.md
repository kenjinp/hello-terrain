---
# hello-terrain-eexp
title: Implement LOD seam stitching (flat + cube-sphere)
status: in-progress
type: feature
priority: high
created_at: 2026-06-12T11:37:34Z
updated_at: 2026-06-12T11:37:34Z
---

Implement T-junction seam stitching across 2:1 LOD boundaries for flat and cube-sphere topologies, per the approved plan (.cursor/plans/lod_seam_stitching_84d0865f.plan.md).

Approach: compute a per-leaf 4-bit "coarser-neighbor" edge mask on the CPU, upload it packed into leaf storage slot 3 (space | mask<<3), and in the vertex shader snap each fine tile's odd boundary vertices (position + normal) onto the chord between their even edge-neighbors. Skirts retained as a safety net.

## Checklist
- [ ] buildCoarseEdgeMask in quadtree/seams.ts + unit test (flat boundary + cube-face seam)
- [ ] Compute mask in leafGpuBufferTask; pack into slot 3; update decodeLeafTile
- [ ] Vertex shader geometric stitch (tileWorldPositionAt + odd-vertex midpoint snap)
- [ ] Vertex shader normal blend (mean of even edge-neighbor normals)
- [ ] Even innerSegments validation; Dir<->edge mapping; stitchSeams param (default on)
- [ ] Docs/spec updates
- [ ] typecheck/test/lint clean