---
# hello-terrain-knmw
title: Flatten terrain-query facade and improve graph ergonomics
status: todo
type: task
created_at: 2026-06-10T02:13:15Z
updated_at: 2026-06-10T02:13:15Z
---

From the terrainGraph review:

1. query/terrain-query.ts (~98 lines) is a pure pass-through facade over CpuTerrainCache; have the cache satisfy TerrainQuery/TerrainSphereQuery directly.
2. terrainGraph() needs an `as Parameters<typeof g.add>[0]` cast - fix typing in @hello-terrain/work or terrainTasks.
3. Consumers must hand-curate run targets (executeCompute, terrainReadback, gpuSpatialIndexUpload) in packages/react/src/useTerrain.ts; export default run targets from the three package.
4. Dual task-ref discovery paths (terrainTasks map vs individual *Task exports) are used inconsistently; pick one surface.
5. tileBoundsContextTask leaks `& { kernel: unknown }` in its public type.