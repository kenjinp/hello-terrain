# Storage Compression Strategies

> Memory optimization for terrain storage buffers. Achieves ~72% overall reduction.

## Current Memory Usage

Based on 61 segments per tile, 1000 max nodes:

| Storage | Current Format | Per Vertex | Total Size |
|---------|---------------|------------|------------|
| heightmapStorage | `f32` | 4 bytes | 16.4 MB |
| normalmapStorage | `f32×3` | 12 bytes | 49.2 MB |
| controlmapStorage | `u32` | 4 bytes | 16.4 MB |
| **Total** | | **20 bytes** | **82 MB** |

---

## Compression Techniques

### 1. Normal Map: Octahedral Encoding

**Reduction: 12 bytes → 2 bytes (83%)**

Unit normals only have 2 degrees of freedom. Octahedral encoding maps the unit sphere to a 2D square:

```typescript
// Encoding (compute shader)
function encodeNormalOctahedral(n: vec3): vec2 {
  // Project onto octahedron
  const p = vec2(n.x, n.y).div(abs(n.x) + abs(n.y) + abs(n.z));
  // Fold bottom hemisphere
  return n.z < 0 
    ? vec2(1 - abs(p.y), 1 - abs(p.x)).mul(sign(p))
    : p;
}
```

```typescript
// Decoding (fragment shader TSL)
export const decodeOctahedralNormal = Fn(([packed]: [ShaderNodeObject<Node>]) => {
  // Unpack i8×2 from i16
  const lo = packed.bitAnd(int(0xFF)).toFloat().div(127.0).sub(1.0);
  const hi = packed.shiftRight(int(8)).bitAnd(int(0xFF)).toFloat().div(127.0).sub(1.0);
  
  const encoded = vec2(lo, hi);
  const n = vec3(
    encoded.x, 
    encoded.y, 
    float(1).sub(abs(encoded.x)).sub(abs(encoded.y))
  );
  
  // Fold for bottom hemisphere
  const t = max(n.z.negate(), float(0));
  return vec3(
    n.x.add(select(n.x.greaterThanEqual(0), t.negate(), t)),
    n.y.add(select(n.y.greaterThanEqual(0), t.negate(), t)),
    n.z
  ).normalize();
});
```

**Storage format**: `i8×2` packed into `i16` (2 bytes)

```typescript
const normalmapStorage = new StorageBuffer(
  "normalmapStorage",
  new Int16Array(heightmapDimensions),  // Was Float32Array × 3
  1,
  heightmapDimensions
);
```

| | Before | After | Savings |
|--|--------|-------|---------|
| normalmapStorage | 49.2 MB | **8.2 MB** | 41 MB (83%) |

---

### 2. Heightmap: Half-Precision Float

**Reduction: 4 bytes → 2 bytes (50%)**

Heights don't need full f32 precision. WebGPU supports f16 natively.

**Option A: Half-precision float (f16)**
```typescript
const heightmapStorage = new StorageBuffer(
  "heightmapStorage",
  new Uint16Array(heightmapDimensions),  // f16 as u16 bits
  1,
  heightmapDimensions
);

// In compute shader, write as f16
heightmapStorage.storageNode.element(idx).assign(height.toHalf());

// In vertex shader, read and convert
const height = heightmapStorageProperty.element(idx).toFloat();
```

**Option B: Normalized u16 with tile-local range**
```typescript
// Per-tile min/max stored in nodeStorage
const heightU16 = (height - tileMinHeight) / (tileMaxHeight - tileMinHeight) * 65535;

// In shader:
const heightNorm = heightmapStorage.element(idx).toFloat().div(65535.0);
const height = tileMinHeight.add(heightNorm.mul(tileMaxHeight.sub(tileMinHeight)));
```

| | Before | After | Savings |
|--|--------|-------|---------|
| heightmapStorage | 16.4 MB | **8.2 MB** | 8.2 MB (50%) |

---

### 3. Control Map: Compact Bit Packing

**Reduction: 4 bytes → 2 bytes (50%)**

Current 32-bit layout has unused bits. Essentials fit in 16 bits:

```
16-bit Control Layout:
| Bits  | Field           | Range  | Description                    |
|-------|-----------------|--------|--------------------------------|
| 15-11 | Base Texture ID | 0-31   | Primary texture index          |
| 10-6  | Overlay Tex ID  | 0-31   | Secondary texture index        |
| 5-0   | Blend Factor    | 0-63   | Blend weight (6-bit, 64 levels)|
```

```typescript
export const ControlDataPackerCompact = {
  pack(data: ControlData): number {
    return (
      ((data.baseTextureId & 0x1F) << 11) |
      ((data.overlayTextureId & 0x1F) << 6) |
      (Math.round(data.blend / 4) & 0x3F)  // 256 → 64 levels
    );
  },
  unpack(packed: number): ControlData {
    return {
      baseTextureId: (packed >> 11) & 0x1F,
      overlayTextureId: (packed >> 6) & 0x1F,
      blend: ((packed & 0x3F) * 4),  // Scale back to 0-252
    };
  },
};

const controlmapStorage = new StorageBuffer(
  "controlmapStorage",
  new Uint16Array(controlmapDimensions),  // Was Uint32Array
  1,
  controlmapDimensions
);
```

| | Before | After | Savings |
|--|--------|-------|---------|
| controlmapStorage | 16.4 MB | **8.2 MB** | 8.2 MB (50%) |

---

### 4. Skirt Vertex Strategy

**Important architectural consideration**: The skirt vertices in heightmap serve a critical purpose—they overlap with neighboring tiles, enabling **seamless normal computation without cross-tile sampling**:

```
Tile A (with skirt)              Tile B (with skirt)
┌─────────────────┐              ┌─────────────────┐
│ S  S  S  S  S  S│←─overlaps───→│S  S  S  S  S  S │
│ S  I  I  I  I  S│              │S  I  I  I  I  S │
│ S  I  I  I  I  S│              │S  I  I  I  I  S │
│ S  I  I  I  I  S│              │S  I  I  I  I  S │
│ S  S  S  S  S  S│              │S  S  S  S  S  S │
└─────────────────┘              └─────────────────┘
        ↑
    Skirt samples neighbor's heights
    → Normal calculation uses these for finite differences
    → No need to know neighbor tile indices!
```

From the normalmap compute shader:
```typescript
// Neighbor indices INCLUDING skirt ring for central differences at inner edges
const uLeft = max(uVertexIndex.sub(int(1)), int(0));
const uRight = min(uVertexIndex.add(int(1)), lastVertexIndex);
```

**Per-buffer skirt strategy:**

| Buffer | Keep Skirts? | Reason |
|--------|-------------|--------|
| **heightmapStorage** | ✅ Yes | Required for seamless normal computation |
| **normalmapStorage** | ⚠️ Optional | Skirt normals = adjacent inner normals |
| **controlmapStorage** | ❌ No | Skirts inherit from inner ring |

**Compact control storage (skip skirt ring):**

```typescript
const innerVertexCount = (tileEdgeVertexCount - 2);  // 62 instead of 64
const controlmapDimensions = maxNodes * innerVertexCount * innerVertexCount;

// In fragment shader, clamp to inner range
const innerVx = localVx.clamp(1, innerEdge).sub(1);
const innerVy = localVy.clamp(1, innerEdge).sub(1);
```

| Buffer | With Skirts | Without Skirts | Savings |
|--------|------------|----------------|---------|
| controlmapStorage | 16.4 MB | **14.8 MB** | 10% |
| normalmapStorage | 8.2 MB | **7.4 MB** | 10% |

---

### 5. Sparse/Virtual Control Data

For procedural terrain where most vertices share the same texture:

```typescript
interface SparseControlMap {
  // Default for entire node
  nodeDefaults: Map<nodeIndex, ControlData>;
  
  // Sparse overrides only where painted
  overrides: Map<globalVertexIndex, ControlData>;
}
```

Potential reduction: **90%+** for procedural terrain.

---

## Summary

| Storage | Current | Compressed | Technique |
|---------|---------|------------|-----------|
| heightmapStorage | 16.4 MB | **8.2 MB** | f16 (keep skirts) |
| normalmapStorage | 49.2 MB | **7.4 MB** | Octahedral i8×2 + skip skirts |
| controlmapStorage | 16.4 MB | **7.4 MB** | u16 packed + skip skirts |
| **Total** | **82 MB** | **23 MB** | **72% reduction** |

---

## Implementation Classes

```typescript
// packages/hello-terrain/three/src/compute/CompressedStorage.ts

export class HeightmapStorageF16 extends StorageBuffer {
  constructor(maxNodes: number, tileEdgeVertexCount: number) {
    const verticesPerNode = tileEdgeVertexCount * tileEdgeVertexCount;
    const totalVertices = maxNodes * verticesPerNode;
    super("heightmapStorage", new Uint16Array(totalVertices), 1, totalVertices);
  }
}

export class NormalmapStorageOctahedral extends StorageBuffer {
  constructor(maxNodes: number, tileEdgeVertexCount: number) {
    const verticesPerNode = tileEdgeVertexCount * tileEdgeVertexCount;
    const totalVertices = maxNodes * verticesPerNode;
    super("normalmapStorage", new Int16Array(totalVertices), 1, totalVertices);
  }
}
```

### Compute Shader: Encode Normals

```typescript
const encodeOctahedral = Fn(([normal]: [ShaderNodeObject<Node>]) => {
  const n = normal.normalize();
  const sum = abs(n.x).add(abs(n.y)).add(abs(n.z));
  const p = vec2(n.x, n.y).div(sum);
  
  // Fold for bottom hemisphere
  const folded = select(
    n.z.lessThan(0),
    vec2(
      float(1).sub(abs(p.y)).mul(sign(p.x)),
      float(1).sub(abs(p.x)).mul(sign(p.y))
    ),
    p
  );
  
  // Pack to i8×2 in i16
  const lo = folded.x.add(1).mul(127).floor().toInt().bitAnd(int(0xFF));
  const hi = folded.y.add(1).mul(127).floor().toInt().bitAnd(int(0xFF));
  return lo.bitOr(hi.shiftLeft(int(8)));
});
```

---

## Performance Trade-offs

| Technique | Complexity | Performance Impact |
|-----------|------------|-------------------|
| f16 heights | Low | None (native WebGPU) |
| Octahedral normals | Medium | ~4 ALU ops to decode |
| u16 control | Low | None |
| Skip skirts | Medium | Index remapping |

**Why keep heightmap skirts**: The skirt ring samples heights from where neighboring tiles would be. This allows the normal compute shader to use finite differences at tile edges without any cross-tile communication—each tile computes normals independently while producing seamless results.

