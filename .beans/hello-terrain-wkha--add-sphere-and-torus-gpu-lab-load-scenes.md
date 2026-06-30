---
# hello-terrain-wkha
title: Add sphere and torus GPU lab load scenes
status: completed
type: task
priority: normal
created_at: 2026-06-26T21:42:08Z
updated_at: 2026-06-26T21:49:14Z
---

Add cube-sphere and torus scenarios to the agent GPU lab so the headless runner can stress real WebGPU tasks with earth-scale radius and maxLevel 18.

## Checklist
- [x] Inspect topology params and scenario/result assumptions
- [x] Add sphere and torus scenario definitions with earth radius and maxLevel 18
- [x] Update sampling/result logic for closed-surface queries
- [x] Verify typecheck/lint and run real GPU lab scenarios

## Verification
- `./node_modules/.bin/tsc -p apps/docs/tsconfig.json --noEmit`
- `./node_modules/.bin/oxlint apps/docs/src/components/GpuAgentLab/GpuAgentLab.tsx scripts/run-gpu-agent-lab.js`
- `node scripts/run-gpu-agent-lab.js --scenario earth-sphere-load --warmup-frames 1 --measure-frames 1 --timeout-ms 15000`
  - `leafCount=3072`, `maxLevel=18`, `radius=6371000`, `computeMs=1.275282`, readback NaNs: 0
- `node scripts/run-gpu-agent-lab.js --scenario earth-torus-load --warmup-frames 1 --measure-frames 1 --timeout-ms 15000`
  - `leafCount=3072`, `maxLevel=18`, `radius=6371000`, `computeMs=1.499534`, readback NaNs: 0
