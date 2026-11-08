import { shouldSplit } from "./criteria";
import { ensureChildren, hasChildren } from "./nodeStore";
import { type QuadtreeState } from "./state";
import {
  resetLeafSet,
  type Dir,
  type ElevationRangeOut,
  type LeafSet,
  type TileId,
  type Topology,
  U32_EMPTY,
  type UpdateParams,
} from "./types";

/** Find the current tree node covering a tile without rebuilding a leaf index. */
function coveringNode(state: QuadtreeState, tile: TileId): number {
  const store = state.store;
  const scale = 2 ** tile.level;
  const rootX = Math.floor(tile.x / scale);
  const rootY = Math.floor(tile.y / scale);
  for (let i = 0; i < state.rootCount; i++) {
    let id = state.rootNodeIds[i];
    if (store.space[id] !== tile.space || store.x[id] !== rootX || store.y[id] !== rootY) continue;
    while (store.level[id] < tile.level && hasChildren(store, id)) {
      const childScale = 2 ** (tile.level - store.level[id] - 1);
      const x = Math.floor(tile.x / childScale) - store.x[id] * 2;
      const y = Math.floor(tile.y / childScale) - store.y[id] * 2;
      id = store.firstChild[id] + x + y * 2;
    }
    return id;
  }
  return U32_EMPTY;
}

/**
 * Refine nearby tiles first. Reserve each split's complete 2:1 neighbor
 * closure before allocating: exhaustion must never publish unbalanced leaves.
 * All queues and keys use instance-owned scratch.
 */
export function refineLeaves(
  state: QuadtreeState,
  topology: Topology,
  params: UpdateParams,
  outLeaves?: LeafSet,
): LeafSet {
  const leaves = outLeaves ?? state.leaves;
  resetLeafSet(leaves);
  const store = state.store;
  const heap = state.stack;
  const priority = state.refinementPriority;
  let heapCount = 0;
  function before(a: number, b: number): boolean {
    return priority[a] < priority[b] || (priority[a] === priority[b] && a < b);
  }
  function enqueue(id: number): void {
    const tile = state.scratchTile;
    tile.space = store.space[id];
    tile.level = store.level[id];
    tile.x = store.x[id];
    tile.y = store.y[id];
    const bounds = state.scratchBounds;
    let elevationRange: ElevationRangeOut | undefined;
    if (params.tileElevationRange && params.tileElevationRange(tile, state.scratchElevationRange))
      elevationRange = state.scratchElevationRange;
    topology.tileBounds(tile, params.cameraOrigin, bounds, elevationRange);
    if (!shouldSplit(bounds, tile.level, state.cfg.maxLevel, params)) return;
    // Absolute proximity follows the camera branch down to ground detail
    // before spending the budget refining distant large tiles.
    priority[id] = bounds.cx ** 2 + bounds.cy ** 2 + bounds.cz ** 2;
    let at = heapCount++;
    while (at > 0) {
      const parent = (at - 1) >>> 1;
      if (!before(id, heap[parent])) break;
      heap[at] = heap[parent];
      at = parent;
    }
    heap[at] = id;
  }
  for (let id = 0; id < store.nodesUsed; id++) if (!hasChildren(store, id)) enqueue(id);
  while (heapCount > 0 && store.nodesUsed + 4 <= store.maxNodes) {
    const id = heap[0];
    const last = heap[--heapCount];
    if (heapCount > 0) {
      let at = 0;
      while (at * 2 + 1 < heapCount) {
        let child = at * 2 + 1;
        if (child + 1 < heapCount && before(heap[child + 1], heap[child])) child++;
        if (!before(heap[child], last)) break;
        heap[at] = heap[child];
        at = child;
      }
      heap[at] = last;
    }
    if (hasChildren(store, id)) continue;
    state.splitGen = (state.splitGen + 1) & 0xffff;
    if (state.splitGen === 0) {
      state.splitStamp.fill(0);
      state.splitGen = 1;
    }
    let count = 1;
    state.splitQueue[0] = id;
    state.splitStamp[id] = state.splitGen;
    for (let k = 0; k < count && store.nodesUsed + count * 4 <= store.maxNodes; k++) {
      const candidate = state.splitQueue[k];
      for (let dir = 0; dir < 4; dir++) {
        const tile = state.scratchTile;
        tile.space = store.space[candidate];
        tile.level = store.level[candidate];
        tile.x = store.x[candidate];
        tile.y = store.y[candidate];
        const neighbor = state.scratchNeighbor;
        if (!topology.neighborSameLevel(tile, dir as Dir, neighbor)) continue;
        const other = coveringNode(state, neighbor);
        if (
          other === U32_EMPTY ||
          store.level[other] >= tile.level ||
          state.splitStamp[other] === state.splitGen
        )
          continue;
        state.splitStamp[other] = state.splitGen;
        state.splitQueue[count++] = other;
      }
    }
    if (store.nodesUsed + count * 4 > store.maxNodes) continue;
    for (let k = 0; k < count; k++) {
      const base = ensureChildren(store, state.splitQueue[k]);
      for (let child = 0; child < 4; child++) enqueue(base + child);
    }
  }
  // Preserve canonical depth-first publication order.
  let sp = 0;
  for (let i = 0; i < state.rootCount; i++) heap[sp++] = state.rootNodeIds[i];
  while (sp > 0) {
    const id = heap[--sp];
    if (hasChildren(store, id)) {
      const base = store.firstChild[id];
      for (let child = 3; child >= 0; child--) heap[sp++] = base + child;
      continue;
    }
    const i = leaves.count++;
    if (i >= leaves.capacity) throw new Error("LeafSet capacity exceeded.");
    leaves.space[i] = store.space[id];
    leaves.level[i] = store.level[id];
    leaves.x[i] = store.x[id];
    leaves.y[i] = store.y[id];
    state.leafNodeIds[i] = id;
  }
  return leaves;
}
