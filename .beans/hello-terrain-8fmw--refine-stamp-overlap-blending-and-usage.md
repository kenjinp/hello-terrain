---
# hello-terrain-8fmw
title: Refine stamp overlap blending and usage
status: completed
type: feature
priority: normal
created_at: 2026-03-19T12:42:32Z
updated_at: 2026-03-19T12:43:49Z
---

Reduce the number of terrain stamps in the raycast character controller scene, make overlapping stamps blend more gracefully instead of cutting through each other, and ensure the loader only fetches assets that the scene actually references.

## Checklist
- [x] Inspect current stamp composition and loading path
- [x] Reduce the scene to fewer more readable stamps
- [x] Improve stamp overlap blending in the terrain stamp composition module
- [x] Verify touched files with lint diagnostics

## Notes

- Confirmed the loader was already only fetching the distinct `assetId`s referenced by `terrainStamps` via `terrainStampAssetIds`, not the full upstream registry.
- Reduced the scene composition to a smaller set of dominant formations: one broad hills base, four `plateausTalus` masses, two ridge bands, and two terrace-side features.
- Changed stamp composition from raw additive stacking to a layered lift model: each stamp now blends terrain toward its own target elevation over a soft mask, which avoids overlapping stamps sharply cutting through each other.
- `ReadLints` reported no diagnostics for the touched files after the blending change.