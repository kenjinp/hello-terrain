import { shouldSplit } from "./criteria";
import { ensureChildren, hasChildren } from "./nodeStore";
import { type QuadtreeState } from "./state";
import { resetLeafSet, type LeafSet, type Topology, U32_EMPTY, type UpdateParams } from "./types";

/**
 * Build a leaf set by iteratively refining from the root(s).
 *
 * IMPORTANT: This traversal is allocation-free and uses preallocated scratch.
 * Nodes may already have children (e.g. balance-forced splits); those children are always traversed.
 */
export function refineLeaves(state: QuadtreeState, topology: Topology, params: UpdateParams, outLeaves?: LeafSet): LeafSet {
  const leaves = outLeaves ?? state.leaves;
  resetLeafSet(leaves);

  const store = state.store;
  const stack = state.stack;
  let sp = 0;

  for (let i = 0; i < state.rootCount; i++) {
    stack[sp++] = state.rootNodeIds[i];
  }

  while (sp > 0) {
    const nodeId = stack[--sp];

    const level = store.level[nodeId];
    const space = store.space[nodeId];
    const x = store.x[nodeId];
    const y = store.y[nodeId];

    const tile = state.scratchTile;
    tile.space = space;
    tile.level = level;
    tile.x = x;
    tile.y = y;

    const bounds = state.scratchBounds;
    topology.tileBounds(tile, params.cameraOrigin, bounds);

    // Forced split: if children exist, always traverse them.
    if (hasChildren(store, nodeId)) {
      const base = store.firstChild[nodeId];
      // Push in reverse so child 0 is visited first (more stable ordering).
      stack[sp++] = base + 3;
      stack[sp++] = base + 2;
      stack[sp++] = base + 1;
      stack[sp++] = base + 0;
      continue;
    }

    const split = shouldSplit(bounds, level, state.cfg.maxLevel, params);
    if (split) {
      const base = ensureChildren(store, nodeId);
      if (base !== U32_EMPTY) {
        stack[sp++] = base + 3;
        stack[sp++] = base + 2;
        stack[sp++] = base + 1;
        stack[sp++] = base + 0;
        continue;
      }
      // Capacity cap: fall through and emit as a leaf.
    }

    const i = leaves.count;
    if (i >= leaves.capacity) {
      throw new Error("LeafSet capacity exceeded.");
    }

    leaves.space[i] = space;
    leaves.level[i] = level;
    leaves.x[i] = x;
    leaves.y[i] = y;
    state.leafNodeIds[i] = nodeId;
    leaves.count = i + 1;
  }

  return leaves;
}

