---
# hello-terrain-ozk5
title: Boost visible terrain stamp scale
status: completed
type: bug
priority: normal
created_at: 2026-03-19T12:40:42Z
updated_at: 2026-03-19T12:41:38Z
---

Make the terrain stamps in the raycast character controller scene visually obvious by adjusting placement, radius, and height so the formations are clearly readable from the playable area.

## Checklist
- [x] Inspect current stamp layout relative to spawn/view scale
- [x] Increase and reposition stamps to be clearly visible in the scene
- [x] Verify touched files with lint diagnostics

## Notes

- Increased the main `plateausTalus` formations from roughly 116-144 radius / 0.15-0.18 height to roughly 214-248 radius / 0.30-0.44 height.
- Pulled the dominant formations closer to the origin so they appear in the near-to-mid field of the character camera instead of mostly at the periphery.
- Upscaled supporting ridge, terrace, plateau, and hills layers to preserve more realistic terrain continuity at the new larger landform scale.
- `ReadLints` reported no diagnostics for `apps/docs/src/examples/RaycastCharacterControllerScene.tsx`.