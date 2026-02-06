---
# hello-terrain-4ou7
title: Force quadtree tasks to recompute
status: in-progress
type: bug
created_at: 2026-02-05T03:54:21Z
updated_at: 2026-02-05T03:54:21Z
---

Try cache: none on quadtree update/buffer tasks to avoid stale buffers.

## Checklist
- [ ] Inspect task API for cache option
- [ ] Apply cache none to update/buffer tasks
- [ ] Verify tiles no longer disappear