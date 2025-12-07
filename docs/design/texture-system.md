# 32-Texture Terrain System

> Multi-texture terrain painting system for WebGPU, inspired by [Godot's Terrain3D](https://terrain3d.readthedocs.io/en/stable/docs/shader_design.html).

## Overview

### Goals

1. **Support up to 32 texture sets** per terrain, each containing:
   - Albedo (RGB) + Height (A)
   - Normal (RGB) + Roughness (A)

2. **Memory efficient** — Use index/control maps instead of splatmaps (~93% VRAM reduction)

3. **WebGPU native** — Leverage `texture_2d_array` for single-sampler access to all textures

4. **Seamless integration** — Work with existing quadtree LOD, compute shaders, and elevation system

5. **Leverage existing node system** — Follow the per-node storage buffer pattern used by heightmap/normalmap

---

## Architecture

### Key Insight: Per-Node Storage Pattern

The existing `TerrainMesh` uses a powerful pattern we can leverage:

```
┌─────────────────────────────────────────────────────────────────┐
│                 Existing Storage Buffer Pattern                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  heightmapStorage[maxNodes × verticesPerNode]                   │
│  ├── Node 0: [v0, v1, v2, ..., v255]                            │
│  ├── Node 1: [v0, v1, v2, ..., v255]                            │
│  └── Node N: [v0, v1, v2, ..., v255]                            │
│                                                                  │
│  normalmapStorage[maxNodes × verticesPerNode × 3]               │
│  ├── Node 0: [(nx,ny,nz)₀, (nx,ny,nz)₁, ...]                    │
│  └── ...                                                         │
│                                                                  │
│  activeLeafIndicesStorage[maxNodes] → GPU indirection           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**We follow the exact same pattern for control data:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    NEW: Control Storage Pattern                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  controlmapStorage[maxNodes × verticesPerNode]  (u32 packed)    │
│  ├── Node 0: [ctrl₀, ctrl₁, ctrl₂, ..., ctrl₂₅₅]               │
│  ├── Node 1: [ctrl₀, ctrl₁, ctrl₂, ..., ctrl₂₅₅]               │
│  └── Node N: [ctrl₀, ctrl₁, ctrl₂, ..., ctrl₂₅₅]               │
│                                                                  │
│  Each ctrl = 32-bit packed: baseId|overlayId|blend|flags        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Benefits of Per-Node Control Storage

| Benefit | Description |
|---------|-------------|
| **LOD-aware precision** | Higher detail nodes (closer to camera) get more paint vertices |
| **Unified compute pattern** | Same `ComputeToBufferMap` used for height/normal works for control |
| **GPU indirection** | Uses existing `activeLeafIndicesStorage` for optimized dispatch |
| **Dynamic updates** | Only recompute control for changed/visible nodes |
| **Memory efficient** | No global texture needed; data lives only in active nodes |

### Comparison: Global Texture vs Per-Node Storage

| Aspect | Global Control Texture | Per-Node Storage (Chosen) |
|--------|----------------------|---------------------------|
| **Memory** | Fixed size regardless of LOD | Scales with active nodes |
| **LOD awareness** | Same resolution everywhere | Higher detail near camera |
| **Compute pattern** | Different from height/normal | Same as height/normal ✓ |
| **GPU indirection** | Separate UV calculation | Uses existing `vGlobalVertexIndex` ✓ |
| **Painting** | Requires UV → texel mapping | Direct vertex index |
| **Seamless with quadtree** | No | Yes ✓ |

---

## Data Structures

### 1. Texture Arrays (GPU)

WebGPU supports `texture_2d_array` natively, allowing all 32 textures to be accessed through a single sampler with layer indexing.

```typescript
// packages/hello-terrain/three/src/texture/TerrainTextureArray.ts

import { DataArrayTexture, RGBAFormat, UnsignedByteType } from "three/webgpu";

export interface TextureSetOptions {
  /** Texture resolution (must be power of 2, same for all textures) */
  resolution: number;
  /** Maximum number of texture sets (default: 32) */
  maxTextures?: number;
  /** Enable mipmaps for texture arrays */
  generateMipmaps?: boolean;
}

export class TerrainTextureArray {
  /** Albedo (RGB) + Height (A) texture array */
  readonly albedoHeightArray: DataArrayTexture;
  
  /** Normal (RGB) + Roughness (A) texture array */
  readonly normalRoughnessArray: DataArrayTexture;
  
  /** Number of texture sets currently loaded */
  private textureCount = 0;
  
  constructor(options: TextureSetOptions) {
    const { resolution, maxTextures = 32, generateMipmaps = true } = options;
    
    // Pre-allocate arrays with maxTextures depth
    const pixelCount = resolution * resolution * 4 * maxTextures;
    
    this.albedoHeightArray = new DataArrayTexture(
      new Uint8Array(pixelCount),
      resolution,
      resolution,
      maxTextures
    );
    this.albedoHeightArray.format = RGBAFormat;
    this.albedoHeightArray.type = UnsignedByteType;
    this.albedoHeightArray.generateMipmaps = generateMipmaps;
    
    this.normalRoughnessArray = new DataArrayTexture(
      new Uint8Array(pixelCount),
      resolution,
      resolution,
      maxTextures
    );
    this.normalRoughnessArray.format = RGBAFormat;
    this.normalRoughnessArray.type = UnsignedByteType;
    this.normalRoughnessArray.generateMipmaps = generateMipmaps;
  }
  
  /**
   * Add a texture set to the array
   * @returns Layer index (0-31) for this texture set
   */
  addTextureSet(
    albedo: ImageData,
    normal: ImageData,
    height: ImageData,
    roughness: ImageData
  ): number {
    const layerIndex = this.textureCount++;
    
    this.packIntoLayer(this.albedoHeightArray, layerIndex, albedo, height);
    this.packIntoLayer(this.normalRoughnessArray, layerIndex, normal, roughness);
    
    return layerIndex;
  }
  
  private packIntoLayer(
    target: DataArrayTexture,
    layer: number,
    rgb: ImageData,
    alpha: ImageData
  ): void {
    // Implementation packs RGB from first image, A from second
  }
}
```

### 2. Control Storage (Per-Node, GPU)

```typescript
// packages/hello-terrain/three/src/compute/ControlStorage.ts

/**
 * Control Data Bit Layout (32 bits per vertex):
 * 
 * | Bits   | Field            | Range    | Description                    |
 * |--------|------------------|----------|--------------------------------|
 * | 31-27  | Base Texture ID  | 0-31     | Primary texture index          |
 * | 26-22  | Overlay Tex ID   | 0-31     | Secondary texture index        |
 * | 21-14  | Blend Factor     | 0-255    | Blend weight (0=base, 255=over)|
 * | 13-10  | UV Scale         | 0-15     | Texture repeat multiplier      |
 * | 9-6    | UV Rotation      | 0-15     | Rotation in 22.5° increments   |
 * | 5      | Auto-shader      | 0-1      | Enable slope-based texturing   |
 * | 4      | Navigation       | 0-1      | Navigable surface flag         |
 * | 3      | Hole             | 0-1      | Render hole (discard pixel)    |
 * | 2-0    | Reserved         | —        | Future use                     |
 */

export interface ControlData {
  baseTextureId: number;    // 0-31
  overlayTextureId: number; // 0-31  
  blend: number;            // 0-255
  uvScale?: number;         // 0-15
  uvRotation?: number;      // 0-15
  autoShader?: boolean;
  navigation?: boolean;
  hole?: boolean;
}

export const ControlDataPacker = {
  pack(data: ControlData): number {
    let packed = 0;
    packed |= (data.baseTextureId & 0x1F) << 27;
    packed |= (data.overlayTextureId & 0x1F) << 22;
    packed |= (data.blend & 0xFF) << 14;
    packed |= ((data.uvScale ?? 0) & 0x0F) << 10;
    packed |= ((data.uvRotation ?? 0) & 0x0F) << 6;
    packed |= (data.autoShader ? 1 : 0) << 5;
    packed |= (data.navigation ? 1 : 0) << 4;
    packed |= (data.hole ? 1 : 0) << 3;
    return packed;
  },
  
  unpack(packed: number): ControlData {
    return {
      baseTextureId: (packed >> 27) & 0x1F,
      overlayTextureId: (packed >> 22) & 0x1F,
      blend: (packed >> 14) & 0xFF,
      uvScale: (packed >> 10) & 0x0F,
      uvRotation: (packed >> 6) & 0x0F,
      autoShader: ((packed >> 5) & 0x01) === 1,
      navigation: ((packed >> 4) & 0x01) === 1,
      hole: ((packed >> 3) & 0x01) === 1,
    };
  },
};
```

---

## Shader Implementation

### TSL Control Data Nodes

The existing vertex shader already computes `vGlobalVertexIndex`. We sample control storage at the same index:

```typescript
// packages/hello-terrain/three/src/nodes/controlData.ts

import { Fn, float, int, select, type ShaderNodeObject } from "three/tsl";
import type { Node } from "three/webgpu";
import { controlmapStorageProperty } from "../compute/ControlStorage";
import type { TerrainVaryings } from "../TerrainVaryings";

/**
 * Decode control data from packed u32
 */
export const decodeControlData = Fn(([packed]: [ShaderNodeObject<Node>]) => {
  const packedInt = packed.toInt();
  
  const baseId = packedInt.shiftRight(int(27)).bitAnd(int(0x1F));
  const overlayId = packedInt.shiftRight(int(22)).bitAnd(int(0x1F));
  const blend = packedInt.shiftRight(int(14)).bitAnd(int(0xFF)).toFloat().div(255.0);
  const uvScale = packedInt.shiftRight(int(10)).bitAnd(int(0x0F)).toFloat().add(1.0);
  const autoShader = packedInt.shiftRight(int(5)).bitAnd(int(0x01)).equal(int(1));
  const hole = packedInt.shiftRight(int(3)).bitAnd(int(0x01)).equal(int(1));
  
  return { baseId, overlayId, blend, uvScale, autoShader, hole };
});

/**
 * Read control data at current vertex using vGlobalVertexIndex
 */
export const createReadControlAtVertex = (varyings: TerrainVaryings) =>
  Fn(() => {
    const globalVertexIndex = varyings.vGlobalVertexIndex;
    const packed = controlmapStorageProperty.element(globalVertexIndex);
    return decodeControlData(packed);
  });
```

### Texture Array Sampling

```typescript
// packages/hello-terrain/three/src/nodes/textureArraySampling.ts

import { Fn, float, texture, vec3, mix, type ShaderNodeObject } from "three/tsl";
import type { DataArrayTexture, Node } from "three/webgpu";

/**
 * Sample from texture array with layer index
 */
export const sampleTextureArray = Fn(([
  textureArr,
  uv,
  layerIndex,
]: [DataArrayTexture, ShaderNodeObject<Node>, ShaderNodeObject<Node>]) => {
  return texture(textureArr, vec3(uv.x, uv.y, layerIndex.toFloat()));
});

/**
 * Height-based blending for natural texture transitions
 */
export const heightBlend = Fn(([
  baseColor, overlayColor, baseHeight, overlayHeight, blendFactor, sharpness,
]: ShaderNodeObject<Node>[]) => {
  const depth = float(0.2);
  const baseBlendHeight = baseHeight.add(float(1).sub(blendFactor).mul(depth));
  const overlayBlendHeight = overlayHeight.add(blendFactor.mul(depth));
  
  const blendMask = overlayBlendHeight
    .sub(baseBlendHeight)
    .mul(sharpness)
    .add(float(0.5))
    .clamp(0, 1);
  
  return mix(baseColor, overlayColor, blendMask);
});

/**
 * Slope-based auto-texturing
 */
export const slopeBlend = Fn(([
  baseColor, slopeColor, normal, threshold, blend,
]: ShaderNodeObject<Node>[]) => {
  const slope = float(1).sub(normal.y);
  const slopeFactor = slope.sub(threshold).div(blend).clamp(0, 1);
  return mix(baseColor, slopeColor, slopeFactor);
});
```

### Main Terrain Color Node

```typescript
// packages/hello-terrain/three/src/nodes/terrainTextureMaterial.ts

export const createTerrainColorNode = (params: TerrainTextureMaterialParams) => {
  const { varyings, textureArray, textureScale = 10, heightBlendSharpness = 4 } = params;
  const readControl = createReadControlAtVertex(varyings);
  
  return Fn(() => {
    const control = readControl();
    const worldPos = positionWorld;
    const textureUV = worldPos.xz.div(float(textureScale));
    const scaledUV = textureUV.mul(control.uvScale);
    
    // Sample base and overlay textures
    const baseSample = sampleTextureArray(textureArray.albedoHeightArray, scaledUV, control.baseId);
    const overlaySample = sampleTextureArray(textureArray.albedoHeightArray, scaledUV, control.overlayId);
    
    // Height-based blend
    const blendedColor = heightBlend(
      baseSample.rgb, overlaySample.rgb,
      baseSample.a, overlaySample.a,
      control.blend, float(heightBlendSharpness)
    );
    
    // Handle holes
    return vec4(blendedColor, select(control.hole, float(0), float(1)));
  })();
};
```

---

## Integration with TerrainMesh

```typescript
// Additions to TerrainMesh.ts

private initializeStorage() {
  // ... existing storage init ...
  
  // NEW: Control storage follows same pattern
  const controlmapDimensions = computeTextureWidth * computeTextureHeight;
  const defaultPacked = ControlDataPacker.pack({
    baseTextureId: this.params.defaultTextureId ?? 0,
    overlayTextureId: 0,
    blend: 0,
  });
  const controlmapStorage = new StorageBuffer(
    "controlmapStorage",
    new Uint32Array(controlmapDimensions).fill(defaultPacked),
    1,
    controlmapDimensions
  );
  
  controlmapStorageProperty.value = controlmapStorage.storageBufferAttribute;
  this.controlmapStorage = controlmapStorage;
}

/**
 * Paint texture at world position
 */
paintAt(params: {
  worldX: number;
  worldZ: number;
  textureId: number;
  brushRadius: number;
  strength: number;
  asOverlay?: boolean;
}): void {
  // Find affected nodes and update control storage buffer
  // See full implementation in main design doc
}
```

---

## Memory Comparison

| Approach | Per-Pixel Cost | 4K Terrain | Texture Samples |
|----------|---------------|------------|-----------------|
| **Splatmaps (32 tex)** | 32 bytes | **512 MB** | 12-16 |
| **Index Map (32 tex)** | ~4 bytes | **~64 MB** | 5-12 |
| **Reduction** | 8× | **~448 MB saved** | 25-60% fewer |

---

## File Structure

```
packages/hello-terrain/three/src/
├── texture/
│   ├── TerrainTextureArray.ts    # 2D array texture management
│   └── TextureSetLoader.ts       # Async loading + RGBA packing
├── nodes/
│   ├── controlData.ts            # Control data decode/read nodes
│   ├── textureArraySampling.ts   # Texture array sampling + blending
│   └── terrainTextureMaterial.ts # Complete material node factories
├── compute/
│   ├── ControlStorage.ts         # Per-node control storage
│   └── ControlmapCompute.ts      # Procedural/painting compute shader
```

---

## Usage Example

```tsx
const TexturedTerrain = () => {
  const [terrain, setTerrain] = useState<TerrainMesh | null>(null);
  
  useEffect(() => {
    if (!terrain) return;
    
    const grassId = terrain.addTextureSet(grassAlbedo, grassNormal, grassHeight, grassRoughness);
    const rockId = terrain.addTextureSet(rockAlbedo, rockNormal, rockHeight, rockRoughness);
    
    terrain.paintAt({ worldX: 100, worldZ: 50, textureId: rockId, brushRadius: 20, strength: 0.8 });
  }, [terrain]);
  
  const colorNode = useMemo(() => terrain && createTerrainColorNode({
    uniforms: terrain.uniforms,
    varyings: terrain.varyings,
    textureArray: terrain.textureArray,
  }), [terrain]);
  
  return (
    <hello.TerrainMesh ref={setTerrain} {...props}>
      {terrain && <meshStandardNodeMaterial colorNode={colorNode} />}
    </hello.TerrainMesh>
  );
};
```

---

## References

- [Godot Terrain3D Shader Design](https://terrain3d.readthedocs.io/en/stable/docs/shader_design.html)
- [Terrain3D Control Map Format](https://terrain3d.readthedocs.io/en/stable/docs/controlmap_format.html)
- [Witcher 3 Terrain Rendering (GDC)](https://www.gdcvault.com/play/1022063/Advanced-Graphics-Techniques-Tutorial-Day)

