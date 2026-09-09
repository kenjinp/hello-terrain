---
# hello-terrain-rsua
title: 'API design audit: suggestions for improvement/overhaul'
status: completed
type: task
priority: normal
created_at: 2026-09-04T19:22:54Z
updated_at: 2026-09-04T19:26:27Z
---

Audited the public API design of @hello-terrain/three and @hello-terrain/react from first principles and delivered a report in chat.

Key findings: (1) no high-level imperative entrypoint for vanilla three.js — consumers must learn @hello-terrain/work to render anything; (2) params are module-scope shared singletons (graph.set copies the shared object reference, so object params like quadtreeUpdate leak mutations across graphs); (3) duplicated sources of truth (radius/rootSize/origin vs topology; innerTileSegments/maxNodes across param, TerrainMesh, React props); (4) public surface is undifferentiated export *; (5) ElevationCallback contract is flat-centric and return units ambiguous; (6) three parallel nullable query interfaces with 20+ methods; (7) React children render-prop + duplicated props footguns; (8) naming (innerTileSegments+3, maxNodes, skirtScale, quadtreeUpdate bundling); (9) compute-stage extension model can double-run pipelines; (10) lifecycle: graph.dispose() does not release GPU resources.

Proposed target: createTerrain(options) handle {mesh, nodes, query, raycast, sampler, update, set, dispose, graph}; per-instance params; topology as sole shape owner; unified position-keyed TerrainQuery; subpath exports; ElevationInput with surface frame.

## Checklist
- [x] Read specs and public surface
- [x] Read consumer-facing usage (docs examples, react wrapper)
- [x] Produce audit report with concrete suggestions