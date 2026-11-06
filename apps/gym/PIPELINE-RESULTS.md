# Terrain pipeline optimization results

**The complete pipeline is not under 2 ms. The original 50% reduction target is also unmet.**
This draft improves measured complete latency without reducing terrain resolution,
turning off default CPU queries, changing shaders, or omitting the terrain draw.

## Controlled comparison

Baseline: `b4fde40f192f40aa653aef2abdbfe8b650330104`.
NVIDIA GeForce RTX 4090, Windows Chrome 156.0.8078.80, WSL-served production build,
640 x 480, default on-change readback, maxNodes 1024. Two tile resolutions (13 and
61 segments) and separate moving-camera LOD and elevation-edit workloads.
LOD alternates 1 and 67 tiles; edits change the analytic elevation callback.

Three fresh Chrome processes per side were interleaved in order baseline,
candidate, candidate, baseline, baseline, candidate. Each resolution/context has
four warmups per workload, then 20 measured samples per workload. Cold startup is
recorded separately. Values below are medians of the three block medians; p95 is
the median of the three block p95 values, not a pooled percentile.

| Segments / workload | Wall median, baseline to candidate | Reduction | Wall p95 | GPU envelope median |
| --- | --- | --- | --- | --- |
| 13 / LOD | 14.60 to 10.90 ms | 25.3% | 16.10 to 12.60 ms | 10.73 to 7.02 ms |
| 13 / edit | 13.50 to 10.40 ms | 23.0% | 15.80 to 11.80 ms | 10.53 to 7.03 ms |
| 61 / LOD | 16.90 to 12.20 ms | 27.8% | 18.90 to 13.50 ms | 12.77 to 8.13 ms |
| 61 / edit | 16.80 to 12.00 ms | 28.6% | 18.40 to 13.20 ms | 13.05 to 8.57 ms |

Wall latency starts before the actual configuration/view update and includes
production compute, coherent default CPU readback/publication, terrain render,
and queue completion. GPU envelope timestamps span the first compute pass to the
last terrain draw across real submissions. This includes idle gaps between
submissions, and is **not summed GPU busy time**. Diagnostic timestamp and pixel
readback are outside the measured interval. No CPU/GPU times are added together.

A final single-block verification after adding the allocation-limit compatibility
fallback measured wall medians of 10.30/10.30 ms (13-segment LOD/edit) and
12.10/12.70 ms (61-segment LOD/edit), with all fidelity assertions passing. Its
p99 values also fail the 2 ms budget. This run is not substituted into the
interleaved comparison.

## Changes and iteration

1. Start coherent snapshot acquisition while previous publication retirement is
   pending, but gate CPU publication on successful retirement. Drain both paths
   on failure and retain serialized updates and disposal behavior.
2. Batch elevation and bounds copies into a pooled staging buffer and one map.
   Respect device allocation limits, falling back to independently mapped buffers
   when the active payload cannot fit one allocation.
3. Copy only active prefixes into independent, full-capacity CPU snapshots.
   Preserve capacity, zero tails, retention, and later supported readback.

These target synchronization and CPU transfer overhead rather than terrain shader
quality. Further gains require investigation of the remaining complete-path
latency; the evidence does not establish a particular unmeasured bottleneck.

## Correctness and scope

- All 294 matched baseline/candidate samples (including warmup/cold) had identical
  pixel checksums, tile/geometry counts, rendered instances, and leaf layouts.
  Analytic query and matching publication-revision checks passed.
- Final hardware gym run: all nine scenarios passed, 4,546 assertions, including
  flat edits/LOD/nearest, isolation, sphere seams, torus wrap, skirts, materials,
  and Earth precision.
- Full workspace tests and typecheck passed. Lint passed with nine existing
  warnings and no errors. New tests cover lifecycle failure ordering, batching,
  limits, map failures, disposal, and independent snapshot copying.
- Pixel checksums and scenario assertions are bounded regression evidence, not
  proof of visual equivalence for every application. The timed scene uses a
  diagnostic normal material; UI, shadows, postprocessing, and arbitrary custom
  materials are not part of this workload. Higher resolutions and other adapters
  need separate measurements. Neither the 2 ms nor 50% target is claimed.

The earlier pmndrs/labs 0.12.0 investigation (commit
`d7157ac128a6321e20429d70bbd0ac7c8432ebda`) used its real `bench.gpu` and `timedPass`
APIs for batched isolated pass replay. Those amortized GPU-only timings cannot
represent complete pipeline latency. This complete-path harness instead instruments
actual submissions directly and does not claim to be a labs replay measurement.

See [reproduction instructions](PIPELINE-BENCHMARK.md) and
[compact numeric results](pipeline-results.json). The runner writes raw samples,
build-script hashes, adapter/browser metadata, failures, and summaries locally.
