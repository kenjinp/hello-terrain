---
# hello-terrain-1h3b
title: Plan next incremental GPU optimization phases
status: completed
type: task
priority: normal
created_at: 2026-06-27T23:59:21Z
updated_at: 2026-06-28T00:01:35Z
---

Create a plan document covering the next terrain optimization phases: dirty work budgeting, LOD churn control, ready/resident slot state separation, compute optimization, and GPU lab metrics.

## Checklist

- [x] Add follow-on optimization roadmap doc.
- [x] Link the roadmap from the spec index.
- [x] Validate markdown/link hygiene.

## Results

- Added `packages/three/spec/incremental-gpu-optimization-roadmap.md`.
- Linked it from `packages/three/spec/README.md`.
- The roadmap covers dirty work budgeting, ready/resident/visible slot states, LOD churn control, compute cost optimization, and GPU lab metrics/assertions.

## Verification

- `git diff --check`
- `beans check`
- `rg -n "[[:blank:]]$" packages/three/spec/incremental-gpu-optimization-roadmap.md .beans/hello-terrain-1h3b--plan-next-incremental-gpu-optimization-phases.md packages/three/spec/README.md`
