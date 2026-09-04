---
# hello-terrain-ue12
title: Single source of truth for radius/origin/rootSize between params and topology
status: completed
type: bug
priority: high
created_at: 2026-09-04T16:41:14Z
updated_at: 2026-09-04T17:05:00Z
---

GPU uses the `radius` param via uRadius (uniforms.task.ts), while CPU LOD bounds, query and raycast use createCubeSphereTopology({ radius }) / projection.radius. Same duality for rootSize/origin vs createInfiniteFlatTopology({ rootSize, origin }). Users must set both consistently (docs show `<Terrain topology={...radius:1000} radius={1000}>`); mismatch silently desyncs GPU vs CPU.

## Checklist
- [x] Derive uRadius from topology.projection.radius in updateUniformsTask (topologyTask already exposes it); fall back to param only when projection has none
- [x] Decide whether rootSize/origin params should feed the topology or vice versa; make topologyTask the sole owner
- [x] Deprecate or remove the `radius` param and the React `radius` prop; update apps/docs (core/params.mdx, core/topology.mdx, examples) — **deprecated, not removed** (kept as a fallback for custom topologies whose projection has no `radius`; removal deferred to a follow-up)

## Resolution

Topology is the single owner of world config; params are a fallback only.

- `Topology` gained optional `rootSize` / `origin`. Flat + infinite-flat set both from their config; cube-sphere + torus set `origin = center` and leave `rootSize` undefined (their GPU projections size tiles from `uRadius` / their own geometry and never read `uRootSize`; the uniform is only forwarded to the user's `elevationFn` as `rootSize`, still driven by the param).
- New pure helper `resolveTerrainWorldConfig(topology, { rootSize, origin, radius })` in `packages/three/src/tasks/world-config.ts` (exported). Precedence: `rootSize`: topology → param; `origin`: topology → `projection.center` → param; `radius`: `projection.radius` → param.
- Used by `createUniformsTask`, `updateUniformsTask`, `terrainQueryTask`, `terrainRaycastTask`. `topologyTask` unchanged (default flat topology still built from the `rootSize` / `origin` params, so those params are *not* deprecated).
- `radius` param (`@hello-terrain/three`) and `radius` option/prop (`@hello-terrain/react`) marked `@deprecated`; wiring kept.
- Side fix: `updateUniformsTask` no longer writes a module-scope scratch `Vector3` into `uRootOrigin.value` (aliased the origin across terrain instances); it mutates the uniform's own vector in place.
- Tests: `packages/three/src/tasks/world-config.test.ts` — resolver unit tests for all four factories + graph-level tests (`graph()` + `topologyTask` + `createUniformsTask`/`updateUniformsTask`, `terrainQueryTask` + `terrainRaycastTask`) asserting topology values win over stale params.
- Docs: `core/params.mdx` (radius deprecated + "World config ownership" section), `core/topology.mdx`, `core/projection.mdx`, changelog "Unreleased" entry; examples `CubeSpherePlanetScene`, `EarthPlanetScene`, `InfiniteFlatScene` drop the redundant prop/param. Sandpack snippets keep the option because they pin published alpha.11 packages (comment updated). Specs `concepts.md` / `terrain-data-model.md` updated.
