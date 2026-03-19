---
# hello-terrain-dons
title: Fix texturing example TSL uint/uvScale runtime errors
status: completed
type: bug
priority: normal
created_at: 2026-03-18T20:06:25Z
updated_at: 2026-03-18T20:07:49Z
---

Investigate and fix runtime errors on texturing docs example: invalid uint parameter and undefined max from TSL node graph.

## Checklist
- [x] Reproduce/inspect code path causing invalid uint and undefined max
- [x] Fix control-map decode/read node API to expose stable node fields
- [x] Verify with typecheck/lint and docs lints
- [x] Mark bean complete

## Root cause
- `textureControlFn` was wrapped with a TSL `Fn` returning an object. At use-site this produced a shader-call node, not a plain field-addressable object, causing `packControlU32` to receive undefined fields (`uint(undefined)` invalid parameter).
- Material node decode path also relied on object field access from a TSL function return, yielding `undefined` for `uvScale` at runtime (`Cannot read properties of undefined (reading 'max')`).

## Fix
- In `control-map-stage.task.ts`, call `userTextureControlFn` directly with Node params (no object-returning `Fn` wrapper in this path).
- In `tsl/controlMap.ts`, added explicit per-field decode helpers (`decodeControlBaseId`, `decodeControlOverlayId`, `decodeControlBlend`, `decodeControlUvScale`, etc.).
- In `tsl/terrainMaterial.ts`, switched to packed read + explicit field decode helpers (no object-cast/property access).

## Verification
- `pnpm -F @hello-terrain/three lint` ✅
- `pnpm -F @hello-terrain/three exec tsc -p tsconfig.json --noEmit` ✅
- `ReadLints` on touched files ✅