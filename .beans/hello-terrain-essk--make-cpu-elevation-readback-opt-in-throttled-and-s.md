---
# hello-terrain-essk
title: Make CPU elevation readback opt-in / throttled and surface readback errors
status: completed
type: feature
priority: normal
created_at: 2026-09-04T16:41:14Z
updated_at: 2026-09-04T17:05:00Z
---

terrainReadbackTask is always in terrainGraph() and re-triggers whenever the spatial index stampGen advances (every frame the quadtree runs). Each readback copies activeLeafCount * (innerTileSegments+3)^2 * 4 bytes (several MB/frame at defaults) even when no consumer uses TerrainQuery/raycast. Also runDeviceReadback().finally(...) in query/terrain-snapshot.ts has no .catch, so readback failures become unhandled rejections.

## Checklist
- [x] Add a param (e.g. `terrainQueryReadback: 'off' | 'auto' | { intervalFrames }`) and skip triggerReadback when off
- [x] React: only target terrainReadback when a query/raycast consumer exists, or expose the option via useTerrain
- [x] Add .catch that reports once and resets readbackPending
- [x] Document in core/query/how-it-works.mdx

## Resolution

Branch `feat/essk-readback-control`.

**Params** (`packages/three/src/tasks/params.ts`, exported from the package index):
- `terrainReadbackEnabled = param(true)` — when `false`, `terrainReadbackTask` returns without calling `triggerReadback`.
- `terrainReadbackIntervalMs = param(0)` — minimum wall-clock ms between *scheduled* readbacks; `0` keeps the old behavior. Chosen over the `'off' | 'auto' | { intervalFrames }` sketch because two flat params map 1:1 onto `resetOrSet` in React and a time budget is more meaningful than a frame count at variable refresh rates.

**Task** (`packages/three/src/tasks/terrain-query.task.ts`): `terrainReadbackTask` now `get()`s both params and keeps `lastScheduledAt` in its own returned `TerrainReadbackState` via the `work((prev) => …)` pattern (no module-scope state; per graph instance). Gating is the pure `shouldScheduleReadback(now, lastAt, intervalMs, enabled)` in `query/readback-schedule.ts` (`readbackNow()` guards `performance` for non-browser runtimes). The timestamp only advances when `cache.triggerReadback` actually scheduled — `CpuTerrainCache.triggerReadback` and `triggerSnapshotReadback` now return `boolean`.

**Error handling** (`packages/three/src/query/terrain-snapshot.ts`): both the pooled device path and the `getArrayBufferAsync` fallback (`Promise.all` and single-promise branches) have `.catch(...)` ahead of the unchanged `.finally` that clears `readbackPending`. On failure: no buffer swap, `lastScheduledStampGen = -1` so the next call retries, and `console.error` once per distinct message via the new per-state `lastErrorKey`.

**React**: `TerrainOptions.terrainReadback?: boolean` / `terrainReadbackIntervalMs?: number` wired through `useTerrainParams` (`resetOrSet`) and all three prop enumerations in `Terrain.tsx`. `useTerrain` still targets `terrainTasks.terrainReadback` every frame; the task itself no-ops when disabled or throttled. The "only target when a consumer exists" half of the checklist item was deliberately not implemented: `runtime.query`/`runtime.raycast` are read imperatively (and `TerrainMesh.raycast` needs the raycast for pointer events), so there is no reliable signal for "a consumer exists". Exposing the option is the chosen path; the cost of the no-op task is one `get()` per frame.

**Tests**: `query/readback-schedule.test.ts` (gating), `query/terrain-snapshot.test.ts` (scheduled/pending/unchanged return values; rejected elevation readback → `readbackPending` false, `hasSnapshot` false, retry re-schedules, error logged once; distinct messages logged once each then success swaps; rejected bounds on the `Promise.all` path). React: `useTerrainParams` maps/sets/resets the two options (mock gained the previously missing `radius` export).

**Docs**: `core/query/how-it-works.mdx` "Controlling readback" (cost formula, params, what turns off: LOD elevation ranges, query, raycast; failure behavior), `core/params.mdx` rows + React mapping, `react/use-terrain.mdx` "Controlling CPU Readback", `core/topology.mdx` link fix, `core/query/terrain-query.mdx` freshness bullet, changelog "Unreleased" entry, and `spec/terrain-data-model.md` runtime-controls list.
