---
# hello-terrain-4hu6
title: Add camera frustum culling docs example
status: completed
type: task
created_at: 2026-06-27T21:48:54Z
updated_at: 2026-06-27T22:11:33Z
---

Add view-projection data to quadtree update params, wire it from Three cameras/examples/docs, implement frustum culling in the visibility pass, and add a docs example page demonstrating culling from a second camera.

## Checklist

- [x] Inspect existing camera/update/docs example patterns.
- [x] Add frustum data to UpdateParams and visibility culling.
- [x] Wire Three camera view-projection data through runtime examples/docs.
- [x] Add a docs example page demonstrating second-camera frustum culling.
- [x] Run type/lint/unit/docs checks and a GPU smoke where feasible.
- [x] Record results and complete the bean.

## Results

- Added `UpdateParams.viewProjectionMatrix` and `writeUpdateParamsFromCamera` for copying Three camera origin + world-to-clip view-projection data into terrain updates.
- Added frustum sphere culling to `computeTileVisibility`; horizon occlusion remains cube-sphere-only.
- Updated React runtime, manual docs examples, Sandpack templates, and docs snippets to pass view-projection data.
- Added `/examples/frustum-culling`, a second-camera demo with a visible camera helper driving terrain culling.
- Updated React terrain mesh count to use the visible leaf set.

## Verification

- `@hello-terrain/three` typecheck passed.
- Focused `visibility` and `tileSlotCache` tests passed.
- `@hello-terrain/three` build passed.
- `@hello-terrain/react` typecheck passed.
- `@hello-terrain/docs` build and typecheck passed.
- Focused `oxlint`, `git diff --check`, and `beans check` passed.
- Exported frustum page returned `HTTP 200` at `/examples/frustum-culling.html`.
- Real WebGPU torus smoke passed; torus reported `horizonCulledCount: 0`, `unculledCount: 12288`, `visibleRatio: 1`.
