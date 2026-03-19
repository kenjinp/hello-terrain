---
# hello-terrain-q4ao
title: Add terrain stamp module to docs scene
status: completed
type: feature
priority: normal
created_at: 2026-03-19T11:42:07Z
updated_at: 2026-03-19T11:44:45Z
---

Bring the Terrain-Stamps concept into the docs app by adding a reusable terrain stamp composition module and integrating several placed stamps into the raycast character controller example.

## Checklist
- [x] Review current raycast character controller terrain setup and upstream Terrain-Stamps concept
- [x] Create a reusable docs-side terrain stamp module for composing placed height stamps
- [x] Integrate several terrain stamps into the raycast character controller scene
- [x] Verify edited files with lint diagnostics and fix issues if needed

## Notes

- Added `apps/docs/src/examples/terrain/terrainStamps.ts` with a reusable stamped FBM elevation factory and placed stamp definitions supporting center, radius, profile, rotation, stretch, and falloff.
- Integrated several authored stamps into `apps/docs/src/examples/RaycastCharacterControllerScene.tsx`, including a mesa near spawn plus cone, crater, and ridge landmarks nearby.
- `ReadLints` reported no diagnostics for the touched files.
- `pnpm --filter @hello-terrain/docs type-check` still cannot run in this environment because `tsc` is not installed on the path.