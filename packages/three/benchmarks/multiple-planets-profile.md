# Multiple-planets runtime profile

Measured 2026-09-07 against the production docs export. The problem was excessive camera-driven terrain production, not a failure of the work graph's cache implementation.

## Findings

A moved view used to call the full backend production target set. Each terrain selected a candidate resource slot with its own graph, recomputed fields, published that slot's position node, and requested another CPU snapshot. Alternating slot-specific position nodes invalidated Three's material pipeline even when the selected tiles were identical.

The work graph retained compute compilation within individual slots, but the runtime was invoking the wrong amount of work and replacing the rendered node graph unnecessarily. The CPU profile during orbit was dominated among active samples by Three node building/generation and garbage collection. A stationary camera generated no shaders, compute dispatches, or readbacks.

## Controlled comparison

Chromium, Linux x64, SwiftShader WebGPU; 1440 × 1100 viewport, device scale factor 1. Same production scene, radii, mesh resolution, camera path, and sampling instrumentation. No visual quality or precision settings were reduced. The orbit uses 80 mouse positions with a minimum 100 ms interval. Browser/driver stalls make the baseline take longer to complete that path; counts below cover the complete path, not equal wall-clock windows.

The decorative WebGL background's draw calls were suppressed in **both** orbit measurements to isolate the terrain workload. These are whole-page animation-frame timings, not GPU timestamp measurements or predictions for hardware GPUs. One run per condition; small stationary differences are noise, not claimed improvements.

| Orbit metric                   |   Before |   After |
| ------------------------------ | -------: | ------: |
| Mean frame interval            |  76.7 ms | 38.0 ms |
| 95th percentile frame interval | 266.7 ms | 50.1 ms |
| Render pipelines created       |      114 |       0 |
| Shader modules created         |      237 |       0 |
| Compute workgroup dispatches   |      342 |       0 |
| GPU readback mappings          |      228 |       0 |
| Buffers created                |      594 |       0 |

The baseline stationary scene averaged 38.6 ms/frame; suppressing the background averaged 37.5 ms/frame. Suppressing WebGPU draw calls (terrain and the output pass) instead averaged 25.5 ms/frame. Active JavaScript occupied only a small fraction of the stationary capture. This points to a separate rendering/presentation limit in this software environment; the background was not the main source of the orbit stalls. After the fix, normal stationary rendering averaged 39.7 ms/frame.

## Implementation

- A retained CPU work graph evaluates only `quadtreeUpdateTask` for a changed view.
- `quadtreeLeavesTask` caches leaf allocation by capacity instead of allocating inside a camera-invalidated getter.
- Tile identities are compared with the published GPU layout. Matching layout plus matching accepted edit returns `unchanged`, preserving render nodes and query revisions.
- Configuration and content edits bypass this shortcut. Actual LOD changes still run candidate production.
- CPU selection uses its own graph so the published graph's spatial index remains paired with its GPU fields, including deferred readback.
- An explicit conservative bounds provider takes precedence over cached readback bounds, so selection and candidate graphs make consistent decisions.

This retains the graph-based architecture and the existing atomic publication/precision contracts. It does not introduce a frame-rate cap or reduce terrain quality.

## Validation and reproduction

Runtime regressions cover unchanged selection, required production, source/config edits, and superseded asynchronous selection. The graph regression verifies that a selection run reuses its leaf allocation and never evaluates GPU upload, compute compilation/execution, or position-node targets. GPU `flat-edit`, `flat-lod`, and `instance-isolation` scenarios passed without loosening tolerances.

Build and serve the production docs, then run from the repository root:

```sh
node scripts/profile-runtime-examples.mjs http://127.0.0.1:3101 .gym/runs/planet-profile-after
```

The profiler saves Chrome-loadable `.cpuprofile` files, GPU API counters, frame statistics, and environment metadata. Baseline and after captures for this investigation are in `.gym/runs/planet-profile-before/` and `.gym/runs/planet-profile-after/`.

## Remaining costs

### Near-planet investigation

A subsequent capture following the skirt fix focuses Pelagos and applies 18 inward wheel steps, then measures the settled view. Reproduce with the same command plus `--approach`. Raw output: `.gym/runs/planet-approach-investigation/`.

| Condition | Mean frame interval | Render pipelines created | Readback mappings |
| --- | ---: | ---: | ---: |
| Whole system, stationary | 39.6 ms | 0 | 0 |
| Focus and approach | 47.3 ms | 4 | 8 |
| Closer view, stationary | 52.3 ms | 0 | 0 |
| Closer view, WebGPU draws suppressed | 25.7 ms | 0 | 0 |

The settled closer view also has zero shader creation and compute dispatches. Thus continuous production is not necessary for the observed closer-view slowdown in this environment. Suppressing WebGPU draws points toward rendering/presentation cost; this ablation suppresses the output pass too, so it does not isolate terrain shading alone. The demo uses standard lighting, antialiasing, and logarithmic fragment depth. More screen coverage and changed geometry can increase rendering cost, but these individual factors have not yet been isolated.

These are Chromium SwiftShader measurements, not Firefox measurements. Firefox is unavailable in this workspace. They cannot establish the cause or magnitude of the reported browser difference. A hardware Firefox capture, browser version, adapter details, and whether the slowdown persists after movement stops are needed to distinguish shader execution, compilation stalls, and backend/presentation costs. No quality or precision settings were changed on the basis of this capture.

True layout changes still switch candidate resources and can incur material pipeline work. A further optimization would preserve render binding identities across compatible resource publications, while retaining the last-good-publication and retirement guarantees. That needs separate profiling around actual LOD transitions.

If the scene remains slow while stationary on hardware, profile that device's draw/pixel cost next. Pixel ratio or shading quality controls are potential tradeoffs, but this investigation does not justify silently reducing quality or replacing the precision-preserving position path.
