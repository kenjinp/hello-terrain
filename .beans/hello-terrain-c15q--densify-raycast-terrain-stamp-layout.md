---
# hello-terrain-c15q
title: Densify raycast terrain stamp layout
status: completed
type: feature
priority: normal
created_at: 2026-03-19T12:38:48Z
updated_at: 2026-03-19T12:39:27Z
---

Fill the raycast character controller scene with many Plateau Talus terrain stamps plus complementary variants, adjusting placement, spacing, and scale to feel more like a believable traversable landscape.

## Checklist
- [x] Inspect current stamp placement in the raycast character controller scene
- [x] Replace the sparse layout with a denser realistic mix centered on Plateau Talus formations
- [x] Verify touched files with lint diagnostics

## Notes

- Replaced the small six-stamp layout with a much denser arrangement built primarily from `plateausTalus013` through `plateausTalus016`.
- Kept the immediate spawn area comparatively gentle by using a broad low hills base and pushing most stronger mesa/talus formations outward into clusters and rings.
- Added complementary `ridged`, `plateaus`, `terrace`, and `hills` variants at larger radii to make the terrain read more like connected landforms instead of isolated props.
- `ReadLints` reported no diagnostics for `apps/docs/src/examples/RaycastCharacterControllerScene.tsx`.