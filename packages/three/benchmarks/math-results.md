# pmndrs/math allocation results

The core package already pins `math@1.0.0-canary-37519dcd-20260903`, whose package metadata points to https://github.com/pmndrs/math. This change uses its output-first API more effectively, without a new dependency or a library/version migration. `maath` remains a separate docs dependency.

## Accepted changes

- Datum anchors copy the face basis into the supplied output and read the existing basis vectors, eliminating two temporary basis arrays and a spread call per anchor.
- Flat, sphere and torus normals normalize their newly owned return tuple in place, eliminating one temporary vector per normal. Returned vectors remain independent.
- Runtime raycasts allocate one difference vector per ray rather than one per sampled step. Scratch remains call-local, including across nested or concurrent terrain instances.
- Cross-face topology lookup reuses its existing instance-owned cube tuple with `vec3.set`, preserving the exact `Math.hypot` and division arithmetic.
- Three.js stays at public integration boundaries. Shader math, geometry resolution, node budgets, sample rates and public APIs are unchanged. No module-scope scratch was introduced.

## Controlled CPU comparison

Base: `3143221` (PR #31). AMD Ryzen 9 9950X3D, Node 24.3.0, Kenbox WSL. Three fresh processes per side, interleaved baseline/candidate/candidate/baseline/baseline/candidate. Each workload warms up for one full batch and then records nine batches. Reported values are the median of the three process medians. Raw batch values are in `math-results.json`.

| CPU workload | Baseline | Candidate | Change |
| --- | ---: | ---: | ---: |
| Datum anchor | 78.04 ns | 15.43 ns | 80.2% lower |
| 256-step raycast, synthetic flat snapshot | 3.117 µs | 2.762 µs | 11.4% lower |
| Cube-sphere tile bounds (unchanged arithmetic/control) | 114.57 ns | 112.52 ns | 1.8% lower; do not attribute to this change |
| Complete capacity-limited Earth LOD selection | 0.7542 ms | 0.7489 ms | 0.7% lower; no demonstrated improvement |

Selection process medians overlap: baseline 0.7344–0.7647 ms, candidate 0.7468–0.7509 ms. Allocation removal is not automatically a frame-rate win. These are CPU throughput workloads, not end-to-end render latency, GC-pause measurements, browser measurements, or GPU timing. The raycast backend uses a synthetic published flat snapshot to isolate runtime marching; it is not the full terrain-cache query path. V8 optimization and benchmark ordering affect absolute nanosecond values. Initial exploratory figures are superseded by this corrected interleaved comparison.

## Rejected experiment and fidelity

Replacing bounded cube normalization with `vec3.normalize` made tile bounds faster, but sqrt/reciprocal rounding changed capacity-priority ties and therefore some LOD leaf selections. That change was reverted rather than relaxing the oracle. The accepted implementation retains `Math.hypot` and division in topology bounds and edge mapping; arbitrary world-coordinate lengths also retain their existing behavior.

The baseline/candidate differential checker covers radii 1, 1,000 and 6,371,007.1809, six faces and levels 0–14: 4,860 bounds (maximum absolute difference **0**), 9,720 neighbor mappings and 27 complete moving-camera LOD layouts match. Datum regression tests compare the previous algorithm exactly and verify shared basis ownership. Raycast regression tests cover hit/incomplete behavior, output independence and instance isolation.

## Reproduce

Prepare both checkouts using the same lockfile and Node version. From the candidate repository:

```sh
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm --filter './packages/*' run build
pnpm --filter @hello-terrain/gym exec tsx ../../scripts/bench-math.ts /absolute/path/to/baseline
pnpm --filter @hello-terrain/gym exec tsx ../../scripts/bench-math.ts /absolute/path/to/candidate
pnpm --filter @hello-terrain/gym exec tsx ../../scripts/check-math-equivalence.ts /absolute/path/to/baseline /absolute/path/to/candidate
```

Use fresh processes and the interleaving above. Do not run competing benchmarks concurrently. No API documentation update is needed because public APIs are unchanged.

## Final validation

- Workspace package builds, full tests and full typecheck passed. Fresh checkout typecheck required generating docs MDX and Next.js route types first (`pnpm --filter @hello-terrain/docs postinstall` and `pnpm --filter @hello-terrain/docs exec next typegen`).
- Lint passed with nine pre-existing warnings, zero errors.
- CPU gym: flat-edit, flat-lod and instance-isolation passed.
- All nine production browser gym scenarios passed on Chromium SwiftShader software WebGPU, including sphere seams, torus wrap, Earth precision, skirts and materials. See `math-validation.json`. These are correctness checks, not hardware performance measurements.
- Independent review found no blocking correctness issues. Hardware-browser timing and an overall frame-rate improvement are not established by this PR.
