---
# hello-terrain-g7gb
title: Specify end-to-end planetary precision contract
status: completed
type: task
priority: normal
created_at: 2026-09-06T20:28:22Z
updated_at: 2026-09-06T20:52:01Z
---

Committee analysis completed with Claude Opus 5 (aa3e78ba-1527-4eb9-a02a-7d41f08c8e97) and GPT-6 Astra (123b120a-a47e-40f0-b9e3-b33e5782fabe), independent reviews followed by reconciliation.

Consensus:
- Preserve ordinary TSL; keep existing worldPosition semantics. Separate stable source coordinates from render coordinates; optional fixed regional/chart source inputs support fine detail without custom arithmetic nodes.
- Reject general transparent TSL precision rewriting as the default. Arbitrary callbacks cannot be guaranteed smooth, accurate, or alias-free; normalized global coordinates do not add precision bits.
- Establish CPU f64 curved-datum reference with accepted math package, then benchmark stable GPU local-residual projection. Subtract anchors before f32 rounding. Use local normal differences and pass elevation directly to materials.
- Define a finite tested precision envelope, separate numerical/source/packing/mesh/depth errors, source identity across rebasing/LOD/resource remapping, explicit seam and CPU/GPU reconstruction tolerances.
- Initial blocking diagnostic: constant-elevation Earth terrain on actual WebGPU, comparing analytic normals, current normals, unlit/wireframe, float32 reference storage, direct elevation coloring, diagonal choices, mixed LOD and all face boundaries. Test translations, rotations/scales, camera movement, shadow cast/receive and secondary passes.
- Three integration must preserve consistent coordinate semantics for world-dependent materials and lighting. Main-camera model-view adjustment alone is insufficient.
- Production datum generation, packing format, chart composition scope and numeric envelope remain experiments, not guarantees already achieved.

Evidence: code paths confirmed absolute f32 sphere assembly and normal differencing, checkerboard diagonals, radial elevation reconstruction in Earth coloring and raw f32 CPU versus normalized f16 GPU representations. Claude numerical simulations suggest growing zero-elevation normal error with LOD; neither reviewer reproduced visual artifacts on GPU. Sampled seam agreement is not general proof; full warped noise error remains unmeasured. Translation-only rebasing does not alter normal matrices.

This completed task specifies the review consensus, not implementation. Runtime proposal/code were not updated during committee analysis. Implementation and formal proposal adoption require follow-up.