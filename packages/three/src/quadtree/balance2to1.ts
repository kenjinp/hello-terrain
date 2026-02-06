import { ensureChildren } from "./nodeStore";
import { type QuadtreeState } from "./state";
import { refineLeaves } from "./refine";
import { buildLeafIndex } from "./leafIndex";
import { lookupSpatialIndexRaw } from "./spatialIndex";
import { Dir, type LeafSet, type Surface, U32_EMPTY, type UpdateParams } from "./types";

function resetSplitMarks(state: QuadtreeState): void {
  state.splitGen = (state.splitGen + 1) & 0xffff;
  if (state.splitGen === 0) {
    state.splitStamp.fill(0);
    state.splitGen = 1;
  }
}

function scheduleSplit(state: QuadtreeState, nodeId: number, count: number): number {
  if (nodeId === U32_EMPTY) return count;
  if (state.splitStamp[nodeId] === state.splitGen) return count;
  state.splitStamp[nodeId] = state.splitGen;
  state.splitQueue[count] = nodeId;
  return count + 1;
}

/**
 * Enforce 2:1 balance: adjacent leaves differ by at most 1 level.
 *
 * Strategy: iteratively find too-coarse neighbors and force-split them, rebuilding leaves each round.
 */
export function balance2to1(
  state: QuadtreeState,
  surface: Surface,
  params: UpdateParams,
  leaves: LeafSet,
): LeafSet {
  // Hard cap to prevent runaway loops; in practice this converges quickly.
  const maxIters = state.cfg.maxLevel + 1;

  for (let iter = 0; iter < maxIters; iter++) {
    const index = buildLeafIndex(leaves, state.leafIndex);

    resetSplitMarks(state);
    let splitCount = 0;

    for (let i = 0; i < leaves.count; i++) {
      const leafLevel = leaves.level[i];
      if (leafLevel < 2) continue;

      const leafSpace = leaves.space[i];
      const leafX = leaves.x[i];
      const leafY = leaves.y[i];

      for (let dir = 0 as number; dir < 4; dir++) {
        // Look for a neighbor that is more than 1 level coarser.
        // We do this by querying the neighbor of our ancestor tiles at levels (leafLevel-2..0).
        for (let candidateLevel = leafLevel - 2; candidateLevel >= 0; candidateLevel--) {
          const shift = leafLevel - candidateLevel;

          const tile = state.scratchTile;
          tile.space = leafSpace;
          tile.level = candidateLevel;
          tile.x = leafX >>> shift;
          tile.y = leafY >>> shift;

          const neighbor = state.scratchNeighbor;
          if (!surface.neighborSameLevel(tile, dir as Dir, neighbor)) break;

          const j = lookupSpatialIndexRaw(
            index,
            neighbor.space,
            neighbor.level,
            neighbor.x,
            neighbor.y,
          );
          if (j !== U32_EMPTY) {
            splitCount = scheduleSplit(state, state.leafNodeIds[j], splitCount);
            break;
          }
        }
      }
    }

    if (splitCount === 0) return leaves;

    let anySplit = false;
    for (let k = 0; k < splitCount; k++) {
      const nodeId = state.splitQueue[k];
      if (state.store.level[nodeId] >= state.cfg.maxLevel) continue;

      const base = ensureChildren(state.store, nodeId);
      if (base !== U32_EMPTY) anySplit = true;
    }

    if (!anySplit) return leaves;

    // Recompute leaves after forced splits.
    refineLeaves(state, surface, params, leaves);
  }

  return leaves;
}

