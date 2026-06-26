---
# hello-terrain-u1yu
title: Investigate level-18 reachability in surface load tests
status: todo
type: task
created_at: 2026-06-26T22:03:09Z
updated_at: 2026-06-26T22:03:09Z
---

Surface-camera GPU lab scenarios increased load but did not produce active level-18 leaves: sphere reached level 16 and torus reached level 17 with maxNodes=16384. Investigate whether this is expected from 2:1 balancing/refinement frontier shape, whether the stress scenario should use a more focused camera/update heuristic, or whether higher maxNodes/different distance factors are needed.