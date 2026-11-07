# Complete terrain pipeline benchmark

This runner measures the production vanilla Three terrain runtime and binding,
using the source imported by the gym build. It requires an already-running
**production build** with `window.runPipelineBench`. It never builds, installs a
browser, alters the runtime, or starts/stops your server.

## Run

Use Node 24 (the project's installed runtime) and the existing Playwright package:

```sh
node apps/gym/pipeline-runner.mjs \
  --url http://127.0.0.1:4173 \
  --out .gym/runs/pipeline-baseline-2026-11-06 \
  --label baseline --blocks 3 --samples 20 --warmup 4 --segments both
```

The output directory must not already exist. Every report is created exclusively.
Use a new directory for each baseline, candidate, or repeat.

Options:
- `--executable PATH`: existing Chromium/Chrome/Edge executable.
- `--width 640 --height 480`: render resolution. Use `1920` / `1080` for a
  separate workload, not a directly comparable result.
- `--segments 13|61|both`: tile resolution; default is both.
- `--blocks 3 --samples 20 --warmup 4`: independent browser contexts per workload
  and block; each context warms LOD and editing separately.
- `--source-hash HASH`: optional externally verified build/source identity.
- `--browser-arg=FLAG`: repeat for explicitly chosen browser GPU settings.
- `--timeout-ms 180000`: explicit per-context evaluation deadline; timeout closes
  the context and records a harness error.
- `--headed`: visible browser. Default is headless.
- `--help`: print usage without loading Playwright or opening a browser.

Default launch adds `--enable-unsafe-webgpu`. It does not force a graphics backend.
Record and keep launch flags and browser executable/version identical across
comparisons. Do not compare software-rendered and hardware-rendered runs.

### Windows with a WSL checkout

Run the script with Windows Node and an existing Windows browser. If the checkout's
pnpm symlinks do not resolve on Windows, point to an **already installed**
`playwright` or `playwright-core` package directory or entry:

```powershell
$env:TERRAIN_PLAYWRIGHT_MODULE = 'C:\path\to\existing\playwright-core'
node .\apps\gym\pipeline-runner.mjs --url http://127.0.0.1:4173 --executable 'C:\path\to\chrome.exe' --out C:\benchmarks\pipeline-baseline
```

The environment variable must be an absolute path. No package/browser installation
is attempted. Host CPU/OS, browser version, launch options, navigator properties,
GPU adapter information (when exposed), served script SHA-256 hashes, and a local
checkout commit (when accessible) are recorded. A local checkout commit is **not**
proof of what the server is serving. Use served script hashes and a frozen build
source manifest to establish baseline/candidate provenance.

## Workload and timing contract

The bounded fixture is a 1024-unit flat analytic terrain:
`elevation = 0.03*x + 0.02*z + offset`, with offsets 2 and 5, maxNodes 1024,
maxLevel 8, distance LOD factor 1.5, skirtScale 20, and tile segments 13 or 61.
It retains linear rgba16float field sampling and the normal on-change CPU query
readback. The material displays geometric normals. It does not include application
UI, shadow maps, unrelated scene objects, or postprocessing. These results are
not a claim about all terrain configurations or a full application's frame time.

Each context records:
1. **Cold**: first production/render, separately from all warm distributions.
2. **LOD warmup and measured**: alternating near/far camera positions that must
   change selected tile identities and produce new geometry.
3. **Edit warmup and measured**: alternating accepted elevation callbacks at a
   stationary camera, with actual production and current CPU query publication.

Four default warmup samples exercise alternating candidate resources and inputs.
Warmup sufficiency should still be checked against raw samples; increase it
identically on both builds if compilation or resource startup remains visible.
There are no idle/stale-render samples silently folded into production timing.
A no-compute or unchanged-LOD sample is a correctness failure.

- **wallMs** starts before camera/config changes, includes CPU quadtree work,
  production, default query readback and publication, binding/current terrain
  rendering, and ends after the render queue completion.
- **updateMs** is the portion through the awaited runtime update, including
  default query publication. There is no extra pre-render settle fence.
- **gpuEnvelopeMs** is one timestamp interval from the first actual compute pass
  beginning to the last actual render pass ending. It spans the real sequence of
  submissions, including intervening CPU/readback idle gaps on the device
  timeline. It is **not a sum of isolated compute and render timings**, and no
  pass is replayed for timing. Missing timestamp support produces null, not a
  fabricated zero.
- Timestamp resolve/map and diagnostic pixel readback occur after the wall timer.
  Default terrain query readback is inside the timer. Timestamp instrumentation
  itself has overhead and is used identically for baseline and candidate.
- `coldSetupAndFirstResultMs` also includes setup and diagnostics. It is not the
  same metric as the cold sample's `wallMs`.

Raw results retain production/query revisions, selected tiles and counts, geometry,
rendered instance counts, analytic query probes, and pixel checksums. Compare these
at matched block/sample configurations. Checksums are supporting fidelity evidence,
not a replacement for broader production gym correctness/image tests.

## Reports and interpretation

Each context writes a raw `block-N-segments-N.json`. `run.json` records metadata
and per-block summaries; `summary.md` is a concise readable overview. Failed
contexts write an error report. Owned browser contexts and browser are closed.

Summaries include median, p95, p99, maximum and count for measured LOD and edit
samples separately. Percentiles use nearest rank. With only 20 samples, p95 and
p99 have limited statistical resolution (p99 is the maximum); use more samples
and independent blocks for stronger conclusions. Workload order alternates across
blocks. Cold, warmup, tile resolutions and scenarios are never pooled.

A successful correctness exit **does not mean under 2 ms**. The summary's
`under2msAtP99` requires passing fixture correctness and both wall and GPU-envelope
p99 strictly below 2 ms. A workload-wide claim requires that condition in every
recorded block and both scenarios, no browser errors, valid source provenance,
and unchanged fidelity. Unsupported GPU timestamps or unavailable adapter identity cannot establish the combined
budget. Always report actual percentiles, hardware and bounded workload alongside
any claim. A twofold speedup and a 2 ms budget are independent criteria.

Exit codes: 0 for completed passing fixture checks, 1 for correctness/page/console errors,
2 for harness failures or unsupported primary GPU evidence (including unavailable
browser/WebGPU, timestamp support, or adapter identity). Detailed raw results
remain necessary to interpret unsupported optional timestamps and performance.

## Scheduling modes

`--scheduling serial` is the default and retains the original sequence: update
through fresh query publication, then render and await draw completion.

`--scheduling publication-overlap` starts a draw when its new render revision is
published, while default query readback continues. Full wall time waits for both
update and an explicit draw queue fence.

`--scheduling publication-retirement-fence` draws synchronously from that same
publication callback and observes the runtime's existing retirement queue fence.
The observer verifies a real draw submission, then a later `onSubmittedWorkDone()`
call and successful completion. Warm samples issue no duplicate fence; cold
samples explicitly request one because there is no previous production to retire.
Normal update/readback still completes, and drawn/render/query revisions must match.
Missing or failed completion proof fails the sample. This mode depends on the
current runtime retirement contract and is not a generic `mapAsync()` inference.

Compare baseline and candidate with the same scheduling mode. In either overlap
mode, `gpuEnvelopeMs` ends at the final draw and may precede readback/query
completion. **Use full `wallMs` for complete-pipeline latency.** Raw samples include
`drawCompletionMs`, revisions, draw count, and retirement-fence proof timestamps.
All modes retain compute, draw, default CPU readback, and fidelity checks.
