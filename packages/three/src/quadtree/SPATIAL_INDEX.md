# SpatialIndex: Open-Address Hash Map for Quadtree Tiles

`spatialIndex.ts` implements a **zero-allocation, open-addressed hash map** that maps quadtree tile coordinates `(space, level, x, y)` to unsigned 32-bit integer values. It is designed for hot-path lookups during quadtree refinement, seam building, and 2:1 balancing, where per-frame allocation pressure and cache coherence matter.

## Data Layout

The index is a **struct-of-arrays** rather than an array-of-structs. Each conceptual "slot" in the hash table is spread across several parallel typed arrays:

```typescript
type SpatialIndex = {
  size: number;        // table capacity (always a power of 2)
  mask: number;        // size - 1, used for fast modulo

  stampGen: number;    // current generation counter (uint16)
  stamp: Uint16Array;  // per-slot generation stamp

  keysSpace: Uint8Array;   // space component of stored keys
  keysLevel: Uint8Array;   // level component of stored keys
  keysX: Uint32Array;      // x component of stored keys
  keysY: Uint32Array;      // y component of stored keys

  values: Uint32Array;     // stored values
};
```

This layout is cache-friendly for probing: the hot path during lookup touches `stamp`, then the key arrays, then `values` -- all contiguous in memory within their respective typed arrays.

## Capacity and Load Factor

The table is created via `createSpatialIndex(maxEntries)`. Internally it doubles the requested capacity and rounds up to the next power of two:

```
size = nextPow2(max(2, maxEntries * 2))
```

This guarantees a **load factor of at most 50%**, keeping average probe lengths short for linear probing.

## Hashing

Keys are four-component tuples: `(space, level, x, y)`. The hash function works in two stages:

1. **`mix32(x)`** -- A 32-bit integer finalizer using xorshift and multiplication (similar to Murmur/splitmix-style finalizers). It avalanches bits so that sequential x/y coordinates spread evenly across the table.

2. **`hashKey(space, level, x, y)`** -- Packs `space` (8 bits) and `level` (8 bits shifted left by 8) into a seed, XORs in `mix32(x)` and `mix32(y)`, then runs the combined value through `mix32` one final time.

The slot index is then `hashKey(...) & mask`.

## Collision Resolution: Linear Probing

Collisions are resolved with **linear probing**: if the desired slot is occupied by a different key, the implementation advances to `(slot + 1) & mask` and tries again, up to `size` probes. With a 50% load factor this yields very short average probe chains (typically 1-2 probes).

## Generation-Based Reset (Tombstone-Free)

The most distinctive feature is the **stamp generation** mechanism, which avoids the need to clear the entire table between frames.

Each slot has a 16-bit `stamp` value. The index also tracks a global `stampGen` counter. A slot is considered **occupied** only if `stamp[slot] === stampGen`. To "clear" the entire table, `resetSpatialIndex` simply increments `stampGen`:

```typescript
function resetSpatialIndex(index: SpatialIndex): void {
  index.stampGen = (index.stampGen + 1) & 0xffff;
  if (index.stampGen === 0) {
    // Wrap: clear stamps once every 65535 resets.
    index.stamp.fill(0);
    index.stampGen = 1;
  }
}
```

This makes reset an **O(1)** operation instead of O(n). Every 65,535 resets, the counter wraps around and the stamps array is bulk-cleared -- a very rare event.

### Why this works

- **Insert**: When writing to a slot whose stamp doesn't match the current generation, the slot is treated as empty. The stamp is overwritten with the current generation, effectively "claiming" it.
- **Lookup**: When probing, a slot with a stale stamp is treated as empty, causing the lookup to return `U32_EMPTY` (`0xFFFFFFFF`) immediately. This is correct because any key that _was_ in that slot belongs to a previous frame and is no longer valid.
- **No tombstones needed**: Since the table is rebuilt from scratch each frame (insert all leaves, then do lookups), there are no deletions and therefore no tombstone management.

## API

### `createSpatialIndex(maxEntries: number): SpatialIndex`

Allocates a new index sized for up to `maxEntries` entries (actual table size will be larger to maintain the load factor).

### `resetSpatialIndex(index: SpatialIndex): void`

Logically clears all entries in O(1) by advancing the generation counter.

### `insertSpatialIndexRaw(index, space, level, x, y, value): void`

Inserts or updates a key-value pair using raw numeric components. Throws if the table is completely full.

### `insertSpatialIndex(index, tile: TileId, value): void`

Convenience wrapper that destructures a `TileId` and delegates to `insertSpatialIndexRaw`.

### `lookupSpatialIndexRaw(index, space, level, x, y): number`

Looks up a key and returns the associated value, or `U32_EMPTY` (`0xFFFFFFFF`) if not found.

### `lookupSpatialIndex(index, tile: TileId): number`

Convenience wrapper that destructures a `TileId` and delegates to `lookupSpatialIndexRaw`.

## Usage in the Quadtree System

The spatial index is the backbone of neighbor lookups. After each round of quadtree refinement:

1. **`buildLeafIndex`** inserts every leaf tile into the index, mapping `(space, level, x, y)` to that leaf's position in the leaf array.
2. **`buildSeams2to1`** uses `lookupSpatialIndexRaw` to find neighbor leaves at the same level, parent level, or child level for each edge direction.
3. **`balance2to1`** uses it to locate coarser neighbors that need splitting to maintain the 2:1 level constraint.

Because the index is reset and rebuilt every frame, it always reflects the current set of leaves with zero stale data.

## Design Rationale

| Decision              | Rationale                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Struct-of-arrays      | Better cache utilization for typed-array probing; avoids object overhead per slot                                          |
| Power-of-2 sizing     | Enables bitwise `& mask` instead of modulo for slot computation                                                            |
| 50% max load factor   | Keeps linear probing chains short (avg ~1.5 probes)                                                                        |
| Generation stamps     | O(1) reset without touching every slot; eliminates tombstone complexity                                                    |
| All `>>> 0` coercions | Forces JavaScript values into unsigned 32-bit integers, avoiding SMI deoptimizations and ensuring correct bitwise behavior |
| `Math.imul` in hash   | Performs true 32-bit multiplication without floating-point precision loss                                                  |
| No deletion support   | The table is rebuilt each frame, so deletions are unnecessary                                                              |
