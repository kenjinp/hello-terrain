# Terrain System Design Documents

This directory contains design documents for the `hello-terrain` WebGPU terrain rendering system.

## Documents

```
docs/design/
├── README.md                    # This file
├── texture-system.md            # 32-texture painting system
├── storage-compression.md       # Memory compression strategies
├── quadtree-optimization.md     # Node buffer optimization
└── advanced-optimizations.md    # GPU, texture, streaming optimizations
```

### [1. 32-Texture System](./texture-system.md)
Multi-texture terrain painting system inspired by Godot's Terrain3D. Supports up to 32 texture sets with efficient index-based blending instead of splatmaps.

**Key topics:**
- WebGPU texture arrays (`texture_2d_array`)
- Per-node control storage (following heightmap/normalmap pattern)
- TSL shader nodes for texture blending
- Height-based and slope-based blending
- Painting system integration

### [2. Storage Compression](./storage-compression.md)
Memory optimization strategies for terrain storage buffers. Achieves ~72% memory reduction.

**Key topics:**
- Octahedral normal encoding (83% reduction)
- Half-precision heights (50% reduction)
- Compact control data packing (50% reduction)
- Skirt vertex strategies per buffer type

### [3. Quadtree Node Optimization](./quadtree-optimization.md)
Memory layout optimization for quadtree node data. Achieves ~89% GPU memory reduction.

**Key topics:**
- Morton code position encoding
- Computing level/position from node index
- Eliminating redundant x, y storage
- Trade-offs: ALU ops vs memory bandwidth

### [4. Advanced Optimizations](./advanced-optimizations.md)
Additional optimization techniques for GPU, textures, geometry, and streaming.

**Key topics:**
- GPU-driven rendering (indirect draws, Hi-Z occlusion)
- Compressed texture formats (BC7/ASTC)
- Virtual texturing and streaming
- Async compute and workgroup tuning
- CDLOD and geomorphing
- Shader LOD and branch reduction

---

## Memory Summary

| Component | Current | Optimized | Reduction |
|-----------|---------|-----------|-----------|
| heightmapStorage | 16.4 MB | 8.2 MB | 50% |
| normalmapStorage | 49.2 MB | 7.4 MB | 85% |
| controlmapStorage | 16.4 MB | 7.4 MB | 55% |
| nodeBuffer (GPU) | 16 KB | 0 KB | 100% |
| **Total** | **~82 MB** | **~23 MB** | **72%** |

*Based on 1000 nodes, 61 segments per tile*

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            TerrainMesh                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                   Per-Node Storage Buffers                       │    │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────────┐ │    │
│  │  │ heightmap │  │ normalmap │  │ controlmap│  │activeLeafIdx  │ │    │
│  │  │   f16     │  │ oct-i16   │  │    u16    │  │     u16       │ │    │
│  │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └───────┬───────┘ │    │
│  │        └──────────────┴──────────────┴────────────────┘         │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                    │                                     │
│  ┌─────────────────────────────────┴─────────────────────────────────┐  │
│  │                      Texture Arrays (32 layers)                    │  │
│  │  ┌─────────────────────┐          ┌─────────────────────┐          │  │
│  │  │  albedoHeightArray  │          │ normalRoughnessArray│          │  │
│  │  └─────────────────────┘          └─────────────────────┘          │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│  ┌─────────────────────────────────┴─────────────────────────────────┐  │
│  │                       Shader Pipeline                              │  │
│  │  Compute: height → normal → control (procedural)                   │  │
│  │  Vertex:  position from heightmap + Morton-decoded tile coords     │  │
│  │  Fragment: control → texture array sampling → blend → PBR          │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Texture System *(texture-system.md)*
- [ ] `TerrainTextureArray` — DataArrayTexture wrapper
- [ ] `ControlStorage` — Per-node u32/u16 storage buffer
- [ ] `ControlDataPacker` — Bit packing utilities
- [ ] TSL shader nodes for control decode + texture sampling

### Phase 2: Storage Compression *(storage-compression.md)*
- [ ] Octahedral normal encoding in compute shader
- [ ] f16 heightmap storage
- [ ] Compact u16 control packing
- [ ] Decode functions in vertex/fragment shaders

### Phase 3: Quadtree Optimization *(quadtree-optimization.md)*
- [ ] Morton code position computation in TSL
- [ ] Remove nodeBuffer from GPU uploads
- [ ] Update tile.ts to compute from index

### Phase 4: Integration & Polish
- [ ] TerrainMesh API: `addTextureSet()`, `paintAt()`
- [ ] Procedural auto-texturing rules
- [ ] Performance profiling and tuning

### Phase 5: Advanced Optimizations *(advanced-optimizations.md)*
- [ ] Compressed textures (BC7/ASTC)
- [ ] Tile pooling / object recycling
- [ ] Indirect rendering
- [ ] Shader LOD at distance
- [ ] CDLOD morphing for smooth transitions

---

## References

- [Godot Terrain3D](https://terrain3d.readthedocs.io/en/stable/docs/shader_design.html)
- [Three.js TSL](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [WebGPU WGSL Spec](https://www.w3.org/TR/WGSL/)
- [Witcher 3 Terrain (GDC)](https://www.gdcvault.com/play/1022063/Advanced-Graphics-Techniques-Tutorial-Day)

