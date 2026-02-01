---
# hello-terrain-2i0a
title: Compile DAG and add graph.inspect()
status: completed
type: task
priority: normal
created_at: 2026-02-01T14:16:42Z
updated_at: 2026-02-01T14:26:16Z
---

Implement cached dependency DAG for graph.run so we avoid recursive dirty checks and rebuilding scheduling state each run; rebuild/toposort only when dependency sets change. Add graph.inspect() for visualization.

## Checklist
- [x] Add cached DAG structures + structureVersion/compiledVersion
- [x] Replace recursive dirty checks with forward propagation from changed nodes
- [x] Implement (and cache) topo order rebuild only when structureVersion changes
- [x] Update run() to use cached closure+pendingDepsCount over required/dirty tasks
- [x] Add graph.inspect() to export nodes/edges (+ optional runtime)
- [x] Add tests for no-rebuild on value changes, rebuild on dep-set changes, and inspect() output
- [x] Run work package tests