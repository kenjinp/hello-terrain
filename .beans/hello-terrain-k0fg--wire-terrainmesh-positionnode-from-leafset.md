---
# hello-terrain-k0fg
title: Wire TerrainMesh positionNode from LeafSet
status: completed
type: task
priority: normal
created_at: 2026-02-05T02:34:57Z
updated_at: 2026-02-05T02:36:33Z
---

Implement a TSL position node that uses quadtree LeafSet data for per-instance transforms in TerrainMeshScene.\n\n## Checklist\n- [x] Add LeafSet upload + storage buffer plumbing in TerrainMeshScene\n- [x] Build positionNode that reads per-instance tile data and outputs world position