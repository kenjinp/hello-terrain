# Terrain pipeline optimization results

**Complete serial pipeline latency is 6.6–6.9 ms in these workloads, a 45–55% reduction.**
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
| 13 / LOD | 12.60 to 6.90 ms | 45.2% | 14.50 to 7.80 ms | 9.30 to 3.46 ms |
| 13 / edit | 12.10 to 6.70 ms | 44.6% | 13.70 to 7.90 ms | 9.11 to 3.41 ms |
| 61 / LOD | 15.20 to 6.80 ms | 55.3% | 17.00 to 8.70 ms | 11.66 to 3.51 ms |
| 61 / edit | 14.80 to 6.60 ms | 55.4% | 16.00 to 7.80 ms | 11.34 to 3.56 ms |

Wall latency starts before the actual configuration/view update and includes
production compute, coherent default CPU readback/publication, terrain render,
and queue completion. GPU envelope timestamps span the first compute pass to the
last terrain draw across real submissions. This includes idle gaps between
submissions, and is **not summed GPU busy time**. Diagnostic timestamp and pixel
readback are outside the measured interval. No CPU/GPU times are added together.

These are a fresh controlled comparison from November 7, including the allocation
dispatch-batching and stable-presentation follow-ups. They supersede earlier comparisons; do not
compare candidate results across the two sessions without their matched baselines.

## Separate scheduling comparison

The optional `publication-retirement-fence` mode submits the draw synchronously
at publication, overlaps it with normal query readback, and reuses the runtime's
real post-draw queue fence. It still waits for both draw completion and matching
fresh queries. The original baseline and candidate used the same mode and the same
three-block/sample conditions above. These results are not pooled with serial runs.

| Segments / workload | Full wall median, baseline to candidate | Reduction | Candidate p95 / p99 |
| --- | --- | --- | --- |
| 13 / LOD | 9.50 to 3.70 ms | 61.1% | 4.60 / 4.80 ms |
| 13 / edit | 9.50 to 3.70 ms | 61.1% | 4.40 / 4.70 ms |
| 61 / LOD | 11.70 to 3.70 ms | 68.4% | 4.70 / 5.00 ms |
| 61 / edit | 11.60 to 3.50 ms | 69.8% | 4.40 / 4.60 ms |

All 294 additional matched samples had identical pixel/geometry checks; all 588
baseline/candidate samples recorded a valid post-draw fence. Draw submission
returned at roughly 0.4–0.6 ms, while the recorded fence took another 2.6–2.9 ms
(medians across measured samples). Full latency remains above 2 ms.

The 0.22–0.27 ms compute-to-draw GPU envelope excludes possible later query
completion and is not the full pipeline. A separate exploratory check with
installed Edge 157 also remained at 3.6–4.2 ms full-wall medians; it is not included
in the controlled Chrome comparison. See [scheduling results](pipeline-overlap-results.json).

## Changes and iteration

1. Start coherent snapshot acquisition while previous publication retirement is
   pending, but gate CPU publication on successful retirement. Drain both paths
   on failure and retain serialized updates and disposal behavior.
2. Batch elevation and bounds copies into a pooled staging buffer and one map.
   Respect device allocation limits, falling back to independently mapped buffers
   when the active payload cannot fit one allocation.
3. Store only active elevation samples in independent CPU snapshots. Lazily
   expand to full capacity if a captured cache is later used for readback.
   Clear only previously written stale tails, tracking physical arrays across swaps.
4. Submit default elevation, bounds, and terrain-field kernels as three ordered
   dispatches in one compute pass/submission. No shader fusion. Custom pipeline
   callbacks retain their existing execution path.
5. Keep draw buffers, terrain texture, uniforms and position nodes stable across
   compatible LOD/elevation updates. Copy accepted candidate data into presentation
   resources in queue order. Structural changes rebuild resources; custom precision
   hooks without transactional preparation retain the original path.

These target synchronization and CPU transfer overhead rather than terrain shader
quality. A separate diagnostic run on the previous PR commit `ea255916` observed one
shader-node-builder rebuild per measured publication (2.1–2.5 ms CPU), 3.0–3.4 ms
readback mapping waits, and 2.8–3.4 ms final queue-completion waits. Actual compute
passes totalled roughly 0.008–0.016 ms and render passes 0.003–0.029 ms. These
extra-instrumented runs diagnose costs; they are not substituted into the
controlled comparison, and overlapping stage times must not be added together.

Stable presentation resources now avoid changing the bound position-node identity
for compatible updates, covered by unit tests and the full GPU scenarios. A separate
shader-builder-count probe was blocked by the local unsigned-script policy and was
not run, so no measured post-change rebuild count is claimed. Browser scheduling
and readback latency remain part of the measured complete path.

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
  need separate measurements. Complete serial latency remains above 2 ms; reductions vary by workload.

The earlier pmndrs/labs 0.12.0 investigation (commit
`d7157ac128a6321e20429d70bbd0ac7c8432ebda`) used its real `bench.gpu` and `timedPass`
APIs for batched isolated pass replay. Those amortized GPU-only timings cannot
represent complete pipeline latency. This complete-path harness instead instruments
actual submissions directly and does not claim to be a labs replay measurement.

See [reproduction instructions](PIPELINE-BENCHMARK.md) and
[compact numeric results](pipeline-results.json). The runner writes raw samples,
build-script hashes, adapter/browser metadata, failures, and summaries locally.
