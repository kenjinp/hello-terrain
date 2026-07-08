# Validation Gym

## Purpose

Every correctness bug this cycle — flashing tiles, permanent holes, phantom
ground after teleport, LOD oscillation — was found by a human walking around a
scene. Unit tests validate modules; the GPU lab validates budgets; nothing
validates _behavior over time_: coverage, readiness, drainage, stability, and
the physics contract a character depends on. The gym closes that gap.

The gym is a scenario-driven correctness harness with three synchronized
faces over one implementation:

1. **Automated** — a CDP runner drives real WebGPU Chrome through seeded
   scenarios and fails on invariant violations (exit code + JSON artifact).
2. **Visual** — the same scenarios run on a webserver page (`/gym` in the
   docs app) with a real rendered viewport, a live invariant panel, and a
   probe marker, so a human can _watch_ a failure instead of imagining it
   from a log.
3. **CI** — the same runner against headless Chrome with software WebGPU
   (SwiftShader), as a smoke gate (experimental until proven non-flaky).

Relationship to the existing Agent GPU Lab: the lab (`/agent-gpu-lab` +
`scripts/run-gpu-agent-lab.js`) remains the _performance_ harness — compute
budgets, pass timings, readback hashes. The gym owns _correctness_. They
share the CDP driving pattern but not code paths; the lab's 64×64 headless
canvas and stat-summary result shape are wrong for invariant streams and
visual verification, so the gym is built separately rather than grafted on
(they may merge after the architecture-simplification phases land).

## Design Rules

- **Pure logic lives in the library.** Probe stepping, invariant evaluation,
  path generation, and seeded RNG are `@hello-terrain/three` modules
  (`src/gym/`) with vitest coverage. The web page and runner are thin hosts.
  This is what makes the gym itself testable without a GPU.
- **Deterministic by construction.** Every scenario takes a seed; camera
  paths and teleport schedules derive from it; the update loop uses a fixed
  timestep. Two runs with the same seed on the same machine produce the same
  frame stream.
- **Time-windowed assertions, never same-frame.** GPU timing varies across
  machines; invariants are phrased as "within N update frames" or "in steady
  state", or the suite becomes flaky and ignored.
- **Analytic ground truth.** Gym terrains use elevation sources with exact
  CPU mirrors (`createGymElevation` returns `{ gpu: ElevationCallback,
cpu(x, z) => meters }`), so probe/query assertions compare against _truth_,
  not self-consistency. This deliberately prototypes the paired-elevation
  contract from `architecture-simplification.md` Phase 3.
- **Failure artifacts over failure messages.** A violation carries frame
  index, seed, scenario, camera/probe pose, and the recent telemetry window;
  the runner writes the full JSON; the page can re-run the same seed headed.

## Invariant Families

Each family is an executable check derived from a bug that shipped:

| Invariant                     | Statement                                                                                                                            | Bug it would have caught                     |
| :---------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------- |
| `draw-readiness`              | On gated graphs, `visibleReadyCount + fallbackVisibleCount === visibleSlotCount` every frame                                         | Drawing uncomputed slot data (flash/garbage) |
| `not-ready-drainage`          | `notReadyVisibleCount` returns to 0 within N frames of any movement burst; a persistent floor is a failure                           | Permanent holes                              |
| `dirty-drainage`              | Dirty backlog (`dirtyResidentCount`) drains to 0 within N frames after inputs stop changing                                          | Lost dirty work from preempted runs          |
| `probe-grounding`             | Once the probe reports grounded, its feet stay within ε of **analytic** ground; it never sinks below truth − ε                       | Falling through terrain                      |
| `query-truthfulness`          | Every `valid: true` terrain sample is within ε of analytic truth; validity appears within N frames of the probe arriving             | Phantom ground from unready slots            |
| `draw-stability`              | No tile leaves and re-enters the draw set within a K-frame window once the camera is at rest (flicker count == 0 in steady state)    | LOD oscillation / flicker                    |
| `overflow-absence`            | `overflowCount === 0` for scenarios sized within capacity                                                                            | Silent skips leaving keyless tiles           |
| `coverage-pixels` _(Phase 2)_ | Rendering terrain in a sentinel color over a contrasting clear, no clear-colored pixels appear inside the expected terrain footprint | Missing tiles, as a user sees them           |

## The Kinematic Probe

A ~60-line pure state machine (`gym/probe.ts`) implementing the same
grounding contract the terrain-diffusion explorer's character uses:

- **hold-until-valid**: vertical velocity forced to 0 until the first valid
  ground report (query or raycast) — gravity only after ground is known;
- gravity integration, ground snap with ride-height, grounded/airborne state;
- driven by `sampleGround(x, z) => { valid, elevation }` injected by the host
  (the page wires it to `terrainQuery`; tests wire it to scripted stubs).

It is _not_ the app's controller — it is the library's physics contract made
executable. "Probe below analytic ground" is a library bug by definition;
app-specific integration drift is covered later by an explorer gym mode
(Phase 3).

## Scenarios (Phase 1 set)

Declared in a manifest (`gym/scenarios.ts`): name, seed default, frame
counts, world/elevation parameters, invariant thresholds.

- **`surface-walk`** — probe walks a seeded smooth path (heading noise over a
  fixed speed) for ~1,500 fixed-step frames; camera follows; all invariants
  continuously evaluated. Catches missing tiles + grounding drift while
  moving.
- **`teleport-shock`** — every ~120 frames, jump probe+camera to a seeded
  far point; assert ground validity within N frames, probe never below
  truth, dirty backlog drains between shocks. Catches falling characters.
- **`rest-stability`** — walk briefly, then hold position ~300 frames;
  flicker and drainage must go to zero. Catches oscillation and backlog
  floors.

Phase 2 adds: `lod-boundary-hover`, `capacity-pressure` (small `maxNodes`),
`preemption-storm` (thrash inputs to force aborted runs), and the pixel
coverage oracle on all scenarios.

## Hosts

### `/gym` page (visual + automation surface)

- Real viewport (≥ 640×360) rendering the actual terrain material, probe
  marker, and path — a human can watch exactly what the runner measures.
- Live panel: scenario picker, seed input, per-invariant status lamps,
  violation list with frame numbers, telemetry sparklines
  (`notReadyVisibleCount`, `dirtyResidentCount`, flicker).
- Automation API: `window.__helloTerrainGym = { ready, listScenarios(),
run(name, { seed?, frames? }) => GymRunResult }` where `GymRunResult`
  carries scenario, seed, platform info, per-invariant pass/fail,
  violations (bounded list + total count), and summary telemetry.
- URL params (`?scenario=…&seed=…&autorun=1`) so a failing CI run's exact
  configuration is one link away from a headed human eyeball.

### `scripts/run-gym.js` (automated)

CDP runner following the proven `run-gpu-agent-lab.js` pattern (launch
Chrome with a scratch profile, `Runtime.evaluate` against the automation
API): `--scenario/--suite`, `--seed`, `--url`, `--headed`, `--output
<artifact.json>`, `--chrome`, `--port`. Exit 0 iff every scenario's
violations are empty. `pnpm gym` / `pnpm gym:suite` at the repo root.

### CI (`.github/workflows/validation-gym.yml`) — experimental

Build packages → build docs → serve static export → run the smoke suite in
headless Chrome with `--headless=new --enable-unsafe-webgpu
--use-webgpu-adapter=swiftshader` (software WebGPU; no GPU runner needed).
Marked experimental: it must run green for ~2 weeks before it becomes a
required check, and if SwiftShader proves unstable the fallback is a
documented "run on real hardware before release" ritual (the runner makes
that a one-liner, including on Apple silicon — where GPU-specific bugs like
the heightmap terracing actually live).

## Result Shape

```ts
type GymRunResult = {
  scenario: string;
  seed: number;
  frames: number;
  fixedDtMs: number;
  platform: { userAgent: string; adapter?: string };
  ok: boolean;
  invariants: Array<{ name: string; pass: boolean; violationCount: number }>;
  violations: GymViolation[]; // bounded (first M), each with frame + data
  telemetry: {
    maxNotReady: number; framesToDrainNotReady: number;
    maxDirtyBacklog: number; framesToDrainDirty: number;
    flickerEvents: number; overflowTotal: number;
    probeMaxPenetration: number; probeFramesToGround: number;
  };
};
```

## Phases

### Phase 1 — Invariant core + walk/teleport scenarios _(this change)_

`gym/` library module (rng, probe, paths, invariants, scenario manifest,
paired sine elevation) with vitest coverage; `/gym` page with viewport,
panel, and automation API; `run-gym.js`; experimental CI workflow.

Acceptance: gym module fully unit-tested without a GPU; `pnpm gym
--scenario surface-walk` and `teleport-shock` run green on a healthy build
on real hardware; a deliberately re-introduced bug from this cycle (e.g.
enqueue-time epoch stamping) turns at least one scenario red.

### Phase 2 — Pixel coverage oracle + stress scenarios

Sentinel-color rendering + framebuffer readback for hole detection;
`lod-boundary-hover`, `capacity-pressure`, `preemption-storm`; flicker
metric feeding the Phase-3-roadmap hysteresis work (metric before fix).

### Phase 3 — Explorer gym mode

`?gym=<scenario>&seed=` in terrain-diffusion-api driving the real
`useCharacterController` through the same runner; asserts the app-level
contract (spawn margins, exaggeration scaling, teleport settle).

### Phase 4 — CI promotion

Smoke suite becomes a required PR check; full matrix nightly; artifacts
uploaded on failure with the `?scenario=…&seed=…` repro link in the job
summary.
