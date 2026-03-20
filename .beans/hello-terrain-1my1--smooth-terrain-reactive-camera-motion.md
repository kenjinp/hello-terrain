---
# hello-terrain-1my1
title: Smooth terrain-reactive camera motion
status: completed
type: bug
priority: normal
created_at: 2026-03-19T12:56:34Z
updated_at: 2026-03-19T12:57:00Z
---

Reduce the bouncy third-person camera motion in the raycast character controller example by smoothing the camera position in response to terrain elevation sampling and collision adjustments.

## Checklist
- [x] Inspect current third-person camera terrain/collision update path
- [x] Add smoothing/interpolation to camera position resolution
- [x] Verify touched files with lint diagnostics

## Notes

- Added `smoothedTargetRef` and `smoothedCameraPositionRef` in `useThirdPersonCamera.ts` so both the follow target and resolved camera position interpolate over time.
- Switched desired camera orbit/collision calculations to use the smoothed target instead of the raw per-frame target position.
- Reduced abrupt camera snapping by copying the interpolated camera position into `camera.position` and `lookAt()`ing the smoothed target instead of the raw target.
- `ReadLints` reported no diagnostics for the touched camera files.