---
# hello-terrain-xob0
title: Systemic terrain cache invalidation for culling-affecting params
status: completed
type: bug
priority: normal
created_at: 2026-06-28T00:34:46Z
updated_at: 2026-06-28T00:41:28Z
---

Root cause: persistent tile slots only tracked tile identity. When field-generation
inputs changed (`elevationScale`, `elevationFn`, root/radius uniforms), visible
tiles with the same tile key were reused as clean, so GPU field data/readback
could remain tied to the previous generation.

- [x] Add a separate field content key from tile shape identity
- [x] Dirty reused visible slots when their stored content key is stale
- [x] Preserve retained inactive slots but dirty them when they re-enter with stale content
- [x] Include `maxLevel` in CPU query cache shape identity
- [x] Add regression tests for field content invalidation
- [x] Validate full tests, typecheck, and lint
