# Quadtree (functional LOD)

This directory will contain a **hot-loop-friendly**, **allocation-free** quadtree LOD system.

The design targets:

- **Large flat terrain today**
- A future **6-faced cube-sphere planet** (one quadtree per face)

The core principle is: **the quadtree only deals in TileIds** (tile space), and all world/surface math lives in a pluggable `Topology` adapter.

---

### API (functions, not classes)

The public API is intended to be a small set of functions operating on explicit state objects and preallocated buffers.

- **`createState(cfg, topology)`** → `State`
    - Allocates typed arrays once
    - Initializes root nodes for each `topology.spaceCount`

- **`update(state, topology, params, outLeaves?)`** → `LeafSet`
    - Hot-loop entrypoint
    - Produces the current set of renderable leaf tiles
    - Performs refinement and **2:1 balancing**
    - Writes into caller-provided buffers when supplied (no allocations)

- **`buildLeafIndex(leaves, outIndex?)`** → `SpatialIndex`
    - Open-addressing lookup for `(space, level, x, y) -> leafListIndex`

- **`buildSeams2to1(topology, leaves, leafIndex, out?)`** → `SeamTable`
    - Fixed-width seam/neighbor table suitable for GPU consumption

---

### Data model

#### TileId

Every tile is identified by:

- `space: u8` (0 for flat terrain; 0..5 cube faces for planet)
- `level: u8`
- `x: u32`
- `y: u32`

`x/y` are `u32` to support Earth-scale subdivision depth (16-bit is not enough at high `maxLevel`).

#### LeafSet output (SoA)

`update()` returns a `LeafSet` using **structure-of-arrays** typed buffers:

- `count: number`
- `space: Uint8Array`
- `level: Uint8Array`
- `x: Uint32Array`
- `y: Uint32Array`

Only the prefix `[0, count)` is valid each frame. No JS arrays of nodes are produced.

---

### Topology adapter (flat now, cube-sphere later)

The quadtree is **topology-agnostic**. It relies on `Topology` for:

- **Topology** (neighbors across edges)
- **Bounds** (conservative camera-relative bounds for LOD decisions)

Suggested interface:

```ts
export type Dir = 0 | 1 | 2 | 3; // LEFT, RIGHT, TOP, BOTTOM

export type TileId = {
  space: number;
  level: number;
  x: number;
  y: number;
};

export type TileBounds = {
  cx: number;
  cy: number;
  cz: number;
  r: number; // conservative radius
};

export type Topology = {
  spaceCount: number;

  /**
   * Compute the same-level neighbor TileId in the requested direction.
   * Returns false if the neighbor is outside the valid topology.
   *
   * Flat: simple arithmetic and boundary checks.
   * Cube-sphere: remap across face edges (the reason this abstraction exists).
   */
  neighborSameLevel(tile: TileId, dir: Dir, out: TileId): boolean;

  /**
   * Conservative camera-relative bounds for LOD.
   * Avoids absolute world positions; supports floating origin.
   */
  tileBounds(
    tile: TileId,
    cameraOrigin: { x: number; y: number; z: number },
    out: TileBounds,
  ): void;
};
```

---

### Strategy: crack-free LOD via 2:1 balancing

We plan to enforce **2:1 balance**:

- Along any shared edge, neighboring leaves differ by **at most 1 level**.

Benefits:

- Crack handling becomes predictable
- Each edge has at most **two** neighbors
- Seam buffers can be **fixed width** and GPU-friendly

`buildSeams2to1()` produces a fixed-width neighbor table for the GPU: **4 edges × 2 neighbors** per leaf.

---

### Precision and Earth-scale considerations

- Avoid absolute world positions in per-node/per-leaf buffers (GPU `f32` will jitter at large magnitudes)
- Prefer camera-relative math (floating origin) for any render payloads
- Keep the quadtree entirely in tile space (`space/level/x/y`)

---

### Performance rules (non-negotiable)

- No allocations in the hot path (no `[]` / `{}` in per-node loops)
- No per-frame full buffer clears (use live ranges and/or generation stamping)
- Prefer iterative traversal with a preallocated stack
- Prefer squared distance metrics (avoid `sqrt`)
