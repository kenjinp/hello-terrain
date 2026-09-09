---
# hello-terrain-essk
title: Make CPU elevation readback opt-in / throttled and surface readback errors
status: in-progress
type: feature
priority: normal
created_at: 2026-09-04T16:41:14Z
updated_at: 2026-09-04T16:47:15Z
---

terrainReadbackTask is always in terrainGraph() and re-triggers whenever the spatial index stampGen advances (every frame the quadtree runs). Each readback copies activeLeafCount * (innerTileSegments+3)^2 * 4 bytes (several MB/frame at defaults) even when no consumer uses TerrainQuery/raycast. Also runDeviceReadback().finally(...) in query/terrain-snapshot.ts has no .catch, so readback failures become unhandled rejections.

## Checklist
- [ ] Add a param (e.g. `terrainQueryReadback: 'off' | 'auto' | { intervalFrames }`) and skip triggerReadback when off
- [ ] React: only target terrainReadback when a query/raycast consumer exists, or expose the option via useTerrain
- [ ] Add .catch that reports once and resets readbackPending
- [ ] Document in core/query/how-it-works.mdx