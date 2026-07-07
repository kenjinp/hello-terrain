# Architecture Simplification: One Home Per Tile

## Purpose

The library's hard problems — GPU terrain synthesis, cross-face cube-sphere
topology, incremental dirty-slot dispatch — are solved and sound. Its
complexity lives in bookkeeping: a single tile's lifecycle is smeared across
five modules (`visibility`, `residency`, `tileSlotCache`, the leaf-set tasks,
and three spatial indices), cross-referenced through three keyspaces (leaf
index, slot number, string keys). The 2026-07 bug cluster — flashing tiles,
permanent holes, phantom ground after teleport — were all _seam_ bugs between
these representations, none were bugs inside a module. The fixes (persistent
dirty bit, LRU eviction, omit-unready draws, ready-gated queries) hardened the
seams; this spec plans removing them.

Target: the same stated feature goals — earth-scale variable LOD,
frustum/horizon culling, residency anchors, incremental budgeted compute, TSL
elevation and compute plugins, CPU queries/raycast/physics — with roughly half
the bookkeeping code and a structurally smaller bug surface.

Current weight for reference (non-test lines): `quadtree/` 2805, `query/`
2412, `tasks/` 1925 — versus `gpu/` 1696 for the product itself. `work/` adds 2431.

## Goals

- One module owns a tile's full lifecycle; draw, dispatch, and query sets are
  derived views of the same rows.
- LOD transitions are ready-by-construction: no substitution/recovery
  machinery in the render path.
- CPU queries are synchronous and exact when the consumer can provide a CPU
  elevation function; the async readback/snapshot subsystem becomes opt-in.
- The public API is `update()`-shaped; the work graph stops being a public
  contract (whether it survives internally is decided last, on evidence).
- Every phase is independently shippable and observable in the GPU lab.

## Non-Goals

- No feature retirement: topologies (including torus), holes, painting,
  overlays, compute-stage plugins all survive.
- No change to the TSL/GPU compute pipeline, field storage layout (except the
  packing item in Phase 5), or the geometry/skirt system.
- No renderer abstraction beyond what exists (three.js WebGPURenderer).
- Not a rewrite: each phase lands inside the existing structure and test
  suites before the structure it replaces is deleted.

## Design Rules

- Keep the existing rules from `incremental-gpu-updates.md` (no
  `projection.kind` branching, instance-scoped state, snapshot consistency,
  conservative correctness, GPU-lab observability).
- A tile fact must have exactly one authoritative representation. Derived
  views (draw list, dirty list, spatial index) are rebuilt from the table in
  the same pass that mutates it — never incrementally patched from elsewhere.
- No string keys in per-update paths. Tile identity is a packed integer key.
- Async boundaries (GPU dispatch, readback) communicate through explicit
  completion callbacks that mutate table flags; no cross-run obligations
  encoded in task-local state.

## Phase 1: TileTable — **landed 2026-07 (core), classification folding deferred**

### Goal

Collapse `quadtree/visibility.ts`, `quadtree/residency.ts`,
`quadtree/tileSlotCache.ts`, and the leaf-set copies in
`tasks/quadtree.task.ts` into a single flat SoA table. The existing task
boundaries survive as thin adapters so telemetry, the GPU lab, and the React
layer keep working unchanged.

### Model (as built — `quadtree/tileTable.ts`)

```ts
type TileTable = {
  capacity: number; // == maxNodes; a row IS a persistent GPU field slot
  space: Uint8Array; level: Uint8Array; x: Int32Array; y: Int32Array;
  flags: Uint8Array; // Allocated | Computed | Dirty (TileRowFlags)
  rowContentEpoch: Uint32Array;
  lastResidentGen: Uint32Array;
  lastVisibleGen: Uint32Array;
  keyIndex: SpatialIndex; // key -> row; see identity note below
  // Derived views, rebuilt by updateTileTable in the mutating pass:
  drawRows: Uint32Array;    // post-substitution, only Computed rows
  residentRows: Uint32Array;
  dirtyRows: Uint32Array;   // single list (dirtyVisible alias folded)
  queryRows: Uint32Array;   // ready-gated: Computed ∧ resident
  telemetry: TileTableTelemetry; // superset of TileSlotTelemetry, names preserved
};
```

**Identity (deviation from the original sketch):** instead of inventing a
packed 60-bit key (which does not fit a 53-bit-safe number at level 24+),
`keyToRow` reuses the existing `SpatialIndex` — an open-addressed,
stamp-resettable hash on raw `(space, level, x, y)` that was already tested
and allocation-free. It is rebuilt each update over Allocated rows (stamp
reset; evicted rows simply aren't re-inserted), so no deletion bookkeeping
exists. Update-time protection from mid-pass eviction uses a
`protectedGen` stamp resolved in a prepass.

**Deferred:** `visibility.ts` and `residency.ts` still run as separate
classification tasks whose result states feed `updateTileTable`, rather than
being called from inside it. Folding them (and their task shells) is
scheduled with Phase 2, which restructures the same code paths anyway; the
line-reduction acceptance criterion below is measured then.

### Implementation Steps

1. ~~Packed-key helpers~~ → superseded by `SpatialIndex` reuse (see identity
   note); negative-coordinate and cross-space keying covered by table tests.
2. ✅ `TileTable` + `updateTileTable` with the telemetry union;
   `tileSlotCache.test.ts` ported (cases preserved, not weakened) plus new
   coverage: ready-gated `queryRows`, negative infinite-flat coordinates.
3. ✅ `tileSlotUpdateTask` / `visibleLeafSetTask` / `residentLeafSetTask` /
   `leafGpuBufferTask` / `dirtyVisibleSlotBufferTask` rewired as views over
   the table; the ready-gating filter moved out of `residentLeafSetTask` into
   the table (`queryRows`).
4. ✅ `tileSlotCache.ts` deleted; the `dirtyVisibleSlots` alias folded to a
   single `dirtyRows` list (`dirtyVisibleCount` telemetry name kept as a
   mirror for observability compatibility).

### Acceptance Criteria

- ✅ All slot-cache test cases pass against the table (ported, not weakened);
  visibility/residency suites unchanged and green.
- ✅ No `Map<string, …>` or template-literal key construction in any
  per-update path (enforceable by grep in CI).
- ⏳ GPU lab scenarios (cold load, warm reuse, orbit-to-surface) show equal or
  better update-phase CPU time — to be captured in the lab before release.
- ⏳ `quadtree/` + `tasks/` shrink by ≥ 1500 lines net — measured after the
  deferred classification folding and Phase 2 deletion land.

## Phase 2: Staged LOD Commits

### Goal

Replace pending-slot substitution with the inverse invariant: an LOD
transition is not committed until its replacement tiles are computed. The
draw set is ready-by-construction; `applyPendingSlotSubstitution`, suppressed
parent keys, omission, and the initial-load blank frame all disappear.

### Model

The quadtree refinement proposes transitions; the table stages them:

- A **split** allocates the four children as RESIDENT+DIRTY but keeps the
  parent VISIBLE. When all four are COMPUTED, the commit swaps visibility in
  one update (parent → retained substitute pool, children → VISIBLE).
- A **merge** allocates the parent as RESIDENT+DIRTY, children stay VISIBLE
  until the parent is COMPUTED.
- A staged transition holds at most one generation of "both sides resident",
  which is exactly what the substitution path already caused implicitly —
  capacity behavior is unchanged.
- Cold start (no ancestor exists) is the only case that may draw nothing: root
  tiles commit on their own compute, typically one frame.

This is also the first half of the roadmap's Phase 3 (LOD churn control):
staged commits rate-limit transitions naturally. Split/merge _decision_
hysteresis remains in `incremental-gpu-optimization-roadmap.md` and composes
with this unchanged.

### Implementation Steps

1. Add `staged` transition bookkeeping to the table (parent row ↔ child rows,
   both sides resident while staged).
2. Commit staged transitions at the top of `updateTileTable` when the ready
   condition holds; expose `stagedSplitCount` / `stagedMergeCount` /
   `commitLatencyFrames` telemetry.
3. Delete `applyPendingSlotSubstitution` and the omit path; `drawRows` may
   only contain COMPUTED rows (assert in dev builds).
4. Keep `notReadyVisibleCount` telemetry defined (now structurally ~0; a
   nonzero value is a regression alarm, not a mechanism).

### Acceptance Criteria

- Walking/orbiting stress scenarios show zero non-COMPUTED draws (dev assert
  never fires) and no visible flash/hole class in the GPU lab capture.
- Teleport commits the destination's first LOD ring within N frames with the
  old visuals or better (N measured and recorded in the lab, not guessed).
- Net deletion: the substitution block (~130 lines) plus its test scaffolding,
  replaced by staged-commit tests of equal coverage.

## Phase 3: Paired CPU Elevation (readback becomes opt-in)

### Goal

Make CPU queries synchronous and exact when the consumer can express
elevation on the CPU, demoting the async snapshot subsystem
(`terrain-snapshot.ts`, `cpu-terrain-cache.ts`, elevation pyramid,
double-buffered indices, dirty-range readbacks) to an opt-in fallback for
GPU-only elevation.

### Model

```ts
// Today: elevationFn: ElevationCallback (TSL only)
type ElevationSource = {
  gpu: ElevationCallback;              // unchanged TSL path
  cpu?: (x: number, z: number) => number; // meters, world XZ (flat/heightfield)
  // curved surfaces: cpuByDirection?: (dir) => meters, injected via projection
};
```

- With `cpu` provided: `TerrainQuery`/raycast evaluate it directly (plus
  elevationScale/originY), gated only by "is this location inside the terrain
  domain" — no readiness, no readback, no teleport hold. `createHeightmapField`
  already ships the paired sampler for the heightmap case; procedural noise
  helpers (`voronoiCells` etc.) grow CPU mirrors over time, with parity tests
  in the pattern of `heightmap/field.test.ts`.
- Without `cpu`: today's snapshot path, unchanged, behind
  `terrainTargets({ readback: true })` — which is already the opt-out shape.
- Detail limitation stated honestly in docs: the CPU function answers with the
  _base_ elevation contract it implements; consumers adding GPU-only detail
  stages accept CPU/GPU divergence up to their stated detail amplitude (same
  contract as today's readback resolution limits, which sample the computed
  field at tile vertex resolution).

### Implementation Steps

1. Introduce `ElevationSource` (alpha: replace `elevationFn`'s type; the
   bare-callback form remains accepted as `{ gpu }` shorthand).
2. Route `CpuTerrainCache` construction: cpu-function-backed implementation of
   the same `TerrainQuery`/`TerrainSurfaceQuery` interfaces (interfaces do not
   change; `cpu-raycast.ts` reuses its marching against the cpu sampler).
3. Move snapshot/readback construction behind the readback target so
   cpu-backed terrains never allocate the double buffers.
4. Docs: "which query backend am I on" decision table + parity-test recipe.

### Acceptance Criteria

- With a paired source: teleport ground queries valid on the _same frame_;
  no `readbackPending` state exists in the instance (asserted in tests).
- Query results parity-tested against GPU field readback within stated
  tolerance on the lab scenes.
- Readback subsystem untouched and still green for GPU-only sources.

## Phase 4: `update()` as the Public API

### Goal

Consumers stop seeing the work graph. The three-line loop
(`graph.set(cameraView…); graph.set(residencyAnchors…); await graph.run(…)`)
becomes `terrain.update({ camera, anchors, dt, renderer })`. Whether the graph
survives _internally_ is decided here, on evidence, after Phases 1–3 have
shrunk what it coordinates.

### Rationale

The update is a linear pipeline with one consumer. The graph's flagship
feature — run preemption — is what created the dropped-dirty-work hole bug:
aborts introduce partial-execution states that stateful stages must defend
against (the persistent dirty bit exists for exactly this). A synchronous
`update()` cannot be preempted mid-pipeline; equality gating survives as
plain early-outs (`cameraViewEquals` etc. are already standalone functions).

### Implementation Steps

1. Ship `createTerrain(options)` returning `{ update, query, raycast,
telemetry, dispose }`, implemented over the existing graph.
2. Migrate `@hello-terrain/react` and all examples/docs to it; `terrainGraph`
   remains exported but undocumented for one release.
3. Measure: if after Phases 1–3 the graph coordinates ≤ ~5 stages with no
   cross-run state, inline it into a plain phase sequence and retire
   `@hello-terrain/work` from the dependency; if the docs' timing
   bars/observability still earn it, keep it as an internal detail and close
   this phase with only the API change.

### Acceptance Criteria

- No example, doc page, or React code path calls `graph.set`/`graph.run`.
- Clean-frame cost (no camera movement) is ≤ today's, verified in the lab.
- The preemption-loss test class (requeue-after-abort) either becomes
  impossible by construction (graph retired) or stays covered (graph kept).

## Phase 5: Small Taxes (opportunistic, any order)

- **Field packing**: store elevation as `r32float` + octahedral-packed normal
  (same 8 bytes/vertex as today's rgba16float) — deletes per-tile
  pack/denormalize and the decode-time dependency on pack bounds; the bounds
  reduction survives solely for LOD/culling. Supersedes the alpha.14
  normalized-f16 workaround (`terrain-data-model.md` updated accordingly).
- **Alias removal**: `dirtyVisibleSlots` naming (folded in Phase 1).
- **`maxNodes` overloading**: one documented meaning (table capacity == field
  slot count == GPU buffer size), derived constants named at their use sites.

## Sequencing and Risk

Phases are ordered by leverage and land independently: 1 (structure) → 2
(render invariant) → 3 (query backend) → 4 (API) → 5 (opportunistic). Each
phase deletes its predecessor's machinery only after its ported tests and the
GPU lab scenarios are green. The riskiest phase is 2 (visual behavior under
churn); it is also the most observable — staged-commit telemetry plus the
existing orbit-to-surface capture make regressions visible before release.

Alpha status is the window for this. Every phase breaks some API surface
(`elevationFn` type, task exports, telemetry fields); the changelog carries a
Breaking section per phase, and none of it is worth doing after 1.0.
