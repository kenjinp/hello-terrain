---
# hello-terrain-ljjd
title: Add fullscreen camera zoom
status: completed
type: feature
priority: normal
created_at: 2026-03-19T11:37:55Z
updated_at: 2026-03-19T11:39:12Z
---

Allow the character camera to zoom in/out while the example is in fullscreen mode, with a minimum distance threshold near the character.

## Checklist
- [x] Inspect fullscreen state source and camera hook
- [x] Add fullscreen-gated zoom input for third-person camera radius
- [x] Expose sensible min/max thresholds and pass them through scene/controller
- [x] Verify lint diagnostics for touched files

## Notes

- Zoom is gated by `useExamplesCanvas().isFullscreen`, so mouse wheel only adjusts the camera distance while the example is fullscreen.
- Added smooth interpolation between the current and desired radius so wheel zoom feels like reeling the camera in/out.
- Added a configurable `cameraMinRadius` control in the example scene and clamped zoom between that value and the scene's `cameraRadius`.