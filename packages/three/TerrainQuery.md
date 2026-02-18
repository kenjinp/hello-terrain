### Layer 3: Query API

Inspired by Terrain3D, expose a `TerrainFieldQuery` interface:

```typescript
interface TerrainFieldQuery {
  getHeight(x: number, z: number): number | null;
  getNormal(x: number, z: number): Vec3 | null;
  isInSlope(x: number, z: number, minDeg: number, maxDeg: number): boolean;
  getHeightRange(): { min: number; max: number };
  
  // Batch variant for scattering (avoids per-call overhead)
  getHeightBatch(positions: Float32Array, out: Float32Array): void;
}
```

- `getHeight` does bilinear interpolation between 4 surrounding vertices (matching Terrain3D's approach)
- `getNormal` samples `getHeight` at 4 cardinal offsets, computes cross product (matching [Terrain3D's get_normal](https://github.com/TokisanGames/Terrain3D/blob/main/src/terrain_3d_data.cpp))
- `isInSlope` computes slope angle from normal dot product with up vector
- `getHeightBatch` processes many positions efficiently for scattering
- Returns `null` when the position falls outside any active tile

### Layer 4: Task Integration

A new `terrainFieldQueryTask` wires it together:

```typescript
const terrainFieldQueryTask = task((get, work) => {
  const leafSet = get(quadtreeUpdateTask);
  const leafGpuBuffer = get(leafGpuBufferTask);
  const elevationField = get(createElevationFieldContextTask);
  const rootSizeVal = get(rootSize);
  const originVal = get(origin);
  const segments = get(innerTileSegments);
  const scale = get(elevationScale);
  
  return work(() => {
    return createTerrainFieldQuery({
      elevationData: elevationField.data,
      leafSet,
      leafCount: leafGpuBuffer.count,
      rootSize: rootSizeVal,
      origin: originVal,
      innerTileSegments: segments,
      elevationScale: scale,
    });
  });
});
```

Consumer usage:

```typescript
const query = graph.get(terrainFieldQueryTask);
const height = query.getHeight(playerX, playerZ);
const normal = query.getNormal(playerX, playerZ);

// Scattering
for (const point of scatterPoints) {
  const h = query.getHeight(point.x, point.z);
  if (h !== null && query.isInSlope(point.x, point.z, 0, 30)) {
    placeTree(point.x, h, point.z);
  }
}
```
