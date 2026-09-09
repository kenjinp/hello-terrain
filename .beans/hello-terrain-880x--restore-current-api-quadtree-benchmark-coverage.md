---
# hello-terrain-880x
title: Restore current-API quadtree benchmark coverage
status: todo
type: task
created_at: 2026-09-06T18:47:28Z
updated_at: 2026-09-06T18:47:28Z
---

Committee analysis found packages/three/benchmarks/Quadtree.bench.ts imports removed class-based quadtree modules. Replace decision-relevant workloads with current functional APIs or migrate them into the future terrain gym, and ensure the chosen command is exercised so it cannot silently rot. Do not delete useful coverage without a replacement decision. Follow-up from hello-terrain-p5dj.