---
# hello-terrain-fr6q
title: Compile DAG after deps discovery
status: completed
type: task
priority: normal
created_at: 2026-02-01T14:29:02Z
updated_at: 2026-02-01T14:30:50Z
---

Fix graph.run so it compiles topo at end of runs when implicit deps discovery (or dep-set change) bumps structureVersion. This avoids requiring a second run just to stabilize compiledVersion/compileCount.

## Checklist
- [x] Update fallback path to compile after deps discovery
- [x] Compile after scheduler path if structureVersion changed
- [x] Update tests (no second run needed)
- [x] Run work tests