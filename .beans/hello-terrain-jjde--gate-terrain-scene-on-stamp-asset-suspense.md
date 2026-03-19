---
# hello-terrain-jjde
title: Gate terrain scene on stamp asset suspense
status: completed
type: feature
priority: normal
created_at: 2026-03-19T12:46:54Z
updated_at: 2026-03-19T12:47:41Z
---

Use React Suspense so the raycast character controller scene does not render until the required terrain stamp assets are loaded and decoded.

## Checklist
- [x] Inspect current stamp loading flow and scene composition
- [x] Convert terrain stamp loading to a Suspense-compatible read path
- [x] Wrap the scene with a Suspense boundary so rendering waits for the assets
- [x] Verify touched files with lint diagnostics

## Notes

- Replaced the effect/state-based `useTerrainStampTextures()` flow with a Suspense read cache in `terrainStamps.ts` that throws the pending load promise until each required asset resolves.
- Added `useTerrainStampTexturesSuspense()` so the raycast scene gets a fully resolved texture map during render instead of rendering with partial readiness state.
- Wrapped `RaycastCharacterControllerSceneImpl` in `<Suspense fallback={null}>`, so the terrain scene does not mount until all referenced stamp textures have been fetched and decoded.
- `ReadLints` reported no diagnostics for the touched files.