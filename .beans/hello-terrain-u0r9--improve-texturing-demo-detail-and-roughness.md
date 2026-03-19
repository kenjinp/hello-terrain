---
# hello-terrain-u0r9
title: Improve texturing demo detail and roughness
status: completed
type: bug
priority: normal
created_at: 2026-03-18T20:49:29Z
updated_at: 2026-03-18T20:50:59Z
---

Fix texturing example where textures look flat and overly shiny.

## Checklist
- [x] Inspect available texture asset formats and current array packing path
- [x] Improve demo array content to preserve visible detail
- [x] Tune roughness response to avoid overly shiny look
- [x] Validate with lint/typecheck and close bean

## Notes
- The demo was feeding mostly flat solid layers into texture arrays, so there was almost no visible texel detail.
- Replaced solid layers with procedural per-pixel albedo/height/normal/roughness generation (`makeDetailedAlbedoLayer`, `makeHeightLayer`, `makeNormalLayer`, `makeRoughnessLayer`) preserving the same MaterialsBCN IDs/roles.
- Increased roughness defaults and variation (less plastic highlights).
- Lowered default terrain texture scale in terrain material nodes from `10` to `3.5` to increase visible texel frequency.
- Ensured material metalness remains 0 in the scene when texturing nodes are active.

## Verification
- `pnpm -F @hello-terrain/three lint` ✅
- `pnpm -F @hello-terrain/three exec tsc -p tsconfig.json --noEmit` ✅
- `ReadLints` on touched files ✅