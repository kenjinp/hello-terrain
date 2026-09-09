---
# hello-terrain-yhje
title: Profile and improve multiple-planets frame rate
status: completed
type: bug
priority: normal
created_at: 2026-09-07T01:58:13Z
updated_at: 2026-09-07T02:17:39Z
---

Profiled the production multiple-planets scene with Chrome CPU sampling, GPU API counters and background/terrain-draw ablations. Root cause: every moved view triggered full candidate production and alternate graph position-node publication, rebuilding material pipelines and readbacks despite unchanged tiles. Implemented a retained CPU selection graph, capacity-cached quadtree leaf allocation, unchanged-layout publication reuse and consistent explicit conservative bounds. Supersession/edit correctness preserved; published CPU graph records stay paired with GPU buffers. Matched software-WebGPU orbit before/after: mean 76.7 to 38.0 ms; p95 266.7 to 50.1 ms; render pipelines 114 to 0; shader modules 237 to 0; compute dispatches 342 to 0; readback mappings 228 to 0. Stationary performance unchanged. Validation: 96 three tests, 5 React tests, typecheck and docs production build passed; GPU flat-edit/flat-lod/instance-isolation passed; showcase browser smoke passed. Report: packages/three/benchmarks/multiple-planets-profile.md. Profiler: scripts/profile-runtime-examples.mjs. Raw captures: .gym/runs/planet-profile-before and planet-profile-after. Follow-up hello-terrain-hgti tracks true-LOD pipeline retention. Preview on port 3101.