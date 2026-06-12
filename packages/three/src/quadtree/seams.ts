import { buildLeafIndex, type SpatialIndex } from "./leafIndex";
import { lookupSpatialIndexRaw } from "./spatialIndex";
import { Dir, type LeafSet, type SeamTable, type TileId, type Topology, U32_EMPTY } from "./types";

// Module-scope scratch (no per-call allocations). Not re-entrant by design.
const scratchTile: TileId = { space: 0, level: 0, x: 0, y: 0 };
const scratchNbr: TileId = { space: 0, level: 0, x: 0, y: 0 };
const scratchParentTile: TileId = { space: 0, level: 0, x: 0, y: 0 };
const scratchParentNbr: TileId = { space: 0, level: 0, x: 0, y: 0 };

// Dedicated scratch for the edge-mask pass (kept separate so it never aliases
// the seam-table scratch above; neither is re-entrant by design).
const scratchMaskTile: TileId = { space: 0, level: 0, x: 0, y: 0 };
const scratchMaskNbr: TileId = { space: 0, level: 0, x: 0, y: 0 };
const scratchMaskParentTile: TileId = { space: 0, level: 0, x: 0, y: 0 };
const scratchMaskParentNbr: TileId = { space: 0, level: 0, x: 0, y: 0 };

/**
 * Build a fixed-width seam/neighbor table for balanced leaves (2:1).
 *
 * Output neighbors are leaf-list indices, with U32_EMPTY for missing entries.
 * Layout: neighbors[leafIndex * 8 + edge*2 + slot].
 */
export function buildSeams2to1(
  topology: Topology,
  leaves: LeafSet,
  outSeams: SeamTable,
  outIndex?: SpatialIndex,
): SeamTable {
  if (outSeams.capacity < leaves.count) {
    throw new Error("SeamTable capacity is smaller than LeafSet.count.");
  }

  const index = buildLeafIndex(leaves, outIndex);
  outSeams.count = leaves.count;

  const neighbors = outSeams.neighbors;

  for (let i = 0; i < leaves.count; i++) {
    const base = i * 8;

    const space = leaves.space[i];
    const level = leaves.level[i];
    const x = leaves.x[i];
    const y = leaves.y[i];

    for (let dir = 0; dir < 4; dir++) {
      const outOffset = base + dir * 2;
      neighbors[outOffset + 0] = U32_EMPTY;
      neighbors[outOffset + 1] = U32_EMPTY;

      // Same-level neighbor tile id.
      // Note: topology handles cross-space edges.
      scratchTile.space = space;
      scratchTile.level = level;
      scratchTile.x = x;
      scratchTile.y = y;

      if (!topology.neighborSameLevel(scratchTile, dir as Dir, scratchNbr)) continue;

      // 1) same-level neighbor leaf
      let j = lookupSpatialIndexRaw(index, scratchNbr.space, scratchNbr.level, scratchNbr.x, scratchNbr.y);
      if (j !== U32_EMPTY) {
        neighbors[outOffset + 0] = j;
        continue;
      }

      // 2) coarser neighbor leaf (level-1)
      if (level > 0) {
        const px = x >>> 1;
        const py = y >>> 1;

        scratchParentTile.space = space;
        scratchParentTile.level = level - 1;
        scratchParentTile.x = px;
        scratchParentTile.y = py;

        if (topology.neighborSameLevel(scratchParentTile, dir as Dir, scratchParentNbr)) {
          j = lookupSpatialIndexRaw(
            index,
            scratchParentNbr.space,
            scratchParentNbr.level,
            scratchParentNbr.x,
            scratchParentNbr.y,
          );
          if (j !== U32_EMPTY) {
            neighbors[outOffset + 0] = j;
            continue;
          }
        }
      }

      // 3) finer neighbor leaves (level+1): two children along the neighbor edge
      const childLevel = scratchNbr.level + 1;
      const x2 = (scratchNbr.x << 1) >>> 0;
      const y2 = (scratchNbr.y << 1) >>> 0;

      let ax = 0;
      let ay = 0;
      let bx = 0;
      let by = 0;

      switch (dir as Dir) {
        case Dir.LEFT:
          ax = x2 + 1;
          ay = y2;
          bx = x2 + 1;
          by = y2 + 1;
          break;
        case Dir.RIGHT:
          ax = x2;
          ay = y2;
          bx = x2;
          by = y2 + 1;
          break;
        case Dir.TOP:
          ax = x2;
          ay = y2 + 1;
          bx = x2 + 1;
          by = y2 + 1;
          break;
        case Dir.BOTTOM:
          ax = x2;
          ay = y2;
          bx = x2 + 1;
          by = y2;
          break;
      }

      j = lookupSpatialIndexRaw(index, scratchNbr.space, childLevel, ax, ay);
      if (j !== U32_EMPTY) neighbors[outOffset + 0] = j;

      j = lookupSpatialIndexRaw(index, scratchNbr.space, childLevel, bx, by);
      if (j !== U32_EMPTY) neighbors[outOffset + 1] = j;
    }
  }

  return outSeams;
}

/**
 * Build a per-leaf 4-bit edge mask marking edges whose neighbor across that
 * edge is exactly one level coarser — i.e. a 2:1 LOD boundary that needs
 * T-junction stitching on the finer (this) tile.
 *
 * Bit layout matches `Dir`: LEFT=`1<<0`, RIGHT=`1<<1`, TOP=`1<<2`, BOTTOM=`1<<3`.
 * `outMask[i]` corresponds to leaf `i`. Cross-face edges are handled implicitly
 * because detection routes through `topology.neighborSameLevel`.
 *
 * Mirrors the same-level / coarser-parent detection in {@link buildSeams2to1}
 * (the finer-children case is irrelevant: stitching is always done on the finer
 * side). Relies on 2:1 balance, so a missing same-level neighbor whose
 * coarser parent-neighbor exists is unambiguously the adjacent coarse leaf.
 *
 * Allocation-free when `outMask` and `outIndex` are provided.
 */
export function buildCoarseEdgeMask(
  topology: Topology,
  leaves: LeafSet,
  outMask: Uint8Array,
  outIndex?: SpatialIndex,
): Uint8Array {
  if (outMask.length < leaves.count) {
    throw new Error("coarse edge mask buffer is smaller than LeafSet.count.");
  }

  const index = buildLeafIndex(leaves, outIndex);

  for (let i = 0; i < leaves.count; i++) {
    const space = leaves.space[i];
    const level = leaves.level[i];
    const x = leaves.x[i];
    const y = leaves.y[i];

    let mask = 0;

    for (let dir = 0; dir < 4; dir++) {
      scratchMaskTile.space = space;
      scratchMaskTile.level = level;
      scratchMaskTile.x = x;
      scratchMaskTile.y = y;

      if (!topology.neighborSameLevel(scratchMaskTile, dir as Dir, scratchMaskNbr)) continue;

      // A same-level neighbor leaf means this edge is not a coarse boundary.
      const sameLevel = lookupSpatialIndexRaw(
        index,
        scratchMaskNbr.space,
        scratchMaskNbr.level,
        scratchMaskNbr.x,
        scratchMaskNbr.y,
      );
      if (sameLevel !== U32_EMPTY) continue;

      // Otherwise, a coarser (level-1) neighbor leaf marks the edge for stitching.
      if (level > 0) {
        scratchMaskParentTile.space = space;
        scratchMaskParentTile.level = level - 1;
        scratchMaskParentTile.x = x >>> 1;
        scratchMaskParentTile.y = y >>> 1;

        if (topology.neighborSameLevel(scratchMaskParentTile, dir as Dir, scratchMaskParentNbr)) {
          const coarser = lookupSpatialIndexRaw(
            index,
            scratchMaskParentNbr.space,
            scratchMaskParentNbr.level,
            scratchMaskParentNbr.x,
            scratchMaskParentNbr.y,
          );
          if (coarser !== U32_EMPTY) {
            mask |= 1 << dir;
          }
        }
      }
    }

    outMask[i] = mask;
  }

  return outMask;
}

