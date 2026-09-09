---
# hello-terrain-hboy
title: Implement adopted terrain runtime, precision and authoring contracts
status: completed
type: feature
priority: normal
created_at: 2026-09-06T22:47:24Z
updated_at: 2026-09-07T00:24:18Z
---

Implementation authorized by the handoff. Update the proposal with precision and DX committee decisions; refactor existing runtime ownership/config/publication/query/adapters; use pinned math; establish precision diagnostics; update docs/examples; validate unit/type/package and CPU/software WebGPU gym. Preserve existing dirty work. Track actual completed behavior and measured limitations, never claim proposal-only completion.

## Progress
- [x] Update proposal with settled committee contracts and authorization
- [x] Pin and start using the requested CPU math library
- [x] Establish real WebGPU constant-Earth normal diagnostic and repair terrain-owned normal cancellation (L14–L20 max ~0.000011 degrees; baseline up to 28.8 degrees at L17, nonfinite L20)
- [x] Complete runtime/backend ownership, publication, retirement and query refactor
- [x] Complete precision position/source/render integration and measured boundary/transform tests
- [x] Complete React/vanilla and material/managed-source authoring integration
- [x] Update affected specs/docs/examples
- [x] Complete package/unit/type and CPU/software WebGPU validation

Initial runtime and snapshot tests: 9 passed. CPU and software WebGPU flat-edit baseline passed; browser initially required sandbox escalation for local socket/Chromium. No claim of full task completion.


## Completion evidence

Implemented the shared runtime over retained task/compute/topology mechanisms, immutable render/CPU revisions, bounded retained leases, paired copies and GPU-fenced retirement, math tuples/Float64 CPU boundaries, Three bindings/transformed queries, stable React ownership and synchronous child-material publication, direct material context, mapping/detail-normal helpers and dependency-managed sources. Updated the adopted proposal, architecture/data/naming/pattern specs, API guides and plane/sphere/torus/character examples.

Full suites passed: three 92 tests before the final additional binding-publication regression (that focused suite passes both tests), React 5, work 70, gym harness 9 (also included in three's full suite). Final package builds, three/react/gym type checks, React lint and docs typecheck passed. Three lint has zero errors and one pre-existing unused-import warning in tile-bounds.task.ts. Docs production build compiled and generated all 88 static pages using NODE_OPTIONS=--dns-result-order=ipv4first; earlier default DNS font timeouts were environmental and required no app change.

CPU flat-edit/flat-lod/instance-isolation and software WebGPU flat-edit/flat-lod/instance-isolation/earth-precision/material-authoring/sphere-seams/torus-wrap passed. Read summary.md/run.json artifacts. Latest React publication checks: .gym/runs/2026-09-07T00-21-46.632Z-flat-edit-check and 2026-09-07T00-21-53.683Z-instance-isolation-check. Expanded precision/material artifacts are linked in the proposal. Actual constant-Earth normal error <0.000022 degrees through L20; datum residual error 0.12mm; affine rendered depth error 4.93mm and temporal reconfiguration 6.87mm, including raster/mesh effects. One-centimeter diagnostic targets pass, not a universal millimeter promise. Planetary absolute world-position/shadow-receiving and arbitrary TSL source limits remain documented. Hardware GPU/full-frame performance, a streaming engine and a generic public field graph are not claimed.

Preserved the existing dirty checkout. No commit or publish action requested/performed. No remaining external blocker to the authorized runtime implementation.
