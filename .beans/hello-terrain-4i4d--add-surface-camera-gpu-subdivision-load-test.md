---
# hello-terrain-4i4d
title: Add surface-camera GPU subdivision load test
status: completed
type: task
priority: normal
created_at: 2026-06-26T21:54:51Z
updated_at: 2026-06-26T22:03:15Z
---

Add and run GPU lab variants with the camera placed at the curved surface datum to encourage maximum quadtree subdivision.

## Checklist
- [x] Add surface-camera sphere and torus scenario variants
- [x] Update runner discoverability
- [x] Run typecheck/lint
- [x] Execute real WebGPU surface-camera load scenarios and record results

## Verification
- `./node_modules/.bin/tsc -p apps/docs/tsconfig.json --noEmit`
- `./node_modules/.bin/oxlint apps/docs/src/components/GpuAgentLab/GpuAgentLab.tsx scripts/run-gpu-agent-lab.js`
- `node scripts/run-gpu-agent-lab.js --scenario earth-sphere-surface-load --warmup-frames 1 --measure-frames 1 --timeout-ms 25000 --no-readback`
  - `leafCount=12288`, `leafCapacity=16384`, active level range `0..16`, `leavesAtMaxLevel=0`, `computeMs=5.038525`
- `node scripts/run-gpu-agent-lab.js --scenario earth-torus-surface-load --warmup-frames 1 --measure-frames 1 --timeout-ms 30000 --no-readback`
  - `leafCount=12288`, `leafCapacity=16384`, active level range `1..17`, `leavesAtMaxLevel=0`, `computeMs=5.017319`

Note: with `maxNodes=4096`, both surface-camera scenarios plateaued at `leafCount=3072`.
Raising the surface-camera variants to `maxNodes=16384` increased load but still did not reach
`maxLevel=18`; the active frontier appears to consume budget before level-18 leaves appear.
