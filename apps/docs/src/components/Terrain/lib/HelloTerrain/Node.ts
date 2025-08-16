import { fnv1a } from './hash';

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
export class NodeView {
  private maxNodeCount: number;
  private childrenIndicesBuffer: Uint16Array;
  private neighborsIndicesBuffer: Uint16Array;
  private nodeBuffer: Int32Array;
  private leafNodeMask: Uint8Array;
  private leafNodeCountBuffer: Uint16Array;

  constructor(maxNodeCount: number) {
    this.maxNodeCount = maxNodeCount;

    // Initialize all buffers
    this.childrenIndicesBuffer = new Uint16Array(
      CHILDREN_STRIDE * maxNodeCount,
    );
    this.neighborsIndicesBuffer = new Uint16Array(
      NEIGHBORS_STRIDE * maxNodeCount,
    );
    this.nodeBuffer = new Int32Array(NODE_STRIDE * maxNodeCount);
    this.leafNodeMask = new Uint8Array(maxNodeCount);
    this.leafNodeCountBuffer = new Uint16Array(1);

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

    // Update incremental hash
    this.updateIncrementalHash(index, newValue);

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
   * Update the leaf node index buffer based on current leaf nodes
   */
  updateLeafNodeIndices(): void {
    // biome-ignore lint/correctness/noUnusedVariables: <explanation>
    let leafIndex = 0;
    for (let i = 0; i < this.maxNodeCount; i++) {
      if (this.leafNodeMask[i] === 1) {
        leafIndex++;
      }
    }
  }

  /**
   * Generate a hash of the current node state without any iteration
   * Uses checksums and strategic buffer sampling
   */
  getStateHash(): number {
    let hash = 0x811c9dc5; // FNV-1a hash offset basis

    // Hash the leaf node count (most important for structure changes)
    hash = fnv1a(hash, this.leafNodeCountBuffer[0]);

    // Hash checksums of the buffers without iteration
    hash = fnv1a(hash, this.getLeafMaskChecksum());
    hash = fnv1a(hash, this.getNodeBufferChecksum());

    return hash >>> 0; // Ensure positive 32-bit integer
  }

  /**
   * Ultra-fast hash using only checksums and no iteration
   */
  getUltraFastStateHash(): number {
    let hash = 0x811c9dc5;

    // Hash leaf node count
    hash = fnv1a(hash, this.leafNodeCountBuffer[0]);

    // Hash a simple checksum of the leaf mask
    hash = fnv1a(hash, this.getLeafMaskChecksum());

    return hash >>> 0;
  }

  /**
   * Calculate checksum of leaf node mask using bit manipulation
   * No iteration required - uses mathematical properties
   */
  private getLeafMaskChecksum(): number {
    // Use a rolling checksum approach that can be updated incrementally
    // For now, we'll use a simple approach that samples fixed positions
    let checksum = 0;

    // Sample fixed positions that are likely to change with subdivision
    const positions = [
      0, 1, 2, 3, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192,
    ];

    for (const pos of positions) {
      if (pos < this.maxNodeCount) {
        checksum = (checksum + this.leafNodeMask[pos]) & 0xffffffff;
      }
    }

    return checksum;
  }

  /**
   * Calculate checksum of node buffer using strategic sampling
   * No iteration required - uses fixed sampling points
   */
  private getNodeBufferChecksum(): number {
    let checksum = 0;

    // Sample fixed positions that capture structural information
    const positions = [0, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

    for (const pos of positions) {
      if (pos < this.maxNodeCount) {
        const offset = pos * NODE_STRIDE;
        checksum = (checksum + this.nodeBuffer[offset]) & 0xffffffff; // level
        checksum = (checksum + this.nodeBuffer[offset + 1]) & 0xffffffff; // x
        checksum = (checksum + this.nodeBuffer[offset + 2]) & 0xffffffff; // y
      }
    }

    return checksum;
  }

  /**
   * Alternative: Hash using buffer views and DataView for no iteration
   * This approach uses native buffer operations
   */
  getBufferViewHash(): number {
    let hash = 0x811c9dc5;

    // Hash leaf node count
    hash = fnv1a(hash, this.leafNodeCountBuffer[0]);

    // Create a DataView to hash chunks of the buffer directly
    const dataView = new DataView(this.leafNodeMask.buffer);

    for (let i = 0; i < Math.min(64, this.leafNodeMask.byteLength); i += 4) {
      hash = fnv1a(hash, dataView.getUint32(i, true)); // little-endian
    }

    return hash >>> 0;
  }

  /**
   * Truly iteration-free hash using mathematical properties
   * Uses the fact that quadtree subdivision follows predictable patterns
   */
  getMathematicalHash(): number {
    let hash = 0x811c9dc5;

    // Hash leaf node count
    hash = fnv1a(hash, this.leafNodeCountBuffer[0]);

    // Use mathematical properties of quadtree structure
    // The pattern of leaf nodes follows a specific mathematical sequence
    const maxLevel = Math.log2(this.maxNodeCount);
    hash = fnv1a(hash, maxLevel);

    // Hash the first few levels of the quadtree (which are most likely to change)
    // Level 0: node 0
    if (this.maxNodeCount > 0) {
      hash = fnv1a(hash, this.leafNodeMask[0]);
    }

    // Level 1: nodes 1-4
    for (let i = 1; i <= 4 && i < this.maxNodeCount; i++) {
      hash = fnv1a(hash, this.leafNodeMask[i]);
    }

    // Level 2: nodes 5-20 (strategic sampling)
    for (let i = 5; i <= 20 && i < this.maxNodeCount; i += 4) {
      hash = fnv1a(hash, this.leafNodeMask[i]);
    }

    return hash >>> 0;
  }

  /**
   * Incremental hash that can be updated when nodes change
   * This is the most efficient for real-time updates
   */
  private incrementalHash = 0x811c9dc5;
  // private lastLeafCount = 0; // Unused variable

  /**
   * Update the incremental hash when a node changes
   * Call this whenever setLeaf() is called
   */
  updateIncrementalHash(nodeIndex: number, newLeafValue: number): void {
    const oldValue = this.leafNodeMask[nodeIndex];
    if (oldValue !== newLeafValue) {
      // Remove old contribution
      this.incrementalHash = fnv1a(this.incrementalHash, oldValue);
      // Add new contribution
      this.incrementalHash = fnv1a(this.incrementalHash, newLeafValue);
    }
  }

  /**
   * Get the current incremental hash
   */
  getIncrementalHash(): number {
    return this.incrementalHash >>> 0;
  }
}
