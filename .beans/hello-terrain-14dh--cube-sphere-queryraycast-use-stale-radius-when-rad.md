---
# hello-terrain-14dh
title: Cube-sphere query/raycast use stale radius when radius changes
status: completed
type: bug
priority: normal
created_at: 2026-06-21T01:13:21Z
updated_at: 2026-06-21T01:13:21Z
---

User report: increasing the cube-sphere demo radius places the click/query indicator incorrectly — the marker stays at the old radius.

Root cause: terrainQueryTask only recreated the CPU cache + runtime queries when its shapeKey (maxNodes:innerTileSegments:projection.kind) changed. Radius/center are NOT in shapeKey, and the projection's CPU surfaceOps (surfacePosition/surfaceNormal) and the sphereQuery close over radius/center by value. So changing the radius (which rebuilds the topology/projection) left the queries bound to the OLD radius: surfacePosition placed hits/markers at oldRadius+elevation while the rendered surface moved to the new radius. cache.updateConfig only updates config.radius (used for tile-size/gradient scaling), not the surfaceOps closures.

Fix:
- Added CpuTerrainCache.setSurfaceOps(ops) to swap the projection surface math without reallocating buffers.
- terrainQueryTask now also tracks a geometryKey (radius, center, faceOutward, baseResolution). On geometry-only change it swaps surfaceOps and rebuilds the runtime queries (which close over center); on shape change it still fully recreates the cache. Returned context carries geometryKey.
- This also refreshes terrain-raycast state and the React runtime (cone marker) since both read the queries from terrainQueryTask.

Regression test added (cubeSphere-query.test.ts: setSurfaceOps re-targets queries when radius changes). All three-package tests + workspace typecheck green. Docs/spec TerrainQueryContext updated.