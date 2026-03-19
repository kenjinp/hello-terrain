---
# hello-terrain-lrjf
title: Fix terrain stamp CDN initialization order
status: completed
type: bug
priority: normal
created_at: 2026-03-19T12:37:36Z
updated_at: 2026-03-19T12:38:04Z
---

Resolve the runtime module initialization error in the docs terrain stamp registry where the CDN base constant is referenced before it is initialized.

## Checklist
- [x] Inspect the terrain stamp module initialization order
- [x] Reorder constants/helpers so the asset registry initializes safely
- [x] Verify touched files with lint diagnostics

## Notes

- Moved the CDN commit/base constants and `createTerrainStampAsset()` helper above `terrainStampAssets` so the registry no longer references a not-yet-initialized const during module evaluation.
- `ReadLints` reported no diagnostics for `apps/docs/src/examples/terrain/terrainStamps.ts`.