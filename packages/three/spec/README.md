# Hello Terrain Specs

This folder is the canonical architecture/spec reference for `@hello-terrain/three` and related docs integration.

## Documents

- [`architecture.md`](./architecture.md): system layers, responsibilities, and data flow.
- [`terrain-data-model.md`](./terrain-data-model.md): canonical runtime entities, ownership boundaries, and snapshot contracts.
- [`incremental-gpu-updates.md`](./incremental-gpu-updates.md): plan for culling-aware persistent tile slots, dirty-visible compute, and incremental GPU field updates.
- [`naming-conventions.md`](./naming-conventions.md): naming rules for APIs, tasks, fields, maps, and buffers.
- [`concepts.md`](./concepts.md): core domain concepts used across code and docs.
- [`patterns.md`](./patterns.md): recurring task-graph implementation patterns and pitfalls.

## Intent

- Keep API and internal terminology consistent.
- Make design decisions explicit before/while implementing.
- Give contributors and agents a stable source of truth.
