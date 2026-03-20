---
# hello-terrain-rjsn
title: Further reduce camera bounce
status: completed
type: bug
priority: normal
created_at: 2026-03-19T14:54:02Z
updated_at: 2026-03-19T14:54:50Z
---

Investigate the remaining bouncy third-person camera motion and improve it by smoothing the most jitter-prone vertical and collision-driven adjustments.

## Checklist
- [x] Inspect controller and camera vertical update paths for remaining bounce sources
- [x] Improve smoothing strategy for target/camera vertical motion and collision response
- [x] Verify touched files with lint diagnostics

## Notes

- Split camera smoothing into separate horizontal and vertical damping instead of using one blend factor for all axes.
- Added `smoothedFloorYRef` so terrain floor clamping is low-pass filtered before it affects the camera Y position.
- Switched target and camera vertical motion to slower interpolation while keeping horizontal follow more responsive.
- Used asymmetric vertical damping so upward collision/floor corrections react faster than downward settling, reducing terrain jitter without making the camera feel laggy.
- `ReadLints` reported no diagnostics for `apps/docs/src/examples/character/useThirdPersonCamera.ts`.