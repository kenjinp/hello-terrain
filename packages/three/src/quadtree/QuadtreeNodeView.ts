export type NeighborIndices = [number, number, number, number]; // [left, right, top, bottom]
export type ChildIndices = [number, number, number, number]; // [left, right, top, bottom]

// These are the properties we care about for a node;
export interface NodeProps {
  level: number;
  x: number;
  y: number;
  children: ChildIndices;
  neighbors: NeighborIndices;
  leaf: boolean;
}

const CHILDREN_STRIDE = 4;
const NEIGHBORS_STRIDE = 4;
const NODE_STRIDE = 4; // level, x, y, active

// this sentinal value will be used to indicate an empty index
// this means we have 65,535 - 1 available indices
const U_INT_16_MAX_VALUE = 0xffff;
export const EMPTY_SENTINEL_VALUE = U_INT_16_MAX_VALUE;

/**
 * Class that manages all node-related buffer arrays and provides access methods
 */
export class QuadtreeNodeView {
  private maxNodeCount: number;
  private childrenIndicesBuffer: Uint16Array;
  private neighborsIndicesBuffer: Uint16Array;
  private nodeBuffer: Int32Array;
  private leafNodeMask: Uint8Array;
  private leafNodeCountBuffer: Uint16Array;
  private activeLeafIndices: Uint16Array;
  private activeLeafCount = 0;

  constructor(
    maxNodeCount: number,
    childrenIndicesBuffer?: Uint16Array,
    neighborsIndicesBuffer?: Uint16Array,
    nodeBuffer?: Int32Array,
    leafNodeMask?: Uint8Array,
    leafNodeCountBuffer?: Uint16Array,
  ) {
    this.maxNodeCount = maxNodeCount;

    // Initialize all buffers
    this.childrenIndicesBuffer =
      childrenIndicesBuffer ?? new Uint16Array(CHILDREN_STRIDE * maxNodeCount);
    this.neighborsIndicesBuffer =
      neighborsIndicesBuffer ?? new Uint16Array(NEIGHBORS_STRIDE * maxNodeCount);
    this.nodeBuffer = nodeBuffer ?? new Int32Array(NODE_STRIDE * maxNodeCount);
    this.leafNodeMask = leafNodeMask ?? new Uint8Array(maxNodeCount);
    this.leafNodeCountBuffer = leafNodeCountBuffer ?? new Uint16Array(1);
    this.activeLeafIndices = new Uint16Array(maxNodeCount);

    this.clear();
  }

  /**
   * Clear all buffers
   */
  clear(): void {
    this.nodeBuffer.fill(0);
    // using sentinel values to indicate an empty index
    this.childrenIndicesBuffer.fill(EMPTY_SENTINEL_VALUE);
    this.neighborsIndicesBuffer.fill(EMPTY_SENTINEL_VALUE);
    this.leafNodeMask.fill(0);
    this.leafNodeCountBuffer[0] = 0;
    this.activeLeafCount = 0;
  }

  /**
   * Get buffer references for direct access (useful for GPU operations)
   */
  getBuffers() {
    return {
      childrenIndicesBuffer: this.childrenIndicesBuffer,
      neighborsIndicesBuffer: this.neighborsIndicesBuffer,
      nodeBuffer: this.nodeBuffer,
      leafNodeMask: this.leafNodeMask,
    };
  }

  /**
   * Get the maximum node count
   */
  getMaxNodeCount(): number {
    return this.maxNodeCount;
  }

  // Getters for individual buffer values
  getLevel(index: number): number {
    return this.nodeBuffer[index * NODE_STRIDE];
  }

  getX(index: number): number {
    return this.nodeBuffer[index * NODE_STRIDE + 1];
  }

  getY(index: number): number {
    return this.nodeBuffer[index * NODE_STRIDE + 2];
  }

  getLeafNodeCount(): number {
    return this.leafNodeCountBuffer[0];
  }

  getLeaf(index: number): boolean {
    return this.leafNodeMask[index] === 1;
  }

  getChildren(index: number): ChildIndices {
    const offset = index * CHILDREN_STRIDE;
    return [
      this.childrenIndicesBuffer[offset],
      this.childrenIndicesBuffer[offset + 1],
      this.childrenIndicesBuffer[offset + 2],
      this.childrenIndicesBuffer[offset + 3],
    ] as ChildIndices;
  }

  getNeighbors(index: number): NeighborIndices {
    const offset = index * NEIGHBORS_STRIDE;
    return [
      this.neighborsIndicesBuffer[offset],
      this.neighborsIndicesBuffer[offset + 1],
      this.neighborsIndicesBuffer[offset + 2],
      this.neighborsIndicesBuffer[offset + 3],
    ] as NeighborIndices;
  }

  // Setters for individual buffer values
  setLevel(index: number, level: number): void {
    this.nodeBuffer[index * NODE_STRIDE] = level;
  }

  setX(index: number, x: number): void {
    this.nodeBuffer[index * NODE_STRIDE + 1] = x;
  }

  setY(index: number, y: number): void {
    this.nodeBuffer[index * NODE_STRIDE + 2] = y;
  }

  setLeaf(index: number, leaf: boolean): void {
    const wasLeaf = this.leafNodeMask[index] === 1;
    const newValue = leaf ? 1 : 0;

    if (leaf && !wasLeaf) {
      this.leafNodeCountBuffer[0]++;
      this.leafNodeMask[index] = 1;
      this.activeLeafIndices[this.activeLeafCount] = index;
      this.activeLeafCount++;
      // this is a leaf node, so we need to clear the children
      this.setChildren(index, [
        EMPTY_SENTINEL_VALUE,
        EMPTY_SENTINEL_VALUE,
        EMPTY_SENTINEL_VALUE,
        EMPTY_SENTINEL_VALUE,
      ]);
    } else if (!leaf && wasLeaf) {
      this.leafNodeCountBuffer[0]--;
      this.leafNodeMask[index] = 0;
    }

    // maybe we don't need this...
    this.nodeBuffer[index * NODE_STRIDE + 3] = newValue;
  }

  setChildren(index: number, children: ChildIndices): void {
    const offset = index * CHILDREN_STRIDE;
    this.childrenIndicesBuffer[offset] = children[0];
    this.childrenIndicesBuffer[offset + 1] = children[1];
    this.childrenIndicesBuffer[offset + 2] = children[2];
    this.childrenIndicesBuffer[offset + 3] = children[3];
  }

  setNeighbors(index: number, neighbors: NeighborIndices): void {
    const offset = index * NEIGHBORS_STRIDE;
    this.neighborsIndicesBuffer[offset] = neighbors[0];
    this.neighborsIndicesBuffer[offset + 1] = neighbors[1];
    this.neighborsIndicesBuffer[offset + 2] = neighbors[2];
    this.neighborsIndicesBuffer[offset + 3] = neighbors[3];
  }

  /**
   * Get array of active leaf node indices with count (zero-copy, no allocation)
   */
  getActiveLeafNodeIndices(): { indices: Uint16Array; count: number } {
    return {
      indices: this.activeLeafIndices,
      count: this.activeLeafCount,
    };
  }

  /**
   * Release internal buffers and mark this view as destroyed
   */
  destroy(): void {
    // Replace buffers with zero-length views to allow GC
    this.childrenIndicesBuffer = new Uint16Array(0);
    this.neighborsIndicesBuffer = new Uint16Array(0);
    this.nodeBuffer = new Int32Array(0);
    this.leafNodeMask = new Uint8Array(0);
    this.leafNodeCountBuffer = new Uint16Array(0);
    this.maxNodeCount = 0;
  }

  clone(): QuadtreeNodeView {
    return new QuadtreeNodeView(
      this.maxNodeCount,
      this.childrenIndicesBuffer,
      this.neighborsIndicesBuffer,
      this.nodeBuffer,
      this.leafNodeMask,
      this.leafNodeCountBuffer,
    );
  }
}
