---
# hello-terrain-se9i
title: Serialize graph runs in TerrainMeshScene
status: in-progress
type: bug
created_at: 2026-02-05T03:52:35Z
updated_at: 2026-02-05T03:52:35Z
---

Prevent concurrent graph runs in useFrame to avoid interleaving quadtree updates.

## Checklist
- [ ] Add in-flight guard for g.run()
- [ ] Ensure mesh count and storage updates still happen
- [ ] Verify no stale tiles from overlapping runs