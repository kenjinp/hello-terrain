---
# hello-terrain-3rz2
title: Switch terrain stamps to external CDN
status: completed
type: task
priority: normal
created_at: 2026-03-19T12:28:39Z
updated_at: 2026-03-19T12:29:22Z
---

Update the docs terrain stamp registry to use externally hosted URLs instead of checked-in local PNG files, and expand the registry to cover the full set of upstream Terrain-Stamps PNG assets.

## Checklist
- [x] Get the authoritative upstream stamp list and a stable external host URL pattern
- [x] Update the docs terrain stamp registry to include the full upstream stamp map
- [x] Switch the stamp loader to fetch remote hosted assets
- [x] Verify touched files with lint diagnostics

## Notes

- Switched `terrainStampAssets` to commit-pinned `jsDelivr` URLs using upstream commit `1cd1d727c7c00aa7de1346c0fdae25bcf5e0920a`.
- Expanded the asset registry to include all 20 upstream PNG stamps: 001-004 Hills, 005-008 Ridged, 009-012 Plateaus, 013-016 Plateaus Talus, and 017-020 Terrace Smooth.
- Updated the loader to fetch `downloadUrl` instead of local checked-in assets.
- Removed the four previously downloaded local PNG copies from `apps/docs/public/assets/terrain-stamps/`.
- `ReadLints` reported no diagnostics for the touched file.