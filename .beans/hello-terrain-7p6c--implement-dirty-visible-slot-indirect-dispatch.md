---
# hello-terrain-7p6c
title: Implement dirty-visible-slot indirect dispatch
status: todo
type: task
created_at: 2026-06-27T22:52:33Z
updated_at: 2026-06-27T22:52:33Z
---

Implement Phase 3 dirty-visible compute dispatch now that slot-addressed storage plumbing exists. Add an internal compute pipeline instance source for dirty-visible slots, upload dirty visible slot IDs to GPU, dispatch standard terrain compute and tile bounds over dirtyVisibleCount, preserve correctness for readback/query snapshots, and validate with focused tests plus GPU lab scenarios.

## Checklist

- [ ] Add a dirty-visible slot GPU storage/upload task.
- [ ] Add an internal compute pipeline instance source for dirty-visible slots.
- [ ] Switch standard terrain compute to dispatch `dirtyVisibleCount` and map dispatch index to `fieldSlot`.
- [ ] Update tile bounds reduction for dirty-visible slots or document the conservative fallback.
- [ ] Validate cold, drift, and teleport scenarios in the GPU lab.
