---
# hello-terrain-gno8
title: df64 tile-local precision mode for sub-meter close-up terrain
status: todo
type: feature
priority: high
created_at: 2026-06-21T15:35:13Z
updated_at: 2026-06-21T15:35:13Z
---

## Summary

Eliminate the float32 precision collapse at high LOD by adding an opt-in emulated double-float (df64) precision mode alongside the existing f32 path. df64 tile-local coordinates are threaded through the elevation callback and the curved-surface normal reconstruction so noise and shading stay resolvable well below 1 m on planet-scale radii, across flat, cube-sphere, and torus projections, while f32 stays the zero-overhead default.

## Why the close-up breaks (root cause, confirmed in code)

The elevation field is baked in a compute pass that loses f32 precision in three stacked places. On a planet (radius ~= 6.37e6), one f32 ULP is ~0.5 m, while level-18 vertices are ~0.6 m apart, so neighboring samples quantize to the same value and finite-difference normals shatter into facets.

1. UV from a large integer: `faceUVFromTileLocal` (packages/three/src/gpu/tile.ts) computes `(tile.x + localU) / 2^level`. At level 18 `tile.x ~= 262144`, so the per-vertex `localU` (~1/32) is at the f32 ULP and gets quantized.
2. World position scaled by radius: `createSphereTileComputeParts` (packages/three/src/projection/cubeSphere.ts) returns `rootOrigin + dir * radius` (~6.37e6), re-quantizing `dir` to ~0.5 m.
3. Re-normalize in the user callback: `createPlanetElevation` (apps/docs/src/examples/terrain/planetNoise.ts) does `worldPosition.normalize()`, recovering a direction already at the f32 floor.

The curved-surface normal has the same disease: `createDisplacedSurfaceNormalFromElevationField` (packages/three/src/gpu/normalField.ts) builds tangents as `pRight - pLeft`, subtracting two ~6.37e6 m positions to get a ~1.2 m tangent (catastrophic cancellation), so even with smooth heights the shading would still facet.

The fix: compute the noise input and the normal tangents in df64 (two f32: hi + residual lo), keeping the large/common part exact and the small per-vertex part precise.

## Dual-path design (df mode vs normal mode)

- Elevation callback - implicitly dual-path, zero cost when unused. The compute pass always passes both the coarse `worldPosition` and the new `precise.*` (df) inputs into the user callback. TSL prunes graph nodes the final shader never references, so df builders only compile when the elevation function reads `precise.*`. No flag required; no overhead for f32 users.
- Normal-field reconstruction - library-controlled, needs an explicit flag. The df tangent path is selected by a build-time `precision: "f32" | "df64"` option (default "f32").

Mode flag:
- Add `precision: "f32" | "df64"` (default "f32") to projection configs (CubeSphereProjectionConfig, TorusProjectionConfig, flat).
- Build-time graph branch (df is structural, not a runtime uniform): changing it rebuilds the graph; it cannot be a live slider that toggles without a rebuild. Document this.
- In "f32" mode the normal builder keeps the current `pRight - pLeft` path; in "df64" it uses the df tangent path. Flag threaded via FieldNormalContext.

## Approach

Represent a high-precision scalar as { hi, lo } (both f32 nodes); a df vec is { hi: vecN, lo: vecN }. Add exact two-sum and Dekker split two-product primitives, build df add/sub/mul/div/length/normalize plus dfFloor/dfFract, and thread df coordinates from each projection into the elevation callback and the normal builder. Only the GPU compute path changes; CPU queries already run in f64 (JS numbers) and read back the baked field, so they need no noise duplication.

## Phase 0 - df64 TSL toolkit (packages/three/src/tsl/df64.ts, new)

- Types: DfFloat, DfVec2, DfVec3 as { hi, lo } plain objects (functions over classes, no module-scope state).
- Primitives: twoSum, split (constant 4097 = 2^12+1), twoProduct, then dfAdd, dfSub, dfMul, dfMulFloat, dfDiv.
- Vectors: dfVec3Add/Sub, dfVec3Scale, dfVec3Dot, dfVec3Length, dfVec3Normalize; dfVec2* equivalents.
- Noise helpers: dfFloor, dfFract (cell = floor(hi), residual from dfSub(p, cell)), dfFromFloat, dfToFloat.
- Build-time JS helper splitNumber(n) to df-encode constants like radius exactly.
- Export from packages/three/src/index.ts so example noise can consume it.
- Tests: numeric unit tests comparing df ops against JS f64 (no GPU needed); < ~1e-12 relative error for planet-scale inputs.

## Phase 1 - Precise df coordinates into the elevation callback (all projections)

- Extend ElevationParams in packages/three/src/tsl/elevation.ts with `precise: { worldPosition: DfVec3; direction: DfVec3 }` and pass through createElevationFunction. Keep coarse worldPosition; both always provided, df nodes pruned when unused.
- Add shared tileFaceUVDf to packages/three/src/gpu/tile.ts: df numerator dfAdd(tile.x, localU) then dfDiv by 2^level. Extend TileComputeParts/TileCompute with tileVertexWorldPositionDf and tileVertexDirectionDf.
- Populate precise in createElevation (packages/three/src/gpu/elevation-field.ts).
- Cube-sphere (projection/cubeSphere.ts): df cube point forward + (2u-1)right + (2v-1)up from df faceUV, dfVec3Normalize -> direction; worldPosition = rootOrigin + dir * radius in df.
- Flat (projection/flat.ts): df world XZ from df absolute grid coords (twoProduct(nodeX, innerSegments) + (ix-1), scaled, offset); direction = (0,1,0) constant.
- Torus (projection/torus.ts): df angles (u*2pi, v*2pi) from df faceUV; df tube point and df outward normal.

## Phase 2 - df-aware example noise (make the height fix visible)

- In apps/docs/src/examples/terrain/planetNoise.ts add perlinNoiseDf/fbmDf: take a DfVec3, per octave scale frequency with dfVec3Scale, derive integer lattice cell from dfFloor(hi) (hashing stays f32, cells small) and sub-cell from dfFract (full precision), interpolate in f32.
- Switch createPlanetElevation to consume precise.direction instead of worldPosition.normalize().
- Update flat FbmTerrainScene noise to key on precise.worldPosition for parity.

## Phase 3 - df64 normal reconstruction for curved surfaces (gated by mode)

- Thread the precision flag into FieldNormalContext (projection/types.ts) so createFieldNormal can branch.
- Add positionAtDf to DisplacedSurfaceFns and, in "df64" mode, compute tangents as dfSub(pRightDf, pLeftDf).hi in createDisplacedSurfaceNormalFromElevationField, eliminating the planet-radius cancellation. Sphere/torus supply positionAtDf = dirDf * (radius + h) with radius df-split at build time.
- In "f32" mode keep the existing pRight - pLeft path unchanged.
- Flat normal builder is well-conditioned and needs no change in either mode.

## Phase 4 - Docs, naming, and changelog

- Follow packages/three/spec/naming-conventions.md: keep *Df suffixes consistent and elevation* terminology.
- Update elevation/params docs (apps/docs/content/docs/docs/core/params.mdx, elevation reference) for precise.worldPosition / precise.direction and the df noise pattern; add a changelog.mdx entry.
- Note that maxLevel can now safely exceed ~14 on planet radii; keep the LOD cap as a guard but no longer the primary mitigation.

## Risks / notes

- two-product uses the Dekker split (no FMA dependency); verify the 4097 split path compiles in WGSL via TSL.
- df noise roughly doubles compute-pass cost (per field texel, not per render vertex). This is why precision is opt-in: "f32" + coarse inputs is the zero-overhead default; "df64" only when sub-meter close-ups matter.
- precision flag is build-time; toggling rebuilds the terrain graph. A live in-app toggle requires recreating the projection/terrain on change (acceptable for a leva control that already rebuilds on radius/invert).
- Validate visually in CubeSpherePlanetScene at maxLevel 16-18 with precision "df64": shards at ~0.6 m disappear and reappear only far below 1 m; confirm "f32" mode is unchanged.

## Checklist

- [ ] Phase 0: Add packages/three/src/tsl/df64.ts (two-sum/two-product, df add/sub/mul/div/length/normalize, dfFloor/dfFract, vec helpers, constants) + numeric unit tests; export from index.ts.
- [ ] Phase 1: Extend ElevationParams with precise.{worldPosition,direction} (tsl/elevation.ts) and pass through createElevationFunction; populate in gpu/elevation-field.ts createElevation.
- [ ] Phase 1: Add tileFaceUVDf shared helper and tileVertexWorldPositionDf/tileVertexDirectionDf to TileComputeParts/TileCompute in gpu/tile.ts.
- [ ] Phase 1: Implement df precise coordinates in flat.ts, cubeSphere.ts, torus.ts (df direction + df world position per projection).
- [ ] Phase 2: Add perlinNoiseDf/fbmDf to planetNoise.ts and switch createPlanetElevation to precise.direction; update flat FbmTerrainScene to precise.worldPosition.
- [ ] Phase 3: Add precision "f32" | "df64" (default f32) to projection configs and thread it into FieldNormalContext; document that it is build-time (rebuilds the graph).
- [ ] Phase 3: Add positionAtDf to DisplacedSurfaceFns and, in df64 mode, difference tangents in df inside createDisplacedSurfaceNormalFromElevationField; keep f32 path unchanged; wire sphere/torus df positionAt.
- [ ] Phase 4: Update params/elevation docs and changelog.mdx for the precise df API; note relaxed maxLevel guidance; keep naming-conventions alignment.