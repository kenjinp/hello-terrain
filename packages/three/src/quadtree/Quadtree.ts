import * as THREE from "three";
import {
  type ChildIndices,
  EMPTY_SENTINEL_VALUE,
  type NeighborIndices,
  QuadtreeNodeView,
} from "./QuadtreeNodeView";
import {
  type SubdivisionContext,
  type SubdivisionStrategy,
  distanceBasedSubdivision,
} from "./subdivision-strategies";

export {
  computeScreenSpaceInfo,
  distanceBasedSubdivision,
  screenSpaceSubdivision,
} from "./subdivision-strategies";
export type {
  ScreenSpaceInfo,
  SubdivisionContext,
  SubdivisionStrategy,
} from "./subdivision-strategies";

export interface QuadtreeParams {
  maxLevel: number;
  rootSize: number;
  minNodeSize: number;
  origin: THREE.Vector3;
  maxNodes: number;
}

const tempVector3 = new THREE.Vector3();
const tempBox3 = new THREE.Box3();
const tempMin = new THREE.Vector3();
const tempMax = new THREE.Vector3();

export class Quadtree {
  private nodeCount = 0;
  private deepestLevel = 0;
  private config: QuadtreeParams;
  private nodeView: QuadtreeNodeView;
  private subdivisionStrategy: SubdivisionStrategy;

  // Pre-allocated buffers to avoid object creation
  private tempChildIndices: ChildIndices = [-1, -1, -1, -1];
  private tempNeighborIndices: NeighborIndices = [-1, -1, -1, -1];

  /**
   * Create a new Quadtree.
   *
   * @param config Quadtree configuration parameters
   * @param subdivisionStrategy Strategy function for subdivision decisions.
   *        Defaults to distanceBasedSubdivision(2).
   * @param nodeView Optional pre-allocated NodeView for buffer reuse
   */
  constructor(
    config: QuadtreeParams,
    subdivisionStrategy?: SubdivisionStrategy,
    nodeView?: QuadtreeNodeView,
  ) {
    this.config = config;
    this.subdivisionStrategy = subdivisionStrategy ?? distanceBasedSubdivision(2);
    this.nodeView = nodeView ?? new QuadtreeNodeView(config.maxNodes);
    this.initialize();
  }

  /**
   * Set the subdivision strategy.
   * Use this to change LOD behavior at runtime.
   *
   * @param strategy The subdivision strategy function
   */
  setSubdivisionStrategy(strategy: SubdivisionStrategy): void {
    this.subdivisionStrategy = strategy;
  }

  /**
   * Get the current subdivision strategy
   */
  getSubdivisionStrategy(): SubdivisionStrategy {
    return this.subdivisionStrategy;
  }

  private initialize(): void {
    this.nodeView.clear();
    this.nodeCount = 0;
    this.deepestLevel = 0;

    // Create root node
    this.createNode(0, 0, 0);
  }

  /**
   * Update the quadtree based on the given position and return the index
   * of the leaf node that best corresponds to the position (closest leaf).
   */
  update(position: THREE.Vector3, frustum?: THREE.Frustum): number {
    this.reset();

    // Start from root node and capture the closest leaf index
    const closestLeafIndex = this.updateNode(0, position, frustum);

    return closestLeafIndex;
  }

  /**
   * Recursively update a node and its children based on distance and size criteria
   * and return the closest leaf node index to the provided position.
   */
  private updateNode(nodeIndex: number, position: THREE.Vector3, frustum?: THREE.Frustum): number {
    const level = this.nodeView.getLevel(nodeIndex);
    const nodeSize = this.config.rootSize / (1 << level);

    // Calculate node center position (matching the shader calculation)
    const nodeX = this.nodeView.getX(nodeIndex);
    const nodeY = this.nodeView.getY(nodeIndex);
    const minX = this.config.origin.x + (nodeX * nodeSize - 0.5 * this.config.rootSize);
    const minZ = this.config.origin.z + (nodeY * nodeSize - 0.5 * this.config.rootSize);
    const worldX = minX + 0.5 * nodeSize;
    const worldZ = minZ + 0.5 * nodeSize;

    // Frustum culling in world space.
    // IMPORTANT: terrain can extend far above/below origin.y, so a fixed vertical
    // bound around origin can incorrectly cull high-elevation tiles (leading to
    // reduced subdivision on mountain peaks). We expand the vertical range by
    // the camera/position altitude as a conservative, stable bound.
    if (frustum) {
      const altitude = Math.abs(position.y - this.config.origin.y);
      const verticalHalfExtent = this.config.rootSize + altitude;
      const minY = this.config.origin.y - verticalHalfExtent;
      const maxY = this.config.origin.y + verticalHalfExtent;
      tempMin.set(minX, minY, minZ);
      tempMax.set(minX + nodeSize, maxY, minZ + nodeSize);
      tempBox3.set(tempMin, tempMax);
      if (!frustum.intersectsBox(tempBox3)) {
        // Mark node as not active
        this.nodeView.setLeaf(nodeIndex, false);
        return -1;
      }
    }

    // adjust position.y to be origin.y + camera elevation,
    // so this effectively measures distance from the terrain surface.
    // Standing on a 500m mountain with camera at 502m passes adjustedY = origin.y + 2,
    // giving the same subdivision as standing on flat ground at height 2.
    tempVector3.set(worldX, this.config.origin.y, worldZ);
    const distance = position.distanceTo(tempVector3);

    const shouldSubdivide = this.shouldSubdivide(level, distance, nodeSize);

    if (shouldSubdivide && level < this.config.maxLevel) {
      // If we are out of capacity, do NOT attempt subdivision.
      // Attempting to subdivide when maxNodes is reached can leave the parent
      // deactivated with no active children, causing nothing to render.
      //
      // Instead, keep this node as a leaf and gracefully cap detail.
      if (this.nodeCount + 4 > this.config.maxNodes) {
        this.nodeView.setLeaf(nodeIndex, true);
        return nodeIndex;
      }

      // Subdivide this node
      this.subdivideNode(nodeIndex);

      // Update children
      const children = this.nodeView.getChildren(nodeIndex);
      let bestLeafIndex = -1;
      let bestDistSq = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 4; i++) {
        if (children[i] !== -1) {
          const leafIdx = this.updateNode(children[i], position, frustum);
          if (leafIdx !== -1) {
            // Compute center of the returned leaf and track the closest
            const leafLevel = this.nodeView.getLevel(leafIdx);
            const size = this.config.rootSize / (1 << leafLevel);
            const x = this.nodeView.getX(leafIdx);
            const y = this.nodeView.getY(leafIdx);
            const cx = this.config.origin.x + ((x + 0.5) * size - 0.5 * this.config.rootSize);
            const cz = this.config.origin.z + ((y + 0.5) * size - 0.5 * this.config.rootSize);
            const dx = position.x - cx;
            const dz = position.z - cz;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDistSq) {
              bestDistSq = d2;
              bestLeafIndex = leafIdx;
            }
          }
        }
      }

      // Deactivate this node since it's subdivided
      this.nodeView.setLeaf(nodeIndex, false);
      return bestLeafIndex;
    }
    // This is a leaf node - activate it
    this.nodeView.setLeaf(nodeIndex, true);
    return nodeIndex;
  }

  /**
   * Determine if a node should be subdivided using the configured strategy
   */
  private shouldSubdivide(level: number, distance: number, nodeSize: number): boolean {
    const context: SubdivisionContext = {
      level,
      distance,
      nodeSize,
      minNodeSize: this.config.minNodeSize,
      rootSize: this.config.rootSize,
    };
    return this.subdivisionStrategy(context);
  }

  /**
   * Create a new node and return its index
   */
  private createNode(level: number, x: number, y: number): number {
    // Safety check to prevent buffer overflow
    if (this.nodeCount >= this.config.maxNodes) {
      console.warn("Maximum node count reached, skipping node creation");
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
      console.warn("Failed to create all children, skipping subdivision");
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
    _parentIndex: number, // Unused parameter
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
   * Get active leaf node indices for efficient GPU processing
   */
  getActiveLeafNodeIndices(): { indices: Uint16Array; count: number } {
    return this.nodeView.getActiveLeafNodeIndices();
  }

  /**
   * Get the configuration
   */
  getConfig(): QuadtreeParams {
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
  getNodeView(): QuadtreeNodeView {
    return this.nodeView;
  }

  /**
   * Release internal resources associated with this quadtree
   */
  destroy(): void {
    this.nodeView.destroy();
    this.nodeCount = 0;
    this.deepestLevel = 0;
  }

  /**
   * Set the configuration
   */
  setConfig(config: QuadtreeParams, reset = false): void {
    this.config = config;
    if (reset) {
      this.initialize();
    }
  }
}
