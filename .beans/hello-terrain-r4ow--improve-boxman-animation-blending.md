---
# hello-terrain-r4ow
title: Improve Boxman animation blending
status: completed
type: feature
priority: normal
created_at: 2026-03-19T10:42:56Z
updated_at: 2026-03-19T10:44:39Z
---

Improve the Sketchbook Boxman integration by mapping more of the original animation clips and improving state transitions/blending.

## Checklist
- [x] Review current controller/model animation contract
- [x] Add richer animation hints from controller state
- [x] Map additional Sketchbook clips such as start, stop, and rotate
- [x] Verify lint diagnostics for touched files

## Notes

- Added one-shot transitions for `start_forward`, `start_left`, `start_right`, `start_back_left`, `start_back_right`, `stop`, `rotate_left`, and `rotate_right`.
- Retained looping locomotion/air clips for `idle`, `run`, `sprint`, `jump_idle`, `jump_running`, and `falling`.
- The controller stays reusable; the richer animation behavior is derived in the model layer from motion state, turn rate, speed, and current input.