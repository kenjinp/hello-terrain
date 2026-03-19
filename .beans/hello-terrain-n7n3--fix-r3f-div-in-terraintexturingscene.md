---
# hello-terrain-n7n3
title: Fix R3F div in TerrainTexturingScene
status: completed
type: bug
priority: normal
created_at: 2026-03-18T19:50:36Z
updated_at: 2026-03-18T19:50:58Z
---

Fix runtime error: 'Div is not part of the THREE namespace' by removing plain DOM node from Canvas subtree in TerrainTexturingScene and replacing with @react-three/drei Html overlay.

## Checklist
- [x] Replace invalid <div> inside Canvas content
- [x] Re-run lint/typecheck for @hello-terrain/three and docs diagnostics
- [x] Mark bean complete

## Notes
- Replaced in-canvas `<div>` with `<Html fullscreen><div .../></Html>`.
- Also removed unused `instanceIndex` import from the scene.
- Verified with ReadLints on `apps/docs/src/examples/TerrainTexturingScene.tsx`.