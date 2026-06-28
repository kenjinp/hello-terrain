---
# hello-terrain-14g4
title: Fix cube-sphere radius frustum culling invalidation
status: completed
type: bug
priority: normal
created_at: 2026-06-28T00:02:59Z
updated_at: 2026-06-28T00:11:11Z
---

Investigate and fix the docs cube-sphere topology example: changing radius causes frustum culling to cull tiles incorrectly, likely because radius/topology-dependent visibility state is not updated or invalidated consistently.

Root cause found: the terrain query cache and visible tile slot cache were keyed
by `projection.kind`, so distinct geometries like `cubeSphere(radius=1000)` and
`cubeSphere(radius=4000)` reused stale CPU/GPU slot state.

- [x] Reproduce/identify stale radius invalidation path
- [x] Add explicit topology/projection cache identity
- [x] Wire query and slot cache shape keys through topology identity
- [x] Add regression coverage for radius/radii/root geometry changes
- [x] Validate focused tests, typecheck, and lint
