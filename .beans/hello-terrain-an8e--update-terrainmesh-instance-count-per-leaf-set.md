---
# hello-terrain-an8e
title: Update TerrainMesh instance count per leaf set
status: completed
type: bug
priority: normal
created_at: 2026-02-05T03:39:05Z
updated_at: 2026-02-05T03:39:18Z
---

Fix stuck quadtree tiles by syncing TerrainMesh instance count with current leaf count each frame.

## Checklist
- [x] Locate render loop and access latest leaf count
- [x] Update TerrainMesh instance count to leaf count
- [x] Verify no stale instances remain