---
# hello-terrain-9ai9
title: Unify origin and curved-surface center to prevent GPU/CPU desync
status: todo
type: bug
priority: normal
created_at: 2026-06-21T00:36:57Z
updated_at: 2026-06-21T00:36:57Z
---

Off-origin cube-sphere/torus surfaces require two independent knobs kept in sync: the origin param drives the GPU (uRootOrigin) while the topology config center drives the CPU (projection.center via surfaceOps/tileBounds/raycast). If they disagree, rendered geometry and CPU query/raycast/LOD sit at different world positions. For a curved surface the center IS its origin, so these should be a single source. Options: derive uRootOrigin from projection.center for curved topologies, or feed one origin/center source into both the origin param and projection.center. Follow-up to API cleanup hello-terrain-dcmq.