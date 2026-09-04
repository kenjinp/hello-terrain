---
# hello-terrain-7vyy
title: Move three.js math out of CPU query/projection internals
status: completed
type: task
priority: low
created_at: 2026-09-04T16:41:14Z
updated_at: 2026-09-04T17:10:00Z
---

Per AGENTS.md, library internals should not use three.js. Value imports of Vector3/Ray exist in query/cpu-raycast.ts, query/cpu-terrain-cache.ts, projection/cubeSphere.ts, projection/torus.ts, and CpuSurfaceOps.surfacePosition writes into a three Vector3 (projection/types.ts). Results returned to consumers may stay Vector3, but internal math should use plain {x,y,z} / Float64 scratch, converting at the public boundary (TerrainQuery/TerrainRaycast/TerrainMesh.raycast).

## Checklist

- [x] Add `query/vec3.ts`: allocation-free plain `{ x, y, z }` helpers (`vec3`, `vec3Set`, `vec3Copy`, `vec3Add`, `vec3Sub`, `vec3Scale`, `vec3Dot`, `vec3Cross`, `vec3Length`, `vec3LengthSq`, `vec3Distance`, `vec3Normalize`, `rayAt`) whose formulas mirror `Vector3` / `Ray` bit-for-bit.
- [x] `projection/types.ts`: drop the `three` import; add `RayLike`; `CpuSurfaceOps.surfacePosition(key, elevation, out: Vec3Like)`, `surfaceNormal(key, ctx, out: Vec3Like): Vec3Like`; `ProjectionRaycastContext.ray: RayLike`; `SurfaceProjectionCpu.raycast` returns a plain `CpuRaycastHit`.
- [x] `query/types.ts`: add `CpuRaycastHit`; widen `TerrainSurfaceQuery` / `TerrainSphereQuery` *inputs* to `Vec3Like` (a `Vector3` still satisfies them); return types stay `Vector3`.
- [x] `query/cpu-raycast.ts`: no `three` import; `RayLike` + `Vec3Like` scratch, `rayAt` / `vec3Distance`; marchers return `CpuRaycastHit`.
- [x] `query/terrain-raycast.ts`: the boundary — passes the `THREE.Ray` through as a `RayLike` and converts the plain hit into `TerrainRaycastResult` `Vector3`s once.
- [x] `query/cpu-terrain-cache.ts`: internals (`computeNormalInto`, `sampleIntoScratch`, `sampleSurfaceInto`) on cache-owned `Vec3Like` scratch + a reused `SurfaceNormalContext`; `Vector3` allocated only in the public methods; batch paths and `getElevationBySurfacePosition` / `getNormalBySurfacePosition` no longer allocate per point.
- [x] `projection/cubeSphere.ts` / `projection/torus.ts`: CPU sections free of `three`; surface ops write into `out`; cube-sphere query scratch is a plain vector.
- [x] Guard test `tests/no-three-in-cpu-internals.test.ts` (query internals + `quadtree/**` non-test files must have no value import from `"three"`); `@types/node` added to `packages/three` devDependencies for `node:fs`.
- [x] Specs: `architecture.md`, `concepts.md`, `terrain-data-model.md` (CPU Query Module Layout) updated.
- [x] Docs: `core/projection.mdx` (CPU hooks, `CpuSurfaceOps` / `ProjectionRaycastContext` signatures), `core/query/terrain-query.mdx` (inputs accept plain `{ x, y, z }`), changelog "Unreleased" entry with a "Breaking (custom projections)" note.
- [x] Verification: `pnpm typecheck`, `pnpm lint` (no new warnings), vitest for `three` / `work` / `react` all green; existing query tests unchanged.

## Resolution

The CPU query / raycast / projection internals now run entirely on plain
`Vec3Like` / `RayLike` objects with the helpers in `query/vec3.ts`. three.js is
imported only at the consumer boundary: `query/types.ts` (type-only),
`query/terrain-raycast.ts` (constructs the result `Vector3`s), and
`query/cpu-terrain-cache.ts` (constructs `Vector3`s in its public sample
methods). `projection/types.ts`, `cpu-raycast.ts`, and the CPU sections of
`projection/cubeSphere.ts` / `projection/torus.ts` no longer import `three`
(their GPU sections still use `three/tsl` / `three/webgpu`, which is allowed).

Numerics are unchanged: `vec3Normalize` uses `sqrt(x²+y²+z²) || 1` and
multiplies by the reciprocal exactly like `Vector3.normalize`, `rayAt` matches
`Ray.at`, and `vec3Distance` matches `Vector3.distanceTo`. The consumer types
(`TerrainQuery`, `TerrainSurfaceQuery`, `TerrainSphereQuery`,
`TerrainRaycast.pick`, `TerrainMesh.raycast`, sample/result `Vector3` fields)
are unchanged apart from surface-query inputs now also accepting plain
`{ x, y, z }`. Custom `SurfaceProjection.cpu` implementations must switch the
`surfacePosition` / `surfaceNormal` `out` params from `Vector3` to `Vec3Like`
and return a plain hit from `raycast` — documented in the changelog.
