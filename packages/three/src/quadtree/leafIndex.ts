import { type LeafSet } from "./types";
import {
  type SpatialIndex,
  createSpatialIndex,
  insertSpatialIndexRaw,
  resetSpatialIndex,
} from "./spatialIndex";

export { type SpatialIndex, createSpatialIndex } from "./spatialIndex";

/**
 * Build a spatial index for the current LeafSet.
 * Maps (space, level, x, y) -> leafIndex.
 *
 * Allocation-free if `out` is provided.
 */
export function buildLeafIndex(leaves: LeafSet, out?: SpatialIndex): SpatialIndex {
  const index = out ?? createSpatialIndex(leaves.count);
  resetSpatialIndex(index);

  for (let i = 0; i < leaves.count; i++) {
    insertSpatialIndexRaw(index, leaves.space[i], leaves.level[i], leaves.x[i], leaves.y[i], i);
  }

  return index;
}

