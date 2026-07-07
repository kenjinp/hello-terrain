# Hello Terrain Specs

This folder is the canonical architecture/spec reference for `@hello-terrain/three` and related docs integration.

## Documents

- [`architecture.md`](./architecture.md): system layers, responsibilities, and data flow.
- [`architecture-simplification.md`](./architecture-simplification.md): plan to give each tile one authoritative home (TileTable), staged LOD commits, opt-in readback via paired CPU elevation, and an `update()`-shaped public API.
- [`terrain-data-model.md`](./terrain-data-model.md): canonical runtime entities, ownership boundaries, and snapshot contracts.
- [`incremental-gpu-updates.md`](./incremental-gpu-updates.md): plan for culling-aware persistent tile slots, render visibility vs data residency, dirty-resident compute, and incremental GPU field updates.
- [`incremental-gpu-optimization-roadmap.md`](./incremental-gpu-optimization-roadmap.md): follow-on plan for dirty work budgeting, ready slot states, LOD churn control, compute optimization, and GPU lab metrics.
- [`heightmap-precision.md`](./heightmap-precision.md): the decode-before-filter invariant, `createHeightmapField` design rationale, and how to diagnose platform-dependent terracing.
- [`naming-conventions.md`](./naming-conventions.md): naming rules for APIs, tasks, fields, maps, and buffers.
- [`concepts.md`](./concepts.md): core domain concepts used across code and docs.
- [`patterns.md`](./patterns.md): recurring task-graph implementation patterns and pitfalls.

## Intent

- Keep API and internal terminology consistent.
- Make design decisions explicit before/while implementing.
- Give contributors and agents a stable source of truth.
