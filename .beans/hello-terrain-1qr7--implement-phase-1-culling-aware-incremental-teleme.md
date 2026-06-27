---
# hello-terrain-1qr7
title: Implement phase 1 culling-aware incremental telemetry
status: completed
type: task
priority: normal
created_at: 2026-06-27T03:05:04Z
updated_at: 2026-06-27T03:14:31Z
---

Implement the first slice of the culling-aware incremental GPU update plan:
CPU-side visibility estimation and persistent tile slot telemetry for the GPU
lab, without changing render or compute dispatch behavior.

## Checklist

- [x] Locate quadtree, topology, and GPU lab result plumbing.
- [x] Add conservative visibility and slot reuse telemetry.
- [x] Expose the telemetry in GPU lab outputs and CLI summaries.
- [x] Run focused type/lint checks and at least one GPU lab smoke if feasible.
- [x] Update bean with results and complete it.

## Results

Implemented:

- `computeTileVisibility` for telemetry-only conservative visibility estimates.
- `updateTileSlotCache` for stable tile-key to slot reuse/dirty telemetry.
- `tileVisibilityTask` and `tileSlotUpdateTask` in the terrain graph.
- GPU agent lab frame/final telemetry fields and CLI `--summary` output.

Validation:

- `CI=true pnpm --filter @hello-terrain/three run typecheck`
- `CI=true pnpm --filter @hello-terrain/docs run typecheck`
- `CI=true pnpm --filter @hello-terrain/three exec vitest run src/quadtree/visibility.test.ts src/quadtree/tileSlotCache.test.ts`
- `CI=true pnpm exec oxlint ...`
- `CI=true pnpm --filter @hello-terrain/three run build`
- `CI=true pnpm --filter @hello-terrain/docs run build`
- `git diff --check`

GPU smoke:

- Orbit-to-surface center, 2 warmup / 4 measured frames:
  final `candidateCount=12288`, `visibleCount=9418`,
  `horizonCulledCount=2870`, `dirtyVisibleCount=8770`,
  `reuseRatio=0.0688`.
- Surface-load steady camera, 3 warmup / 6 measured frames:
  final `candidateCount=12288`, `visibleCount=12288`,
  `dirtyVisibleCount=0`, `reuseRatio=1`.

The steady run confirms the cache telemetry can identify clean reused tiles. The
zoom run confirms horizon culling telemetry appears during the real WebGPU path,
though render/compute still intentionally dispatch over the existing full leaf
set in this phase.
