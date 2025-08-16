import * as THREE from 'three';
import {
  type ChildIndices,
  EMPTY_SENTINEL_VALUE,
  type NeighborIndices,
  NodeView,
} from './Node';

export interface QuadtreeConfig {
  maxLevel: number;
  rootSize: number;
  minNodeSize: number;
  origin: THREE.Vector3;
  subdivisionFactor: number;
  maxNodes: number;
}

const tempVector3 = new THREE.Vector3();

export class Quadtree {
  private nodeCount = 0;
  private deepestLevel = 0;
  private config: QuadtreeConfig;
  private nodeView: NodeView;

  // Pre-allocated buffers to avoid object creation
  private tempChildIndices: ChildIndices = [-1, -1, -1, -1];
  private tempNeighborIndices: NeighborIndices = [-1, -1, -1, -1];

  constructor(config: QuadtreeConfig) {
    this.config = config;
    this.nodeView = new NodeView(config.maxNodes);
    this.initialize();
  }

  private initialize(): void {
    this.nodeView.clear();
    this.nodeCount = 0;
    this.deepestLevel = 0;

    // Create root node
    this.createNode(0, 0, 0);
  }

  /**
   * Update the quadtree based on the given position
   */
  update(position: THREE.Vector3): void {
    this.reset();

    // Start from root node
    this.updateNode(0, position);

    // Update the leaf node index buffer after all updates are complete
    this.nodeView.updateLeafNodeIndices();
  }

  /**
   * Recursively update a node and its children based on distance and size criteria
   */
  private updateNode(nodeIndex: number, position: THREE.Vector3): void {
    const nodeSize =
      this.config.rootSize / (1 << this.nodeView.getLevel(nodeIndex));

    // Calculate node center position (matching the shader calculation)
    const nodeX = this.nodeView.getX(nodeIndex);
    const nodeY = this.nodeView.getY(nodeIndex);
    const worldX =
      this.config.origin.x +
      ((nodeX + 0.5) * nodeSize - 0.5 * this.config.rootSize);
    const worldZ =
      this.config.origin.z +
      ((nodeY + 0.5) * nodeSize - 0.5 * this.config.rootSize);

    tempVector3.set(worldX, this.config.origin.y, worldZ);

    // Calculate 3D distance using Vector3's built-in method
    const distance = position.distanceTo(tempVector3);

    const shouldSubdivide = this.shouldSubdivide(
      this.nodeView.getLevel(nodeIndex),
      distance,
      nodeSize,
    );

    if (
      shouldSubdivide &&
      this.nodeView.getLevel(nodeIndex) < this.config.maxLevel
    ) {
      // Subdivide this node
      this.subdivideNode(nodeIndex);

      // Update children
      const children = this.nodeView.getChildren(nodeIndex);
      for (let i = 0; i < 4; i++) {
        if (children[i] !== -1) {
          this.updateNode(children[i], position);
        }
      }

      // Deactivate this node since it's subdivided
      this.nodeView.setLeaf(nodeIndex, false);
    } else {
      // This is a leaf node - activate it
      this.nodeView.setLeaf(nodeIndex, true);
    }
  }

  /**
   * Determine if a node should be subdivided based on distance and size criteria
   */
  private shouldSubdivide(
    level: number,
    distance: number,
    nodeSize: number,
  ): boolean {
    // Don't subdivide if node is too small
    if (nodeSize <= this.config.minNodeSize) {
      return false;
    }

    // Use nodeSize directly as the threshold, multiplied by subdivision factor
    return distance < nodeSize * this.config.subdivisionFactor;
  }

  /**
   * Create a new node and return its index
   */
  private createNode(level: number, x: number, y: number): number {
    // Safety check to prevent buffer overflow
    if (this.nodeCount >= this.config.maxNodes) {
      console.warn('Maximum node count reached, skipping node creation');
      return -1;
    }

    // Update deepest level if this node is deeper
    if (level > this.deepestLevel) {
      this.deepestLevel = level;
    }

    // Clear temp buffers
    this.tempChildIndices[0] = EMPTY_SENTINEL_VALUE;
    this.tempChildIndices[1] = EMPTY_SENTINEL_VALUE;
    this.tempChildIndices[2] = EMPTY_SENTINEL_VALUE;
    this.tempChildIndices[3] = EMPTY_SENTINEL_VALUE;

    this.tempNeighborIndices[0] = EMPTY_SENTINEL_VALUE;
    this.tempNeighborIndices[1] = EMPTY_SENTINEL_VALUE;
    this.tempNeighborIndices[2] = EMPTY_SENTINEL_VALUE;
    this.tempNeighborIndices[3] = EMPTY_SENTINEL_VALUE;

    const nodeIndex = this.nodeCount++;
    this.nodeView.setLevel(nodeIndex, level);
    this.nodeView.setX(nodeIndex, x);
    this.nodeView.setY(nodeIndex, y);
    this.nodeView.setChildren(nodeIndex, this.tempChildIndices);
    this.nodeView.setNeighbors(nodeIndex, this.tempNeighborIndices);
    this.nodeView.setLeaf(nodeIndex, false);

    return nodeIndex;
  }

  /**
   * Subdivide a node by creating its four children
   */
  private subdivideNode(nodeIndex: number): void {
    // Create four children
    const childLevel = this.nodeView.getLevel(nodeIndex) + 1;
    const childX = this.nodeView.getX(nodeIndex) * 2;
    const childY = this.nodeView.getY(nodeIndex) * 2;

    // Create children and store their indices
    const childIndices: ChildIndices = [
      this.createNode(childLevel, childX, childY), // top-left
      this.createNode(childLevel, childX + 1, childY), // top-right
      this.createNode(childLevel, childX, childY + 1), // bottom-left
      this.createNode(childLevel, childX + 1, childY + 1), // bottom-right
    ];

    // Check if any child creation failed
    if (childIndices.some((index) => index === -1)) {
      console.warn('Failed to create all children, skipping subdivision');
      return;
    }

    // Update parent's children
    this.nodeView.setChildren(nodeIndex, childIndices);

    // Update children's neighbors and parent references
    this.updateChildNeighbors(nodeIndex, childIndices);
  }

  /**
   * Update neighbor relationships for child nodes
   */
  private updateChildNeighbors(
    parentIndex: number,
    childIndices: ChildIndices,
  ): void {
    // For each child, find its neighbors
    for (let i = 0; i < 4; i++) {
      const childIndex = childIndices[i];

      // Clear temp neighbor buffer
      this.tempNeighborIndices[0] = EMPTY_SENTINEL_VALUE;
      this.tempNeighborIndices[1] = EMPTY_SENTINEL_VALUE;
      this.tempNeighborIndices[2] = EMPTY_SENTINEL_VALUE;
      this.tempNeighborIndices[3] = EMPTY_SENTINEL_VALUE;

      // Calculate child's position within parent
      const childX = i % 2;
      const childY = Math.floor(i / 2);

      // Set internal neighbors (siblings) only
      if (childX === 0 && i + 1 < 4) {
        this.tempNeighborIndices[1] = childIndices[i + 1]; // right neighbor
      } else if (childX === 1 && i - 1 >= 0) {
        this.tempNeighborIndices[0] = childIndices[i - 1]; // left neighbor
      }

      if (childY === 0 && i + 2 < 4) {
        this.tempNeighborIndices[3] = childIndices[i + 2]; // bottom neighbor
      } else if (childY === 1 && i - 2 >= 0) {
        this.tempNeighborIndices[2] = childIndices[i - 2]; // top neighbor
      }

      this.nodeView.setNeighbors(childIndex, this.tempNeighborIndices);
    }
  }

  /**
   * Get the deepest subdivision level currently in the quadtree
   */
  getDeepestLevel(): number {
    return this.deepestLevel;
  }

  /**
   * Get the total number of nodes
   */
  getNodeCount(): number {
    return this.nodeCount;
  }

  getLeafNodeCount(): number {
    return this.nodeView.getLeafNodeCount();
  }

  /**
   * Get the configuration
   */
  getConfig(): QuadtreeConfig {
    return this.config;
  }

  /**
   * Get all leaf nodes as an array of node objects
   */
  getLeafNodes(): Array<{ level: number; x: number; y: number }> {
    const leafNodes: Array<{ level: number; x: number; y: number }> = [];

    for (let i = 0; i < this.nodeCount; i++) {
      if (this.nodeView.getLeaf(i)) {
        leafNodes.push({
          level: this.nodeView.getLevel(i),
          x: this.nodeView.getX(i),
          y: this.nodeView.getY(i),
        });
      }
    }

    return leafNodes;
  }

  /**
   * Reset the quadtree
   */
  reset(): void {
    this.initialize();
  }

  /**
   * Get the NodeView instance for direct access
   */
  getNodeView(): NodeView {
    return this.nodeView;
  }

  /**
   * Generate a fast hash of the current quadtree state
   * This hash is consistent for the same configuration and leaf node structure
   */
  getStateHash(): number {
    return this.nodeView.getBufferViewHash();
  }

  /**
   * Check if the quadtree state has changed by comparing hashes
   * Returns true if the state is different from the provided previous hash
   */
  hasStateChanged(previousHash: number): boolean {
    return this.getStateHash() !== previousHash;
  }
}
