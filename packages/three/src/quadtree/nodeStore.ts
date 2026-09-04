import { type TileId, U32_EMPTY } from "./types";

export const NodeFlags = {
  LEAF: 1 << 0,
} as const;

export type NodeStore = {
  maxNodes: number;
  nodesUsed: number;

  /** generation stamping to avoid clearing buffers */
  currentGen: number;
  gen: Uint16Array;

  space: Uint8Array;
  level: Uint8Array;
  x: Int32Array;
  y: Int32Array;

  /** sentinel U32_EMPTY means no children; otherwise children are [firstChild..firstChild+3] */
  firstChild: Uint32Array;
  flags: Uint8Array;

  /** root node id per space */
  roots: Uint32Array;
};

export function createNodeStore(maxNodes: number, spaceCount: number): NodeStore {
  return {
    maxNodes,
    nodesUsed: 0,
    currentGen: 1,
    gen: new Uint16Array(maxNodes),
    space: new Uint8Array(maxNodes),
    level: new Uint8Array(maxNodes),
    x: new Int32Array(maxNodes),
    y: new Int32Array(maxNodes),
    firstChild: new Uint32Array(maxNodes),
    flags: new Uint8Array(maxNodes),
    roots: new Uint32Array(spaceCount),
  };
}

export function beginFrame(store: NodeStore): void {
  store.nodesUsed = 0;

  store.currentGen = (store.currentGen + 1) & 0xffff;
  if (store.currentGen === 0) {
    // Extremely rare wraparound: clear stamps once every 65535 frames.
    store.gen.fill(0);
    store.currentGen = 1;
  }
}

/**
 * Allocate a node from scalar tile coordinates. Allocation-free; used on hot
 * paths (`ensureChildren`) where building a `TileId` literal would allocate.
 */
export function allocNodeRaw(
  store: NodeStore,
  space: number,
  level: number,
  x: number,
  y: number,
): number {
  const id = store.nodesUsed;
  if (id >= store.maxNodes) return U32_EMPTY;

  store.nodesUsed = id + 1;

  store.gen[id] = store.currentGen;
  store.space[id] = space;
  store.level[id] = level;
  store.x[id] = x;
  store.y[id] = y;
  store.firstChild[id] = U32_EMPTY;
  store.flags[id] = 0;

  return id;
}

export function allocNode(store: NodeStore, tile: TileId): number {
  return allocNodeRaw(store, tile.space, tile.level, tile.x, tile.y);
}

export function isLive(store: NodeStore, nodeId: number): boolean {
  return store.gen[nodeId] === store.currentGen;
}

export function hasChildren(store: NodeStore, nodeId: number): boolean {
  return store.firstChild[nodeId] !== U32_EMPTY;
}

export function ensureChildren(store: NodeStore, parentId: number): number {
  const existing = store.firstChild[parentId];
  if (existing !== U32_EMPTY) return existing;

  // Allocate 4 contiguous children.
  const childBase = store.nodesUsed;
  if (childBase + 4 > store.maxNodes) return U32_EMPTY;

  const space = store.space[parentId];
  const level = store.level[parentId] + 1;
  const px = store.x[parentId] << 1;
  const py = store.y[parentId] << 1;

  // Child coord layout:
  // 0: (0,0) top-left
  // 1: (1,0) top-right
  // 2: (0,1) bottom-left
  // 3: (1,1) bottom-right
  allocNodeRaw(store, space, level, px, py);
  allocNodeRaw(store, space, level, px + 1, py);
  allocNodeRaw(store, space, level, px, py + 1);
  allocNodeRaw(store, space, level, px + 1, py + 1);

  store.firstChild[parentId] = childBase;
  return childBase;
}

