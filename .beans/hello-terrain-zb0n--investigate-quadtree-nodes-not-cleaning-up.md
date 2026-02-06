---
# hello-terrain-zb0n
title: Investigate quadtree nodes not cleaning up
status: completed
type: bug
priority: normal
created_at: 2026-02-05T03:33:39Z
updated_at: 2026-02-05T03:34:24Z
---

Investigate reports of quadtree quadrants getting stuck and nodes not being cleaned up after camera moves away.

## Checklist
- [x] Inspect quadtree update and cleanup logic for stale nodes
- [x] Trace call sites and state transitions for pruning behavior
- [x] Identify likely cause and report findings