---
# hello-terrain-jxdi
title: Fix stale Terrain type errors in TorusTerrainScene
status: completed
type: bug
priority: normal
created_at: 2026-06-16T14:30:06Z
updated_at: 2026-06-16T14:31:45Z
---

Editor reports 'no exported member TerrainHandle' and TerrainProps mismatch in apps/docs/src/examples/TorusTerrainScene.tsx. Root cause: stale @hello-terrain/react dist consumed by the docs app. tsc passes cleanly; rebuild packages so editor picks up fresh types.