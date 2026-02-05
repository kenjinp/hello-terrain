import { allocLeafSet, type LeafSet, type QuadtreeConfig, type Surface, type TileBounds, type TileId, U32_EMPTY } from "./types";
import { allocNode, beginFrame, createNodeStore, type NodeStore } from "./nodeStore";
import { createSpatialIndex, type SpatialIndex } from "./leafIndex";

export type QuadtreeState = {
  cfg: QuadtreeConfig;
  store: NodeStore;

  /** default reusable leaf buffers (capacity = cfg.maxNodes) */
  leaves: LeafSet;
  /** internal: node id per leaf entry (parallel to leaves.* arrays) */
  leafNodeIds: Uint32Array;
  /** reusable leaf spatial index (capacity = cfg.maxNodes) */
  leafIndex: SpatialIndex;

  /** traversal scratch */
  stack: Uint32Array;

  /** split scheduling scratch (dedupe without allocations) */
  splitQueue: Uint32Array;
  splitStamp: Uint16Array;
  splitGen: number;

  /** scratch objects to avoid allocations */
  scratchTile: TileId;
  scratchNeighbor: TileId;
  scratchBounds: TileBounds;

  /** surface space count is fixed for a given state */
  spaceCount: number;
};

export function createState(cfg: QuadtreeConfig, surface: Surface): QuadtreeState {
  const store = createNodeStore(cfg.maxNodes, surface.spaceCount);

  return {
    cfg,
    store,
    leaves: allocLeafSet(cfg.maxNodes),
    leafNodeIds: new Uint32Array(cfg.maxNodes),
    leafIndex: createSpatialIndex(cfg.maxNodes),
    stack: new Uint32Array(cfg.maxNodes),
    splitQueue: new Uint32Array(cfg.maxNodes),
    splitStamp: new Uint16Array(cfg.maxNodes),
    splitGen: 1,
    scratchTile: { space: 0, level: 0, x: 0, y: 0 },
    scratchNeighbor: { space: 0, level: 0, x: 0, y: 0 },
    scratchBounds: { cx: 0, cy: 0, cz: 0, r: 0 },
    spaceCount: surface.spaceCount,
  };
}

export function beginUpdate(state: QuadtreeState, surface: Surface): void {
  if (surface.spaceCount !== state.spaceCount) {
    throw new Error(
      `Surface spaceCount changed (${state.spaceCount} -> ${surface.spaceCount}). Create a new quadtree state.`,
    );
  }

  beginFrame(state.store);

  // Allocate a root node per space.
  for (let s = 0; s < surface.spaceCount; s++) {
    const rootId = allocNode(state.store, { space: s, level: 0, x: 0, y: 0 });
    if (rootId === U32_EMPTY) {
      throw new Error("Failed to allocate root node (maxNodes too small).");
    }
    state.store.roots[s] = rootId;
  }
}

