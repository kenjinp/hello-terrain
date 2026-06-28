---
# hello-terrain-d52w
title: Refresh frustum culling when character camera rotates
status: completed
type: bug
priority: normal
created_at: 2026-06-28T00:12:12Z
updated_at: 2026-06-28T00:29:42Z
---

Root cause: `useTerrainRunner` only published `quadtreeUpdate` when the snapped
camera origin moved past hysteresis. Character-controller camera orbit changes
updated the Three camera view/projection matrix without changing that snapped
origin, so terrain frustum culling kept using stale camera orientation until the
character moved.

- [x] Identify stale view-projection update path
- [x] Add view-projection matrix change detection to the React runner
- [x] Keep origin hysteresis for snapped LOD origin updates
- [x] Add focused unit tests
- [x] Validate React tests, typecheck, and lint
