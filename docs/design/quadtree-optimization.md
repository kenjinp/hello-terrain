# Quadtree Node Buffer Optimization

> Memory layout optimization for quadtree node data. Achieves ~89% GPU memory reduction.

## Current Memory Layout

Based on 1000 max nodes:

| Buffer | Type | Per Node | Total | Sent to GPU? |
|--------|------|----------|-------|--------------|
| `nodeBuffer` | Int32Array | 16 bytes (level, x, y, active) | 16 KB | ✅ Yes |
| `childrenIndicesBuffer` | Uint16Array | 8 bytes (4 children) | 8 KB | ❌ CPU only |
| `neighborsIndicesBuffer` | Uint16Array | 8 bytes (4 neighbors) | 8 KB | ❌ CPU only |
| `leafNodeMask` | Uint8Array | 1 byte | 1 KB | ❌ CPU only |
| `activeLeafIndices` | Uint16Array | 2 bytes | 2 KB | ✅ Yes |
| **Total** | | | **35 KB** | **18 KB to GPU** |

---

## Problem: Redundant Data

The `nodeBuffer` stores:
```
[level: i32][x: i32][y: i32][active: i32] = 16 bytes per node
```

But:
- `level` only needs 5 bits (max 32 levels)
- `x` and `y` can be **computed from node index**
- `active` only needs 1 bit

---

## Key Insight: Position Is Implicit

For a quadtree, the position of each node is **deterministic** based on its index:

```
Breadth-first allocation:
Level 0: Node 0       → (0, 0)
Level 1: Nodes 1-4    → (0,0), (1,0), (0,1), (1,1)
Level 2: Nodes 5-20   → positions from Morton code
Level L: Nodes [(4^L-1)/3, (4^(L+1)-1)/3)
```

**The x, y values don't need to be stored at all!**

---

## Morton Code Encoding

In a breadth-first quadtree, the index within each level encodes the x, y position using Morton (Z-order) interleaving:

```
Morton code: interleave x and y bits
  x = 5 (binary: 101)
  y = 3 (binary: 011)
  
  morton = 0b_01_10_11 = 27
           ↑  ↑  ↑
           y₂ y₁ y₀ interleaved with x₂ x₁ x₀
```

### Position from Index

```typescript
function nodePositionFromIndex(nodeIndex: number): { level: number, x: number, y: number } {
  if (nodeIndex === 0) return { level: 0, x: 0, y: 0 };
  
  // Find level: level L has 4^L nodes, starting at index (4^L - 1) / 3
  let level = 0;
  let levelStart = 0;
  while (levelStart + (1 << (2 * level)) <= nodeIndex) {
    levelStart += 1 << (2 * level);
    level++;
  }
  
  // Index within level determines x, y via Morton decode
  const indexInLevel = nodeIndex - levelStart;
  const x = decodeMortonX(indexInLevel);
  const y = decodeMortonY(indexInLevel);
  
  return { level, x, y };
}

// Morton decode: extract even/odd bits
function decodeMortonX(morton: number): number {
  let x = morton & 0x55555555;
  x = (x | (x >> 1)) & 0x33333333;
  x = (x | (x >> 2)) & 0x0F0F0F0F;
  x = (x | (x >> 4)) & 0x00FF00FF;
  x = (x | (x >> 8)) & 0x0000FFFF;
  return x;
}
```

---

## Optimized Storage Options

| Option | Per Node | 1000 Nodes | Notes |
|--------|----------|------------|-------|
| **Current** | 16 bytes | 16 KB | level, x, y, active as i32 |
| **Packed u16** | 2 bytes | 2 KB | level + leaf + quadrant packed |
| **Level + leaf** | 1 byte | 1 KB | Compute x,y from index |
| **Leaf mask only** | 1 bit | 125 bytes | Everything computed |

### Packed u16 Layout

```typescript
/**
 * Packed Node Data (16 bits):
 * 
 * | Bits  | Field     | Range   | Description                |
 * |-------|-----------|---------|----------------------------|
 * | 15-11 | Level     | 0-31    | Quadtree depth level       |
 * | 10    | IsLeaf    | 0-1     | Whether node is a leaf     |
 * | 9-8   | Quadrant  | 0-3     | Which child of parent      |
 * | 7-0   | Reserved  | —       | Future use (LOD bias, etc) |
 */
```

---

## Recommended: Eliminate nodeBuffer from GPU

The GPU shaders only need:
1. `level` — to compute tile size (`rootSize / 2^level`)
2. `x, y` — to compute tile origin
3. `isLeaf` — to skip non-leaf nodes (already handled by `activeLeafIndices`)

**If we compute level and position from index in the shader**, we only need:

```typescript
// GPU receives ONLY:
activeLeafIndices: Uint16Array  // indices of leaf nodes to render

// Everything else computed in vertex shader:
const level = computeLevelFromIndex(nodeIndex);
const tilePos = computePositionFromIndex(nodeIndex, level);
const tileSize = rootSize / pow(2.0, float(level));
```

---

## TSL Implementation

```typescript
// packages/hello-terrain/three/src/nodes/tileFromIndex.ts

import { Fn, int, float, vec2, select } from "three/tsl";

/**
 * Compute quadtree level from node index (breadth-first order)
 * Level 0: index 0
 * Level 1: indices 1-4
 * Level 2: indices 5-20
 * Level L: indices [(4^L-1)/3, (4^(L+1)-1)/3)
 */
export const computeLevelFromIndex = Fn(([nodeIndex]: [ShaderNodeObject<Node>]) => {
  const idx = nodeIndex.toInt();
  
  // Binary search for level (max 16 levels = 4B nodes)
  let level = int(0);
  let levelStart = int(0);
  let levelSize = int(1);
  
  // Unrolled loop for efficiency
  for (let i = 0; i < 16; i++) {
    const nextLevelStart = levelStart.add(levelSize);
    const inThisLevel = idx.lessThan(nextLevelStart);
    level = select(inThisLevel, level, level.add(int(1)));
    levelStart = select(inThisLevel, levelStart, nextLevelStart);
    levelSize = levelSize.mul(int(4));
  }
  
  return level;
});

/**
 * Compute x, y position from node index using Morton decoding
 */
export const computePositionFromIndex = Fn(
  ([nodeIndex, level]: [ShaderNodeObject<Node>, ShaderNodeObject<Node>]) => {
    const idx = nodeIndex.toInt();
    
    // Compute level start: (4^level - 1) / 3
    const levelSize = int(1).shiftLeft(level.mul(int(2)));
    const levelStart = levelSize.sub(int(1)).div(int(3));
    
    // Index within this level
    const indexInLevel = idx.sub(levelStart);
    
    // Morton decode: X gets even bits, Y gets odd bits
    const x = decodeMortonComponent(indexInLevel, int(0));
    const y = decodeMortonComponent(indexInLevel, int(1));
    
    return vec2(x.toFloat(), y.toFloat());
  }
);

const decodeMortonComponent = Fn(
  ([morton, component]: [ShaderNodeObject<Node>, ShaderNodeObject<Node>]) => {
    // Shift by component (0 for X, 1 for Y) then mask alternating bits
    let v = morton.shiftRight(component);
    v = v.bitAnd(int(0x55555555));
    v = v.bitOr(v.shiftRight(int(1))).bitAnd(int(0x33333333));
    v = v.bitOr(v.shiftRight(int(2))).bitAnd(int(0x0F0F0F0F));
    v = v.bitOr(v.shiftRight(int(4))).bitAnd(int(0x00FF00FF));
    v = v.bitOr(v.shiftRight(int(8))).bitAnd(int(0x0000FFFF));
    return v;
  }
);
```

---

## Memory Savings

| Component | Current | Optimized | Savings |
|-----------|---------|-----------|---------|
| nodeBuffer to GPU | 16 KB | **0 KB** | 16 KB (100%) |
| activeLeafIndices | 2 KB | 2 KB | — |
| **GPU total** | **18 KB** | **2 KB** | **89%** |

---

## Trade-offs

### ALU vs Memory Bandwidth

Computing position from index costs **~30 ALU operations**:
- `computeLevelFromIndex`: ~10 ops (unrolled binary search)
- `computePositionFromIndex`: ~20 ops (Morton decode)

### When This Trade-off Makes Sense

| Scenario | Recommendation |
|----------|---------------|
| Mobile/low-end GPU | Consider keeping nodeBuffer |
| Desktop GPU | Use computation (bandwidth limited) |
| Many nodes (>10K) | Definitely use computation |
| Few nodes (<100) | Either approach is fine |

For terrain rendering where **memory bandwidth is often the bottleneck**, saving 16 KB per frame is worth 30 ALU ops.

---

## Integration

The current code already uses `activeLeafIndices` for GPU instancing:

```typescript
// Existing pattern in tile.ts
const nodeIndex = int(activeLeafIndicesStorageProperty.element(instanceIndex));
```

To use Morton-based position:

```typescript
// Replace this:
const level = nodeStorageProperty.element(nodeIndex.mul(4));
const tileX = nodeStorageProperty.element(nodeIndex.mul(4).add(1));
const tileY = nodeStorageProperty.element(nodeIndex.mul(4).add(2));

// With this:
const level = computeLevelFromIndex(nodeIndex);
const tilePos = computePositionFromIndex(nodeIndex, level);
const tileX = tilePos.x;
const tileY = tilePos.y;
```

---

## Requirements

For this optimization to work, nodes must be allocated in **breadth-first order**:

```
Index:  0  | 1  2  3  4 | 5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 | ...
Level:  0  |     1      |                    2                           | ...
```

This is the natural allocation order for a quadtree built top-down.

---

## CPU-Side Considerations

The CPU still needs `nodeBuffer` for:
- Quadtree traversal and subdivision
- Finding nodes by position
- Neighbor lookups

This optimization only eliminates the **GPU copy** of node data. The CPU-side `nodeBuffer` remains unchanged.

