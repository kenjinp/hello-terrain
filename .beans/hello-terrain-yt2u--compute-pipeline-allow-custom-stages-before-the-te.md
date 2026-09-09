---
# hello-terrain-yt2u
title: 'Compute pipeline: allow custom stages before the terrain-field pack'
status: todo
type: task
priority: normal
tags:
    - compute
    - api
created_at: 2026-09-04T19:18:49Z
updated_at: 2026-09-04T19:18:49Z
---

terrainFieldStageTask hard-codes get(elevationFieldStageTask) as its upstream, so a user stage that modifies elevation (erosion, terracing) cannot be inserted between the elevation stage and the pack stage without re-implementing the pack. Also terrainGraph() always registers compileCompute/executeCompute, so a custom pipeline has to build the graph manually to avoid two pipelines writing the same elevation buffer. Surfaced by Bugbot on PR #25 (docs). Proposal: make the pack stage's upstream injectable (e.g. createTerrainFieldStageTask(upstream) + default), and/or terrainGraph({ computeLeafStage }) so the default execute is swapped rather than duplicated.