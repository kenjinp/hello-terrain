---
# hello-terrain-osxj
title: Fix terrain texturing normal lighting response
status: completed
type: bug
priority: normal
created_at: 2026-03-18T20:46:15Z
updated_at: 2026-03-18T20:47:01Z
---

Fix incorrect lighting on texturing example where terrain appears uniformly bright/dark with camera movement. Investigate normal node generation and apply correct normal mapping transform.

## Checklist
- [x] Compare TerrainTexturing normal pipeline to MaterialsBCN normal pipeline
- [x] Patch terrain normal node generation
- [x] Validate with lint and typecheck
- [x] Mark bean completed

## Root cause
`createTerrainNormalNode` returned a blended tangent-space vector directly as `normalNode`. `meshStandardNodeMaterial` expects proper normal-map decoding/transform (via `normalMap(...)`) rather than raw tangent vectors, causing unstable/incorrect lighting response relative to camera.

## Fix
- Updated `createTerrainNormalNode` in `packages/three/src/tsl/terrainMaterial.ts` to:
  - blend normals,
  - normalize,
  - convert vector-space [-1,1] to texture-space [0,1],
  - return `normalMap(...)` with scale `vec2(1,1)`.
- Also corrected roughness read to `.a` to match current texture packing (`normalRoughness` stores roughness in alpha).

## Verification
- `pnpm -F @hello-terrain/three lint` ✅
- `pnpm -F @hello-terrain/three exec tsc -p tsconfig.json --noEmit` ✅
- `ReadLints` on touched files ✅