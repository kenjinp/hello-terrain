# Advanced Optimization Techniques

> Additional optimization strategies beyond storage compression and node buffer optimization.

---

## 1. GPU-Driven Rendering

### Indirect Draw Calls

Instead of CPU determining which tiles to render, let the GPU decide:

```typescript
// Current: CPU builds activeLeafIndices, uploads each frame
// Better: GPU compute shader fills indirect draw buffer

const cullComputeShader = Fn(() => {
  const nodeIndex = instanceIndex;
  const bounds = computeTileBounds(nodeIndex);
  
  // Frustum + occlusion test on GPU
  const visible = frustumTest(bounds).and(occlusionTest(bounds));
  
  If(visible, () => {
    // Atomically append to draw list
    const slot = atomicAdd(drawCount, 1);
    indirectBuffer.element(slot).assign(nodeIndex);
  });
});

// Single indirect draw call renders all visible tiles
renderer.renderIndirect(indirectBuffer);
```

**Benefits:**
- Eliminates CPU→GPU sync point
- Enables GPU occlusion culling
- Reduces draw call overhead

### Hi-Z Occlusion Culling

Use hierarchical depth buffer from previous frame:

```typescript
// 1. Build Hi-Z pyramid from depth buffer
const hiZPyramid = buildHiZPyramid(depthBuffer);

// 2. In cull shader, test tile bounds against Hi-Z
const occlusionTest = Fn(([bounds]) => {
  const screenBounds = projectToScreen(bounds);
  const mipLevel = computeMipLevel(screenBounds.size);
  const maxDepth = hiZPyramid.sample(screenBounds.center, mipLevel);
  return bounds.nearZ.lessThan(maxDepth);
});
```

---

## 2. Texture Optimization

### Compressed Texture Formats

Use GPU-native compressed formats for texture arrays:

| Format | Bits/Pixel | Ratio | Platform |
|--------|-----------|-------|----------|
| Uncompressed RGBA | 32 | 1:1 | All |
| **BC7** | 8 | **4:1** | Desktop |
| **ASTC 4x4** | 8 | **4:1** | Mobile |
| **BC5** (normals) | 8 | **4:1** | Desktop |

```typescript
// Load pre-compressed textures
const albedoArray = new CompressedArrayTexture(
  compressedData,
  1024, 1024, 32,
  THREE.RGBA_BPTC_Format  // BC7
);
```

**Savings for 32 textures @ 1024²:**
- Uncompressed: 32 × 4MB = **128 MB**
- BC7: 32 × 1MB = **32 MB** (75% reduction)

### Virtual Texturing / Texture Streaming

Only load texture mips that are actually visible:

```typescript
class VirtualTextureCache {
  private pageTable: DataTexture;      // Maps virtual → physical pages
  private physicalPages: DataArrayTexture;  // LRU cache of loaded pages
  
  // Feedback buffer: GPU writes which pages are needed
  analyzeFeedback(feedbackBuffer: Texture): PageRequest[] {
    // Scan feedback for requested pages not in cache
  }
  
  // Async load pages from disk/network
  async loadPages(requests: PageRequest[]): void {
    // Stream in highest priority pages
  }
}
```

### Texture LOD Bias

Reduce texture detail at distance:

```typescript
const textureLOD = Fn(([uv, distance]) => {
  // Bias mip level based on distance
  const lodBias = log2(distance.div(100.0)).clamp(0, 4);
  return textureArrayLod(albedoArray, uv, layerIndex, lodBias);
});
```

---

## 3. Geometry Optimization

### Shared Index Buffer

All tiles use the same grid topology—share one index buffer:

```typescript
// Current: Each tile may have its own geometry
// Better: Single shared index buffer for all tiles

class SharedTileGeometry {
  private static indexBuffer: Uint16Array;
  private static vertexCount: number;
  
  static initialize(segments: number) {
    // Generate indices once
    this.indexBuffer = generateGridIndices(segments);
    // All TerrainMesh instances share this
  }
}
```

### Tessellation Shaders (WebGPU Future)

Dynamic subdivision based on distance:

```wgsl
// Tessellation control shader
@tessellation_control
fn tess_control(@builtin(position) pos: vec4f) -> TessLevels {
  let distance = length(pos.xyz - cameraPos);
  let tessLevel = clamp(maxTess / distance, 1.0, maxTess);
  return TessLevels(tessLevel, tessLevel, tessLevel, tessLevel);
}
```

**Benefits:**
- Base mesh can be much coarser
- GPU handles subdivision
- Continuous LOD without popping

### Mesh Shaders (WebGPU Future)

Replace vertex + tessellation with unified mesh shader:

```wgsl
@mesh(workgroup_size = 32)
fn meshMain(...) {
  // Cull entire meshlet on GPU
  if (!frustumTest(meshletBounds)) {
    return;
  }
  
  // Generate vertices procedurally
  for (var i = 0u; i < verticesPerMeshlet; i++) {
    let height = sampleHeight(i);
    vertices[i] = computePosition(i, height);
  }
}
```

---

## 4. Compute Optimization

### Async Compute Pipeline

Overlap compute with rendering:

```typescript
// Frame N:
//   Render: tiles with data from frame N-1
//   Compute: generate data for frame N (async)

class AsyncTerrainCompute {
  private computeQueue: GPUQueue;  // Separate queue
  private renderQueue: GPUQueue;
  
  update() {
    // These run in parallel
    this.computeQueue.submit([heightmapCompute, normalmapCompute]);
    this.renderQueue.submit([renderPass]);
  }
}
```

### Workgroup Optimization

Tune workgroup size for target GPU:

```typescript
// Current: Fixed 8×8 workgroup
// Better: Profile and tune per-platform

const WORKGROUP_SIZE = detectOptimalWorkgroupSize();
// Desktop: 16×16 = 256 threads
// Mobile: 8×8 = 64 threads
// Tile-based: Match tile size (8×8 common)
```

### Incremental Updates

Only update changed regions:

```typescript
class IncrementalCompute {
  private dirtyRegions: Set<number> = new Set();
  
  markDirty(nodeIndex: number) {
    this.dirtyRegions.add(nodeIndex);
  }
  
  update(renderer: WebGPURenderer) {
    if (this.dirtyRegions.size === 0) return;
    
    // Only dispatch for dirty nodes
    const dirtyList = Array.from(this.dirtyRegions);
    renderer.computeAsync(heightmapCompute, dirtyList.length);
    
    this.dirtyRegions.clear();
  }
}
```

---

## 5. Memory Management

### Tile Pooling / Object Recycling

Reuse allocations instead of create/destroy:

```typescript
class TilePool {
  private available: TileData[] = [];
  private inUse: Map<number, TileData> = new Map();
  
  acquire(nodeIndex: number): TileData {
    const tile = this.available.pop() ?? new TileData();
    tile.reset();
    this.inUse.set(nodeIndex, tile);
    return tile;
  }
  
  release(nodeIndex: number) {
    const tile = this.inUse.get(nodeIndex);
    if (tile) {
      this.inUse.delete(nodeIndex);
      this.available.push(tile);
    }
  }
}
```

### Ring Buffer for Streaming

Fixed-size buffer with wraparound for streaming terrain:

```typescript
class StreamingHeightBuffer {
  private buffer: Float32Array;
  private capacity: number;
  private head = 0;
  
  // Allocate slot for new tile, evicting oldest if full
  allocate(size: number): { offset: number, evicted?: number } {
    if (this.head + size > this.capacity) {
      // Wrap around, evict old data
      this.head = 0;
    }
    const offset = this.head;
    this.head += size;
    return { offset };
  }
}
```

### Memory-Mapped Terrain Files

For huge terrains, memory-map from disk:

```typescript
// Node.js / Electron context
import { open } from 'fs/promises';

class MappedTerrainFile {
  private file: FileHandle;
  private mapping: Buffer;
  
  async open(path: string) {
    this.file = await open(path, 'r');
    // Map file directly to memory
    this.mapping = await this.file.read({ buffer: ... });
  }
  
  getHeightAt(x: number, z: number): number {
    const offset = (z * width + x) * 2;  // u16
    return this.mapping.readUInt16LE(offset) / 65535;
  }
}
```

---

## 6. Level-of-Detail Improvements

### Continuous LOD (CDLOD)

Smooth transitions without popping:

```typescript
const morphFactor = Fn(([distance, lodLevel]) => {
  const lodDistance = lodDistances.element(lodLevel);
  const nextLodDistance = lodDistances.element(lodLevel.add(1));
  
  // Smooth blend between LOD levels
  return smoothstep(lodDistance, nextLodDistance, distance);
});

// In vertex shader, morph between grid positions
const morphedHeight = mix(
  currentLodHeight,
  parentLodHeight,
  morphFactor
);
```

### Geomorphing

Vertex morphing to eliminate LOD pop:

```typescript
// Current vertex snaps to next LOD grid
const snapToParent = Fn(([localPos, morphFactor]) => {
  const parentGrid = floor(localPos.mul(0.5)).mul(2);
  return mix(localPos, parentGrid, morphFactor);
});
```

### Screen-Space Error Metric

Subdivide based on screen-space error, not just distance:

```typescript
function computeScreenError(node: Node, camera: Camera): number {
  const worldError = node.geometricError;  // Max height deviation
  const distance = node.bounds.distanceTo(camera.position);
  const screenHeight = camera.projectionMatrix.elements[5];
  
  // Project error to screen pixels
  return (worldError / distance) * screenHeight * viewportHeight;
}

function shouldSubdivide(node: Node, camera: Camera): boolean {
  return computeScreenError(node, camera) > MAX_SCREEN_PIXELS;
}
```

---

## 7. Shader Optimization

### Shader LOD

Simpler shaders at distance:

```typescript
const terrainColor = Fn(([distance]) => {
  return select(
    distance.lessThan(100),
    // Near: full PBR with normal maps, parallax, etc.
    fullPBRShading(),
    select(
      distance.lessThan(500),
      // Mid: simplified PBR, no parallax
      simplePBRShading(),
      // Far: basic diffuse only
      basicDiffuseShading()
    )
  );
});
```

### Branching Reduction

Replace conditionals with math:

```typescript
// Bad: Divergent branch
If(slope.greaterThan(0.7), () => {
  color.assign(rockColor);
}).Else(() => {
  color.assign(grassColor);
});

// Good: Branchless blend
const slopeFactor = smoothstep(0.6, 0.8, slope);
const color = mix(grassColor, rockColor, slopeFactor);
```

### Texture Fetch Reduction

Combine lookups where possible:

```typescript
// Bad: 4 separate texture fetches
const albedo = textureArray(albedoArr, uv, baseId);
const overlay = textureArray(albedoArr, uv, overlayId);
const baseNormal = textureArray(normalArr, uv, baseId);
const overlayNormal = textureArray(normalArr, uv, overlayId);

// Better: Fetch once, blend in registers
const baseData = textureArray(albedoArr, uv, baseId);
const overlayData = textureArray(albedoArr, uv, overlayId);
const blendedAlbedo = mix(baseData.rgb, overlayData.rgb, blend);
const blendedHeight = mix(baseData.a, overlayData.a, blend);
// Skip overlay normal fetch if blend < threshold
```

---

## 8. Network / Streaming

### Progressive Loading

Load coarse data first, refine progressively:

```typescript
class ProgressiveTerrainLoader {
  async load(url: string) {
    // 1. Load 64x64 preview (< 10KB)
    const preview = await fetch(`${url}?lod=6`);
    this.applyHeightmap(preview, 6);
    
    // 2. Load 256x256 medium (< 150KB)
    const medium = await fetch(`${url}?lod=4`);
    this.applyHeightmap(medium, 4);
    
    // 3. Load full resolution in background
    const full = await fetch(`${url}?lod=0`);
    this.applyHeightmap(full, 0);
  }
}
```

### Predictive Prefetching

Load tiles before they're needed:

```typescript
class PredictivePrefetcher {
  private velocity: Vector3 = new Vector3();
  
  update(camera: Camera, deltaTime: number) {
    // Predict camera position in 2 seconds
    const futurePos = camera.position.clone()
      .add(this.velocity.clone().multiplyScalar(2));
    
    // Find tiles that will be visible
    const futureTiles = this.quadtree.getTilesNear(futurePos);
    
    // Start loading tiles not yet in cache
    for (const tile of futureTiles) {
      if (!this.cache.has(tile)) {
        this.prefetch(tile);
      }
    }
  }
}
```

---

## Summary: Impact vs Complexity

| Technique | Memory | GPU Time | CPU Time | Complexity |
|-----------|--------|----------|----------|------------|
| Compressed textures (BC7) | ⬇️ 75% | — | — | Low |
| Indirect rendering | — | ⬇️ 20% | ⬇️ 50% | Medium |
| Hi-Z occlusion | — | ⬇️ 30-50% | — | Medium |
| Async compute | — | — | ⬇️ 30% | Medium |
| Tile pooling | ⬇️ GC | — | ⬇️ 10% | Low |
| Shader LOD | — | ⬇️ 20% | — | Low |
| Virtual texturing | ⬇️ 80%+ | — | ⬆️ 10% | High |
| CDLOD / Geomorphing | — | — | — | Medium |
| Mesh shaders | ⬇️ 30% | ⬇️ 40% | ⬇️ 80% | High* |

*Mesh shaders require WebGPU support that isn't available yet

---

## Recommended Priority

### Quick Wins (implement first)
1. **Compressed textures** — Easy, big memory savings
2. **Tile pooling** — Reduces GC pauses
3. **Shader LOD** — Simple distance-based simplification
4. **Incremental compute** — Only update what changed

### Medium Effort
5. **Indirect rendering** — Eliminates CPU sync
6. **CDLOD morphing** — Smoother LOD transitions
7. **Async compute** — Parallel with rendering

### Advanced (when needed)
8. **Hi-Z occlusion** — For dense terrain with occlusion
9. **Virtual texturing** — For 100+ textures or 4K+ resolution
10. **Mesh shaders** — When WebGPU adds support

