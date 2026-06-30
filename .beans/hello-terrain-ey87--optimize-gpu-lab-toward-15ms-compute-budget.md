---
# hello-terrain-ey87
title: Optimize GPU lab toward 1.5ms compute budget
status: completed
type: task
priority: normal
created_at: 2026-06-26T22:29:04Z
updated_at: 2026-06-26T22:44:50Z
---

Use the agent GPU lab load scenarios to reduce real WebGPU compute timestamp time toward a 1.5ms budget. Implemented linear staged dispatch for terrain compute, added per-pass GPU timing plus executable compute-budget assertions to the lab, and verified the 4096-node earth load and surface-camera budget runs on real WebGPU.

## Checklist
- [x] Establish baseline and identify which compute work dominates
- [x] Inspect compute pipeline/task implementation for low-risk optimization
- [x] Implement focused optimization
- [x] Verify typecheck/lint and real GPU lab timing

## Results
- 16384-node sphere surface stress dropped to roughly 4.15-5.73ms after linear dispatch, but still cannot meet 1.5ms without reducing workload/fidelity.
- 4096-node earth-sphere-load max compute sample: 1.285438ms.
- 4096-node earth-torus-load max compute sample: 1.274979ms.
- 4096-node earth-sphere-surface-load with --budget-ms 1.5 max compute sample: 1.195691ms.
- 4096-node earth-torus-surface-load with --budget-ms 1.5 max compute sample: 1.290418ms.