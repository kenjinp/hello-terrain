---
# hello-terrain-pi4h
title: Integrate 16-bit terrain stamp PNGs into docs
status: completed
type: feature
priority: normal
created_at: 2026-03-19T12:21:01Z
updated_at: 2026-03-19T12:25:21Z
---

Bring actual 16-bit Terrain-Stamps PNG assets into the docs app in a reusable way, then apply several of them to the raycast character controller example.

## Checklist
- [x] Inspect existing docs terrain stamp implementation and determine how to sample 16-bit stamp assets cleanly
- [x] Add a modular docs-side stamp asset pipeline/loader for 16-bit PNG terrain stamps
- [x] Integrate several upstream stamp assets into the raycast character controller scene
- [x] Verify edited files with lint diagnostics and fix issues if needed

## Notes

- Downloaded four upstream 16-bit grayscale stamp PNGs into `apps/docs/public/assets/terrain-stamps/`.
- Added a reusable docs-side stamp asset registry plus `useTerrainStampTextures()` loader that decodes 16-bit PNGs with `fast-png`, packs them into RG byte textures, and samples them from the elevation callback.
- Replaced the procedural profile-only placements in `RaycastCharacterControllerScene.tsx` with several data-driven placements using the upstream Hills, Ridged, Plateaus, and Terrace Smooth stamp maps.
- `ReadLints` reported no diagnostics for the touched files.
- `pnpm --filter @hello-terrain/docs type-check` still cannot run in this environment because `tsc` is not installed on the path.