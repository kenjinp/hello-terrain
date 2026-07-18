# Incremental GPU Optimization Roadmap

## Purpose

The first incremental GPU plan established persistent field slots, visible-slot
render lookup, resident-slot query lookup, dirty-resident compute dispatch, and
sparse readback. That made clean frames and small dirty frames cheap, but the
orbit-to-surface stress suite still shows frame spikes when camera movement
creates hundreds or thousands of newly dirty resident tiles in one graph run.

This document plans the next optimization layers. The target is a predictable
steady-state compute budget, initially 1.5ms for earth-scale cube-sphere stress
scenarios with `tileVertexCount=64` and `maxNodes=4098`.

## Current Baseline

Implemented foundations:

- Persistent `fieldSlot` identity for terrain field storage.
- Separate visible and resident slot lists.
- Terrain compute dispatch over `dirtyVisibleCount`.
- Tile-bounds reduction over dirty resident slots.
- CPU query snapshots that skip clean-frame readback and merge dirty-slot
  readback ranges.
- GPU lab scenarios for cold surface load, warm reuse, and orbit-to-surface
  drift.

Observed bottleneck:

- Clean frames can avoid compute entirely.
- Partial dirty frames scale well.
- Dirty-heavy movement still creates bursts such as `dirtyVisibleCount=480` or
  `1024`, so compute can exceed the 1.5ms budget even though dispatch now scales
  with actual dirty work.

## Design Rules

- Do not branch shared components on `projection.kind`. Shape-specific behavior
  must be injected by topology or projection hooks.
- Keep CPU-side task state instance-scoped. No module-scope terrain caches.
- Preserve snapshot consistency: render, query, spatial index, terrain field
  data, and tile bounds must agree on slot identity.
- Prefer predictable bounded work over maximal immediate detail.
- Keep correctness conservative. A tile may be lower detail for a few frames,
  but it must not sample uninitialized or mismatched terrain data.
- Make every phase observable in the GPU lab before relying on it for budget
  claims.

## Phase 1: Budgeted Dirty Work Queue

### Goal

Cap per-frame terrain compute and readback by processing only a fixed number of
dirty slots each graph run. This converts large dirty bursts into bounded
progressive updates.

### Proposed API

Internal params:

```ts
dirtySlotBudget: number; // default: unlimited until enabled by tests/lab
dirtySlotPriority: "visible-first" | "screen-error" | "distance";
```

Runtime state:

```ts
type TileSlotState = {
  pendingDirtySlots: Uint32Array;
  pendingDirtyCount: number;
  scheduledDirtySlots: Uint32Array;
  scheduledDirtyCount: number;
};
```

Telemetry:

```ts
terrain.incremental = {
  dirtyVisibleCount,
  dirtyQueuedCount,
  dirtyScheduledCount,
  dirtyDeferredCount,
  dirtyBudget,
};
```

### Implementation Steps

1. Extend the slot cache with a persistent pending dirty set.
2. When a visible tile allocates or invalidates a slot, enqueue the slot if it
   is not already ready for the current tile key.
3. Produce `scheduledDirtySlots` by draining up to `dirtySlotBudget`.
4. Upload `scheduledDirtySlots` instead of all dirty visible slots.
5. Dispatch terrain compute and tile-bounds reduction over
   `scheduledDirtyCount`.
6. Trigger sparse readback only for scheduled dirty slots.
7. Keep deferred dirty slots resident and pending across graph runs.

### Acceptance Criteria

- GPU lab reports `dirtyScheduledCount <= dirtyBudget`.
- Compute dispatch size follows `dirtyScheduledCount`, not total dirty count.
- A 4098-node orbit-to-surface run can cap compute under the selected budget on
  dirty-heavy frames.
- Cold and teleport frames remain correct, but may converge progressively.

## Phase 2: Ready/Resident/Visible Slot States

### Goal

Separate "slot exists" from "slot is ready to render/query". Budgeted dirty work
requires this; otherwise visible tiles can point at slots whose field data has
not been computed yet.

### State Model

Use explicit slot states:

```ts
const SlotState = {
  Free: 0,
  ResidentClean: 1,
  ResidentDirty: 2,
  Scheduled: 3,
  Ready: 4,
} as const;
```

The exact enum can be refined, but the responsibilities must stay separate:

- **Resident**: slot owns a tile key and can be retained or evicted.
- **Dirty**: slot needs compute before its data is current.
- **Scheduled**: slot is included in the current GPU dispatch.
- **Ready**: slot has valid terrain field and bounds for its current key.
- **Visible**: tile is in the current draw set.
- **Resident**: tile needs terrain data for render, query, raycast, physics, or
  sampler support.

### Fallback Policy

When a visible tile is not ready:

1. Prefer the nearest ready ancestor tile.
2. If no ready ancestor exists, prefer the previous ready slot for the same
   screen region only when it is topologically compatible.
3. If no safe fallback exists, omit the tile from the render/query set for that
   frame and count it as not ready.

The first implementation can start with ready ancestor fallback only. It is
conservative and works naturally with quadtree topology.

### Implementation Steps

1. Add ready state to `TileSlotCacheState`.
2. Mark allocated/invalidated slots dirty and not ready.
3. Mark scheduled slots ready after their compute/readback generation completes.
4. Build render visible lists and query resident lists from ready slots plus
   fallback slots.
5. Track `visibleRequestedCount` separately from `visibleReadyCount`.
6. Update spatial index generation semantics so lookup values resolve only to
   ready field slots.

### Acceptance Criteria

- No render path samples unready slot data.
- Query samples return valid data for ready or fallback tiles only.
- GPU lab exposes `visibleReadyCount`, `fallbackVisibleCount`, and
  `notReadyVisibleCount`.
- With a small dirty budget, visual/query correctness remains stable while
  detail converges over multiple frames.

## Phase 3: LOD Churn Control

### Goal

Reduce the number of newly dirty tiles created by camera movement. This attacks
the source of dirty bursts instead of only budgeting the aftermath.

### Mechanisms

- **Split budget**: limit how many parent tiles can split per frame.
- **Merge budget**: limit collapses to avoid oscillation.
- **Hysteresis**: use different thresholds for split and merge.
- **Screen-error priority**: refine tiles with largest visible error first.
- **Surface-flight damping**: near the surface, avoid re-evaluating far-horizon
  detail too eagerly.

### Proposed Telemetry

```ts
terrain.lod = {
  splitCandidates,
  splitsApplied,
  splitsDeferred,
  mergeCandidates,
  mergesApplied,
  maxScreenError,
  hysteresisBand,
};
```

### Implementation Steps

1. Add LOD decision telemetry without changing behavior.
2. Add split/merge hysteresis in the CPU quadtree refinement step.
3. Add optional per-frame split and merge budgets.
4. Prioritize split candidates by injected topology/projection bounds plus
   camera-space screen error.
5. Feed deferred split candidates back into the next update.

### Acceptance Criteria

- Orbit-to-surface dirty bursts shrink before dirty-slot budgeting is applied.
- Camera jitter near the surface does not cause repeated split/merge churn.
- Lab output can explain whether a spike came from LOD churn or compute cost per
  dirty tile.

## Phase 4: Compute Cost Optimization

### Goal

Reduce per-dirty-tile compute cost after dirty counts are bounded.

### Candidate Changes

1. **Fuse bounds into terrain generation**
    - During elevation generation, write per-workgroup partial min/max.
    - Reduce those partials instead of scanning the full tile in a separate pass.

2. **Normal mode options**
    - Keep the current high-quality normal path as default.
    - Add an internal cheaper normal mode for stress tests or distant tiles.
    - Do not expose this publicly until visual differences are understood.

3. **Stage fusion**
    - Revisit whether `terrainField.linearStage0` and
      `terrainField.linearStage1` can share work or avoid intermediate reads.
    - Keep generated WGSL inspectable with stable pass labels.

4. **Adaptive tile resolution**
    - Permit distant fallback tiles to compute at a lower resolution.
    - Requires explicit field layout/versioning, so this is a later option.

### Acceptance Criteria

- Per-pass timing shows whether terrain stage, normal stage, or bounds reduction
  is the dominant cost.
- Bounds reduction time drops materially in dirty-heavy runs.
- Visual/query tests still pass for cube-sphere and torus.

## Phase 5: GPU Lab Metrics and Assertions

### Goal

Make optimization work agent-friendly. The lab should report enough structured
state for an agent to identify whether a frame is limited by dirty churn, dirty
budget, compute cost, readback, or query readiness.

### Metrics to Add

```ts
terrain.incremental = {
  dirtyVisibleCount,
  dirtyQueuedCount,
  dirtyScheduledCount,
  dirtyDeferredCount,
  readySlotCount,
  visibleReadyCount,
  fallbackVisibleCount,
  notReadyVisibleCount,
  readbackRangeCount,
  readbackElementCount,
};
```

```ts
terrain.lod = {
  splitCandidates,
  splitsApplied,
  splitsDeferred,
  mergeCandidates,
  mergesApplied,
};
```

Budget assertions:

- `steady-state-compute-budget`
- `dirty-scheduled-budget`
- `ready-coverage-minimum`
- `fallback-count-maximum`
- `no-unready-visible-sampling`

### Implementation Steps

1. Add telemetry fields with no behavior changes.
2. Add summary output to `scripts/run-gpu-agent-lab.js`.
3. Add scenario-specific assertions for cold, warm, drift, and teleport classes.
4. Store full JSON output paths in beans for long stress runs.

### Acceptance Criteria

- Lab summaries identify which phase caused a budget miss.
- Agents can compare before/after runs without reading browser logs.
- Assertions distinguish expected cold/teleport work from steady-state budget
  failures.

## Recommended Order

1. GPU lab metrics for dirty budget/readiness placeholders.
2. Ready/resident state separation.
3. Budgeted dirty queue with a conservative default disabled in normal examples.
4. Enable dirty budget in stress scenarios and tune the first budget target.
5. LOD churn telemetry, then hysteresis and split/merge budgets.
6. Compute pass optimization once dirty counts are bounded and explainable.

Ready/resident state separation can land before the dirty budget if that makes
review easier. Dirty budgeting should not ship without a ready/fallback policy.

## Validation Matrix

| Scenario                                 | Purpose                     | Expected behavior                               |
| ---------------------------------------- | --------------------------- | ----------------------------------------------- |
| `earth-sphere-surface-load` cold         | Full dirty allocation       | Correct, may exceed steady-state budget         |
| `earth-sphere-surface-load` warm         | Clean reuse                 | No compute, no readback, ready coverage stable  |
| `earth-sphere-orbit-surface-center` 1024 | Small partial dirty         | Scheduled dirty follows dirty budget            |
| `earth-sphere-orbit-surface-center` 4098 | Dirty-heavy stress          | Compute bounded by scheduled dirty count        |
| `earth-sphere-orbit-surface-edge`        | Cube-face seam stress       | No fallback holes along face transitions        |
| `earth-sphere-orbit-surface-corner`      | Cube-corner stress          | Query samples must target visible/ready regions |
| `earth-torus-surface-load`               | Projection injection parity | No projection-kind branches in shared code      |

## Open Questions

- What first dirty budget should the docs examples use: unlimited, 256, or a
  device-adaptive value?
- Should unready visible tiles render parent fallback geometry, previous tile
  geometry, or temporarily omit rendering?
- Should query snapshots expose "ready generation" separately from graph
  generation?
- Should split budgeting happen inside the quadtree refinement step or as a
  post-process over proposed leaves?
- How should priority account for tiles near the horizon that are large on the
  surface but small on screen?
