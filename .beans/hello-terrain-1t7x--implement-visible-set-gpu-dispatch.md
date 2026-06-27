---
# hello-terrain-1t7x
title: Implement visible-set GPU dispatch
status: completed
type: task
created_at: 2026-06-27T03:18:49Z
updated_at: 2026-06-27T03:30:39Z
---

Implement the next step of the culling-aware incremental plan by making GPU buffers and dispatch use the visibility-derived set instead of the full quadtree candidate set. Backwards compatibility is not required for this slice.

## Checklist

- [x] Read current compute/render/query storage assumptions.
- [x] Change leaf GPU upload and dependent dispatch/readback paths to use visible leaves.
- [x] Preserve telemetry and update summaries if needed.
- [x] Run type/lint/unit checks and real GPU smoke.
- [x] Record results and complete the bean.

## Results

- `@hello-terrain/three` typecheck passed.
- Focused visibility/tile slot cache tests passed.
- `@hello-terrain/three` build passed.
- `@hello-terrain/docs` build and typecheck passed.
- `git diff --check` passed.
- Focused `oxlint` passed.
- Real WebGPU orbit-to-surface smoke passed:
  - Default path: final visible leaves `9418` from `12288` candidates, horizon culled `2870`, terrain dispatch `[14716, 1, 1]`, tile bounds dispatch `[1, 1, 9418]`.
  - `64` tile vertices / `4098` max nodes: final visible leaves `558` from `3075` candidates, horizon culled `2517`, terrain dispatch `[8928, 1, 1]`, tile bounds dispatch `[1, 1, 558]`.
