import { buildLeafIndex, type SpatialIndex } from "./leafIndex";
import { lookupSpatialIndexRaw } from "./spatialIndex";
import { Dir, type LeafSet, type SeamTable, type Topology, U32_EMPTY } from "./types";

/**
 * Build a fixed-width seam/neighbor table for balanced leaves (2:1).
 *
 * Output neighbors are leaf-list indices, with U32_EMPTY for missing entries.
 * Layout: neighbors[leafIndex * 8 + edge*2 + slot].
 *
 * Allocation-free: all `TileId` scratch lives on `outSeams.scratch`, so each
 * `SeamTable` (and therefore each terrain instance) owns its own scratch.
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
  const {
    tile: scratchTile,
    nbr: scratchNbr,
    parentTile: scratchParentTile,
    parentNbr: scratchParentNbr,
  } = outSeams.scratch;

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

