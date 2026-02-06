---
# hello-terrain-0tly
title: Reset quadtree leaf buffers on config change
status: in-progress
type: bug
created_at: 2026-02-05T03:48:58Z
updated_at: 2026-02-05T03:48:58Z
---

Ensure quadtree update resets outLeaves when config/state changes so buffers match new maxNodes.

## Checklist
- [ ] Track quadtree state changes in update task
- [ ] Reset outLeaves when state changes
- [ ] Confirm leaf buffer uses new capacity