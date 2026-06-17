---
# hello-terrain-g5nn
title: Fix MeshStandardNodeMaterial R3F extend error in FbmTerrainScene
status: completed
type: bug
priority: high
created_at: 2026-06-16T11:04:31Z
updated_at: 2026-06-16T11:04:59Z
---

Runtime error on /docs/core/elevation-function route: R3F: MeshStandardNodeMaterial is not part of the THREE namespace! Did you forget to extend? Error at src/examples/FbmTerrainScene.tsx (151:7). Need to extend the node material into the R3F catalog.