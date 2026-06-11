import {
  allocLeafSet,
  type LeafSet,
  type QuadtreeConfig,
  type TileBounds,
  type TileId,
  type Topology,
  U32_EMPTY,
  type UpdateParams,
} from "./types";
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
  /** root nodes for this frame */
  rootNodeIds: Uint32Array;
  rootCount: number;

  /** split scheduling scratch (dedupe without allocations) */
  splitQueue: Uint32Array;
  splitStamp: Uint16Array;
  splitGen: number;

  /** scratch objects to avoid allocations */
  scratchTile: TileId;
  scratchNeighbor: TileId;
  scratchBounds: TileBounds;
  scratchRootTiles: TileId[];

  /** topology space count is fixed for a given state */
  spaceCount: number;
};

export function createState(cfg: QuadtreeConfig, topology: Topology): QuadtreeState {
  const store = createNodeStore(cfg.maxNodes, topology.spaceCount);
  const scratchRootTiles: TileId[] = [];
  for (let i = 0; i < topology.maxRootCount; i++) {
    scratchRootTiles.push({ space: 0, level: 0, x: 0, y: 0 });
  }

  return {
    cfg,
    store,
    leaves: allocLeafSet(cfg.maxNodes),
    leafNodeIds: new Uint32Array(cfg.maxNodes),
    leafIndex: createSpatialIndex(cfg.maxNodes),
    stack: new Uint32Array(cfg.maxNodes),
    rootNodeIds: new Uint32Array(topology.maxRootCount),
    rootCount: 0,
    splitQueue: new Uint32Array(cfg.maxNodes),
    splitStamp: new Uint16Array(cfg.maxNodes),
    splitGen: 1,
    scratchTile: { space: 0, level: 0, x: 0, y: 0 },
    scratchNeighbor: { space: 0, level: 0, x: 0, y: 0 },
    scratchBounds: { cx: 0, cy: 0, cz: 0, r: 0 },
    scratchRootTiles,
    spaceCount: topology.spaceCount,
  };
}

export function beginUpdate(state: QuadtreeState, topology: Topology, params: UpdateParams): void {
  if (topology.spaceCount !== state.spaceCount) {
    throw new Error(
      `Topology spaceCount changed (${state.spaceCount} -> ${topology.spaceCount}). Create a new quadtree state.`,
    );
  }
  if (topology.maxRootCount !== state.rootNodeIds.length) {
    throw new Error(
      `Topology maxRootCount changed (${state.rootNodeIds.length} -> ${topology.maxRootCount}). Create a new quadtree state.`,
    );
  }

  beginFrame(state.store);
  state.rootCount = 0;

  const rootCount = topology.rootTiles(params.cameraOrigin, state.scratchRootTiles);
  if (rootCount < 0 || rootCount > topology.maxRootCount) {
    throw new Error(`Topology returned invalid root count (${rootCount}).`);
  }

  // Allocate a root node per topology-selected root tile.
  for (let i = 0; i < rootCount; i++) {
    const rootId = allocNode(state.store, state.scratchRootTiles[i]);
    if (rootId === U32_EMPTY) {
      throw new Error("Failed to allocate root node (maxNodes too small).");
    }
    state.rootNodeIds[i] = rootId;
    state.rootCount = i + 1;
  }
}

