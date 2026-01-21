import { EMPTY_SENTINEL_VALUE, type QuadtreeNodeView } from "./QuadtreeNodeView";

/**
 * Direction enum for neighbor finding
 * Matches the order used in NeighborIndices: [left, right, top, bottom]
 */
export const Direction = {
  LEFT: 0,
  RIGHT: 1,
  TOP: 2,
  BOTTOM: 3,
} as const;

export type Direction = (typeof Direction)[keyof typeof Direction];

/**
 * Result of finding neighbors for a node.
 * Each direction may have:
 * - A single neighbor index (same or coarser level)
 * - Multiple neighbor indices (finer level - multiple smaller tiles share the edge)
 * - EMPTY_SENTINEL_VALUE if no neighbor exists (boundary)
 */
export interface NeighborResult {
  /** Left neighbor(s) - single index or array of indices for finer neighbors */
  left: number | number[];
  /** Right neighbor(s) */
  right: number | number[];
  /** Top neighbor(s) */
  top: number | number[];
  /** Bottom neighbor(s) */
  bottom: number | number[];
}

// ============================================================================
// Spatial Index - Open Addressing Hash Table with Typed Arrays
// ============================================================================

/** Sentinel value for empty hash table slots */
const HASH_EMPTY = 0xffffffff;

/**
 * Encode (level, x, y) into a single 32-bit key.
 * - level: 5 bits (max 32 levels)
 * - x: 13 bits (max 8192 coordinate)
 * - y: 13 bits (max 8192 coordinate)
 * Note: Key value 0xFFFFFFFF is reserved as empty sentinel
 */
export function encodeKey(level: number, x: number, y: number): number {
  return ((level & 0x1f) << 26) | ((x & 0x1fff) << 13) | (y & 0x1fff);
}

/**
 * Decode a 32-bit key back into (level, x, y)
 */
export function decodeKey(key: number): { level: number; x: number; y: number } {
  return {
    level: (key >>> 26) & 0x1f,
    x: (key >>> 13) & 0x1fff,
    y: key & 0x1fff,
  };
}

/**
 * Compute hash for open addressing.
 * Uses multiply-shift hash with golden ratio constant.
 * @param key The encoded key
 * @param sizeMask Size - 1 (size must be power of 2)
 */
function hash(key: number, sizeMask: number): number {
  // Knuth's multiplicative hash (golden ratio * 2^32)
  return (((key >>> 0) * 2654435769) >>> 0) & sizeMask;
}

/**
 * Get next power of 2 >= n
 */
function nextPowerOf2(n: number): number {
  if (n <= 1) return 1;
  n--;
  n |= n >> 1;
  n |= n >> 2;
  n |= n >> 4;
  n |= n >> 8;
  n |= n >> 16;
  return n + 1;
}

/**
 * Spatial index using typed arrays for GPU-compatible O(1) node lookup.
 * Uses open addressing hash table with linear probing.
 */
export class SpatialIndex {
  /** Packed (level, x, y) keys */
  private keys: Uint32Array;
  /** Node indices corresponding to each key */
  private values: Uint16Array;
  /** Size of the hash table (power of 2) */
  private size: number;
  /** Bitmask for fast modulo (size - 1) */
  private sizeMask: number;
  /** Number of entries in the table */
  private count = 0;

  constructor(maxNodes: number) {
    // Use load factor ~50% for good performance
    this.size = nextPowerOf2(maxNodes * 2);
    this.sizeMask = this.size - 1;
    this.keys = new Uint32Array(this.size);
    this.values = new Uint16Array(this.size);
    this.clear();
  }

  /**
   * Clear the spatial index
   */
  clear(): void {
    this.keys.fill(HASH_EMPTY);
    this.values.fill(EMPTY_SENTINEL_VALUE);
    this.count = 0;
  }

  /**
   * Insert a node into the spatial index
   * @param level Node level
   * @param x Node x coordinate
   * @param y Node y coordinate
   * @param nodeIndex Index of the node in the quadtree
   */
  insert(level: number, x: number, y: number, nodeIndex: number): void {
    const key = encodeKey(level, x, y);
    let slot = hash(key, this.sizeMask);

    // Linear probing to find empty slot or existing key
    while (this.keys[slot] !== HASH_EMPTY && this.keys[slot] !== key) {
      slot = (slot + 1) & this.sizeMask;
    }

    if (this.keys[slot] === HASH_EMPTY) {
      this.count++;
    }

    this.keys[slot] = key;
    this.values[slot] = nodeIndex;
  }

  /**
   * Lookup a node by its (level, x, y) coordinates
   * @returns Node index or EMPTY_SENTINEL_VALUE if not found
   */
  lookup(level: number, x: number, y: number): number {
    const key = encodeKey(level, x, y);
    let slot = hash(key, this.sizeMask);

    // Linear probing to find key
    while (this.keys[slot] !== HASH_EMPTY) {
      if (this.keys[slot] === key) {
        return this.values[slot];
      }
      slot = (slot + 1) & this.sizeMask;
    }

    return EMPTY_SENTINEL_VALUE;
  }

  /**
   * Check if a node exists at the given coordinates
   */
  has(level: number, x: number, y: number): boolean {
    return this.lookup(level, x, y) !== EMPTY_SENTINEL_VALUE;
  }

  /**
   * Get the number of entries in the index
   */
  getCount(): number {
    return this.count;
  }

  /**
   * Get buffer references for GPU upload
   */
  getBuffers(): { keys: Uint32Array; values: Uint16Array } {
    return { keys: this.keys, values: this.values };
  }

  /**
   * Get the size of the hash table
   */
  getSize(): number {
    return this.size;
  }
}

// ============================================================================
// Neighbor Finding Functions
// ============================================================================

/**
 * Direction deltas for neighbor position calculation
 * [dx, dy] for each direction
 */
const DIRECTION_DELTAS: readonly [number, number][] = [
  [-1, 0], // LEFT
  [1, 0], // RIGHT
  [0, -1], // TOP
  [0, 1], // BOTTOM
];

/**
 * Compute the theoretical neighbor position at the same level.
 * @returns [level, x, y] or null if outside valid range (negative coords)
 */
export function computeNeighborPosition(
  level: number,
  x: number,
  y: number,
  direction: Direction,
): [number, number, number] | null {
  const [dx, dy] = DIRECTION_DELTAS[direction];
  const nx = x + dx;
  const ny = y + dy;

  // Check for boundary (negative coordinates are outside the quadtree)
  if (nx < 0 || ny < 0) {
    return null;
  }

  // Check for upper boundary (max coordinate at this level is 2^level - 1)
  const maxCoord = (1 << level) - 1;
  if (nx > maxCoord || ny > maxCoord) {
    return null;
  }

  return [level, nx, ny];
}

/**
 * Find the same-level neighbor of a node.
 * @param nodeView The QuadtreeNodeView
 * @param spatialIndex The spatial index for O(1) lookup
 * @param nodeIndex Index of the node to find neighbor for
 * @param direction Direction to look
 * @returns Node index or EMPTY_SENTINEL_VALUE if not found/boundary
 */
export function findNeighborAtSameLevel(
  nodeView: QuadtreeNodeView,
  spatialIndex: SpatialIndex,
  nodeIndex: number,
  direction: Direction,
): number {
  const level = nodeView.getLevel(nodeIndex);
  const x = nodeView.getX(nodeIndex);
  const y = nodeView.getY(nodeIndex);

  const neighborPos = computeNeighborPosition(level, x, y, direction);
  if (neighborPos === null) {
    return EMPTY_SENTINEL_VALUE;
  }

  const [nLevel, nx, ny] = neighborPos;
  return spatialIndex.lookup(nLevel, nx, ny);
}

/**
 * Find a coarser (larger) neighbor by walking up levels.
 * Used when the same-level neighbor doesn't exist.
 * @returns Node index of the coarser neighbor or EMPTY_SENTINEL_VALUE
 */
export function findCoarserNeighbor(
  nodeView: QuadtreeNodeView,
  spatialIndex: SpatialIndex,
  nodeIndex: number,
  direction: Direction,
): number {
  let level = nodeView.getLevel(nodeIndex);
  let x = nodeView.getX(nodeIndex);
  let y = nodeView.getY(nodeIndex);

  // Walk up the tree looking for a neighbor at coarser levels
  while (level > 0) {
    // Scale coordinates to parent level
    level--;
    x = x >> 1;
    y = y >> 1;

    // Compute neighbor position at this coarser level
    const neighborPos = computeNeighborPosition(level, x, y, direction);
    if (neighborPos === null) {
      // Hit boundary
      return EMPTY_SENTINEL_VALUE;
    }

    const [nLevel, nx, ny] = neighborPos;
    const neighborIndex = spatialIndex.lookup(nLevel, nx, ny);

    if (neighborIndex !== EMPTY_SENTINEL_VALUE) {
      // Found a node at this level - check if it's a leaf
      if (nodeView.getLeaf(neighborIndex)) {
        return neighborIndex;
      }
      // Node exists but is not a leaf, keep looking up
      // (this means our actual neighbor is finer, not coarser)
    }
  }

  return EMPTY_SENTINEL_VALUE;
}

/**
 * Find finer (smaller) neighbors along an edge.
 * Used when the same-level neighbor exists but has children.
 * @param nodeView The QuadtreeNodeView
 * @param neighborIndex The same-level neighbor that has children
 * @param direction Direction from the original node to the neighbor
 * @returns Array of leaf node indices along the shared edge
 */
export function findFinerNeighbors(
  nodeView: QuadtreeNodeView,
  neighborIndex: number,
  direction: Direction,
): number[] {
  const result: number[] = [];

  // Determine which children of the neighbor share an edge with us
  // The children on the opposite side of our direction
  const childrenToCheck = getOppositeEdgeChildren(direction);

  collectLeafDescendants(nodeView, neighborIndex, childrenToCheck, result);

  return result;
}

/**
 * Get child indices that are on the opposite edge (the edge touching the querying node).
 * Child layout: [0: top-left, 1: top-right, 2: bottom-left, 3: bottom-right]
 */
function getOppositeEdgeChildren(direction: Direction): number[] {
  switch (direction) {
    case Direction.LEFT:
      // We're looking left, neighbor's RIGHT edge children (1, 3)
      return [1, 3];
    case Direction.RIGHT:
      // We're looking right, neighbor's LEFT edge children (0, 2)
      return [0, 2];
    case Direction.TOP:
      // We're looking up, neighbor's BOTTOM edge children (2, 3)
      return [2, 3];
    case Direction.BOTTOM:
      // We're looking down, neighbor's TOP edge children (0, 1)
      return [0, 1];
    default:
      return [];
  }
}

/**
 * Recursively collect leaf descendants along an edge
 */
function collectLeafDescendants(
  nodeView: QuadtreeNodeView,
  nodeIndex: number,
  edgeChildren: number[],
  result: number[],
): void {
  if (nodeView.getLeaf(nodeIndex)) {
    result.push(nodeIndex);
    return;
  }

  const children = nodeView.getChildren(nodeIndex);

  for (const childIdx of edgeChildren) {
    const child = children[childIdx];
    if (child !== EMPTY_SENTINEL_VALUE) {
      // Recursively collect, keeping to the same edge
      collectLeafDescendants(nodeView, child, edgeChildren, result);
    }
  }
}

/**
 * Find the neighbor(s) of a node in a given direction.
 * Handles neighbors at same level, coarser level, or finer level.
 *
 * @param nodeView The QuadtreeNodeView
 * @param spatialIndex The spatial index for O(1) lookup
 * @param nodeIndex Index of the node to find neighbor for
 * @param direction Direction to look
 * @returns Single node index, array of node indices, or EMPTY_SENTINEL_VALUE
 */
export function findNeighbor(
  nodeView: QuadtreeNodeView,
  spatialIndex: SpatialIndex,
  nodeIndex: number,
  direction: Direction,
): number | number[] {
  const level = nodeView.getLevel(nodeIndex);
  const x = nodeView.getX(nodeIndex);
  const y = nodeView.getY(nodeIndex);

  // Check boundary first
  const neighborPos = computeNeighborPosition(level, x, y, direction);
  if (neighborPos === null) {
    return EMPTY_SENTINEL_VALUE;
  }

  // Try same-level lookup
  const [nLevel, nx, ny] = neighborPos;
  const sameLevelNeighbor = spatialIndex.lookup(nLevel, nx, ny);

  if (sameLevelNeighbor !== EMPTY_SENTINEL_VALUE) {
    // Found a node at same level
    if (nodeView.getLeaf(sameLevelNeighbor)) {
      // It's a leaf - this is our neighbor
      return sameLevelNeighbor;
    }
    // It's not a leaf - find finer neighbors along the edge
    return findFinerNeighbors(nodeView, sameLevelNeighbor, direction);
  }

  // No same-level neighbor - look for coarser neighbor
  return findCoarserNeighbor(nodeView, spatialIndex, nodeIndex, direction);
}

/**
 * Find all neighbors of a node in all four directions.
 * Optimized batch version that computes all neighbors at once.
 *
 * @param nodeView The QuadtreeNodeView
 * @param spatialIndex The spatial index for O(1) lookup
 * @param nodeIndex Index of the node to find neighbors for
 * @returns NeighborResult with neighbors in all four directions
 */
export function findAllNeighbors(
  nodeView: QuadtreeNodeView,
  spatialIndex: SpatialIndex,
  nodeIndex: number,
): NeighborResult {
  return {
    left: findNeighbor(nodeView, spatialIndex, nodeIndex, Direction.LEFT),
    right: findNeighbor(nodeView, spatialIndex, nodeIndex, Direction.RIGHT),
    top: findNeighbor(nodeView, spatialIndex, nodeIndex, Direction.TOP),
    bottom: findNeighbor(nodeView, spatialIndex, nodeIndex, Direction.BOTTOM),
  };
}

/**
 * Build a spatial index from a QuadtreeNodeView.
 * Should be called after the quadtree is updated.
 *
 * @param nodeView The QuadtreeNodeView
 * @param nodeCount Number of nodes in the quadtree
 * @param spatialIndex Optional existing spatial index to reuse
 * @returns The populated spatial index
 */
export function buildSpatialIndex(
  nodeView: QuadtreeNodeView,
  nodeCount: number,
  spatialIndex?: SpatialIndex,
): SpatialIndex {
  const index = spatialIndex ?? new SpatialIndex(nodeView.getMaxNodeCount());
  index.clear();

  for (let i = 0; i < nodeCount; i++) {
    const level = nodeView.getLevel(i);
    const x = nodeView.getX(i);
    const y = nodeView.getY(i);
    index.insert(level, x, y, i);
  }

  return index;
}
