---
# hello-terrain-hflw
title: Run orbit-to-surface stress suite and summarize costs
status: completed
type: task
priority: normal
created_at: 2026-06-27T01:24:16Z
updated_at: 2026-06-27T01:29:40Z
---

Run the orbit-to-surface GPU stress harness with 64 vertices per tile
(`innerTileSegments=61`) and a 4098 max tile/node cap. Capture the measured
GPU timings, leaf counts, and the dominant compute passes so we can compare this
configuration against the earlier 20x20 / 16384-node result.

## Checklist

- [x] Run a focused center orbit-to-surface measurement.
- [x] Run the full center/edge/corner orbit-to-surface suite or explain why it is blocked.
- [x] Summarize measured costs and update the bean.

## Result

Command:

```bash
node scripts/run-gpu-agent-lab.js --url http://127.0.0.1:3001/agent-gpu-lab.html --orbit-surface-suite --warmup-frames 4 --measure-frames 24 --no-readback --timeout-ms 10000 --inner-tile-segments 61 --max-nodes 4098 --summary --output /private/tmp/hello-terrain-orbit-64v-4098-24f.json
```

The suite passed. Full output is saved at
`/private/tmp/hello-terrain-orbit-64v-4098-24f.json`.

| Scenario | GPU compute p95 | Mean compute | Leaf count | Max leaf level | Final vertices |
| --- | ---: | ---: | ---: | ---: | ---: |
| center | 9.161 ms | 7.527 ms | 3075 | 10 | 12,595,200 |
| edge | 8.711 ms | 7.170 ms | 3075 | 9 | 12,595,200 |
| corner | 9.432 ms | 7.392 ms | 3075 | 8 | 12,595,200 |

This setting lowers the leaf count versus the 16384-node run, but each tile now
has 4096 vertices. The final scene never reaches level 18 under this cap, so the
configuration reduces subdivision pressure by limiting detail rather than by
making level-18 surface work cheap. The dominant cost remains the two
`terrainField.linearStage*` passes, with `tileBoundsReduction` around 1.1 ms mean.
