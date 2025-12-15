import * as THREE from "three";
import {
  type ChildIndices,
  EMPTY_SENTINEL_VALUE,
  type NeighborIndices,
  NodeView,
} from "./Node";

export interface QuadtreeParams {
  maxLevel: number;
  rootSize: number;
  minNodeSize: number;
  origin: THREE.Vector3;
  maxNodes: number;
}

/**
 * Context passed to subdivision strategy functions.
 * Contains all information needed to make subdivision decisions.
 */
export interface SubdivisionContext {
  /** Current node's quadtree level (0 = root) */
  level: number;
  /** Distance from camera/position to node center in world units */
  distance: number;
  /** World-space size of the node (edge length) */
  nodeSize: number;
  /** Minimum allowed node size from config */
  minNodeSize: number;
  /** Root terrain size from config */
  rootSize: number;
  /**
   * Whether this node position was subdivided in the previous frame.
   * Use this for hysteresis to prevent oscillation at LOD boundaries.
   */
  wasSubdividedPreviously: boolean;
}

/**
 * Function type for subdivision strategies.
 * Returns true if the node should be subdivided, false otherwise.
 */
export type SubdivisionStrategy = (context: SubdivisionContext) => boolean;

// ============================================================================
// Built-in Subdivision Strategies
// ============================================================================

/**
 * Distance-based subdivision strategy with hysteresis to prevent LOD flickering.
 * Subdivides when: distance < nodeSize * factor
 * Uses hysteresis to prevent oscillation at threshold boundaries.
 *
 * @param factor Multiplier for subdivision threshold (default: 2)
 * @param hysteresis Hysteresis factor to prevent flickering (default: 0.15 = 15%)
 *        When a node was subdivided previously, it requires 15% more distance to collapse.
 * @returns SubdivisionStrategy function
 *
 * @example
 * ```ts
 * const terrain = new TerrainMesh({
 *   subdivisionStrategy: distanceBasedSubdivision(2.5, 0.2) // 20% hysteresis
 * });
 * ```
 */
export function distanceBasedSubdivision(
  factor = 2,
  hysteresis = 0.15
): SubdivisionStrategy {
  return (ctx: SubdivisionContext) => {
    if (ctx.nodeSize <= ctx.minNodeSize) {
      return false;
    }
    // Apply hysteresis: if previously subdivided, use a larger threshold to collapse
    // This creates a "dead zone" that prevents oscillation
    const effectiveFactor = ctx.wasSubdividedPreviously
      ? factor * (1 + hysteresis) // Harder to collapse (need more distance)
      : factor; // Normal threshold to subdivide
    return ctx.distance < ctx.nodeSize * effectiveFactor;
  };
}

/**
 * Screen-space subdivision strategy with hysteresis to prevent LOD flickering.
 * Subdivides based on projected triangle size in pixels.
 * Ensures triangles don't exceed a target pixel size on screen.
 *
 * @param options Configuration for screen-space subdivision
 * @returns SubdivisionStrategy function
 *
 * @example
 * ```ts
 * const strategy = screenSpaceSubdivision({
 *   targetTrianglePixels: 6,
 *   tileSegments: 13,
 *   hysteresis: 0.15,
 *   getScreenSpaceInfo: () => ({
 *     projectionFactor: screenHeight / (2 * Math.tan(camera.fov * Math.PI / 360)),
 *     screenHeight: window.innerHeight
 *   })
 * });
 * ```
 */
export function screenSpaceSubdivision(options: {
  /**
   * Target triangle size in screen pixels.
   * Subdivide when triangles would be larger than this.
   * Recommended: 4-8 pixels
   * @default 6
   */
  targetTrianglePixels?: number;
  /**
   * Number of segments per tile edge.
   * Should match TerrainMesh.innerTileSegments.
   * @default 13
   */
  tileSegments?: number;
  /**
   * Hysteresis factor to prevent LOD flickering (default: 0.15 = 15%)
   * When a node was subdivided previously, triangles need to be 15% smaller
   * before collapsing back.
   * @default 0.15
   */
  hysteresis?: number;
  /**
   * Function that returns current screen-space projection info.
   * Called each time subdivision is evaluated.
   */
  getScreenSpaceInfo: () => ScreenSpaceInfo | null;
}): SubdivisionStrategy {
  const targetTrianglePixels = options.targetTrianglePixels ?? 6;
  const tileSegments = options.tileSegments ?? 13;
  const hysteresis = options.hysteresis ?? 0.15;

  return (ctx: SubdivisionContext) => {
    // Don't subdivide if node is too small
    if (ctx.nodeSize <= ctx.minNodeSize) {
      return false;
    }

    const screenInfo = options.getScreenSpaceInfo();
    if (!screenInfo) {
      // Fallback to simple distance-based if no screen info available
      const effectiveFactor = ctx.wasSubdividedPreviously
        ? 2 * (1 + hysteresis)
        : 2;
      return ctx.distance < ctx.nodeSize * effectiveFactor;
    }

    // Calculate screen-space size of the tile
    // screenSize = (worldSize / distance) * projectionFactor
    const safeDistance = Math.max(ctx.distance, 0.001); // Prevent division by zero
    const tileScreenSize =
      (ctx.nodeSize / safeDistance) * screenInfo.projectionFactor;

    // Calculate the screen-space size of each triangle
    // triangleSize = tileScreenSize / tileSegments
    const triangleScreenSize = tileScreenSize / tileSegments;

    // Apply hysteresis: if previously subdivided, use a larger target (harder to collapse)
    const effectiveTarget = ctx.wasSubdividedPreviously
      ? targetTrianglePixels * (1 - hysteresis) // Triangles must be smaller to collapse
      : targetTrianglePixels; // Normal threshold to subdivide

    // Subdivide if triangles are larger than the target
    return triangleScreenSize > effectiveTarget;
  };
}

/**
 * Screen-space projection info for LOD calculations.
 * Computed from camera properties each frame.
 */
export interface ScreenSpaceInfo {
  /**
   * Projection factor: screenHeight / (2 * tan(fovY / 2))
   * This converts world-space size to screen-space pixels at distance 1.
   */
  projectionFactor: number;
  /**
   * Screen height in pixels (for reference/debugging)
   */
  screenHeight: number;
}

/**
 * Compute screen-space info from camera parameters.
 * Helper function to create ScreenSpaceInfo from typical Three.js camera values.
 *
 * @param fovY Vertical field of view in radians
 * @param screenHeight Screen height in pixels
 * @returns ScreenSpaceInfo for use with screenSpaceSubdivision
 *
 * @example
 * ```ts
 * // In your render loop:
 * const fovRadians = camera.fov * Math.PI / 180;
 * const screenInfo = computeScreenSpaceInfo(fovRadians, renderer.domElement.height);
 * ```
 */
export function computeScreenSpaceInfo(
  fovY: number,
  screenHeight: number
): ScreenSpaceInfo {
  const projectionFactor = screenHeight / (2 * Math.tan(fovY / 2));
  return { projectionFactor, screenHeight };
}

const tempVector3 = new THREE.Vector3();
const tempBox3 = new THREE.Box3();
const tempMin = new THREE.Vector3();
const tempMax = new THREE.Vector3();

export class Quadtree {
  private nodeCount = 0;
  private deepestLevel = 0;
  private config: QuadtreeParams;
  private nodeView: NodeView;
  private subdivisionStrategy: SubdivisionStrategy;

  // Pre-allocated buffers to avoid object creation
  private tempChildIndices: ChildIndices = [-1, -1, -1, -1];
  private tempNeighborIndices: NeighborIndices = [-1, -1, -1, -1];

  // Hysteresis: track which node positions were subdivided in the previous frame
  // Key format: "level,x,y" -> was subdivided (not a leaf)
  private previouslySubdivided: Set<string> = new Set();
  private currentlySubdivided: Set<string> = new Set();

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
    nodeView?: NodeView
  ) {
    this.config = config;
    this.subdivisionStrategy =
      subdivisionStrategy ?? distanceBasedSubdivision(2);
    this.nodeView = nodeView ?? new NodeView(config.maxNodes);
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
    // Swap subdivision tracking sets for hysteresis
    // previouslySubdivided now contains last frame's state
    const temp = this.previouslySubdivided;
    this.previouslySubdivided = this.currentlySubdivided;
    this.currentlySubdivided = temp;
    this.currentlySubdivided.clear();

    this.reset();

    // Start from root node and capture the closest leaf index
    const closestLeafIndex = this.updateNode(0, position, frustum);

    return closestLeafIndex;
  }

  /**
   * Recursively update a node and its children based on distance and size criteria
   * and return the closest leaf node index to the provided position.
   */
  private updateNode(
    nodeIndex: number,
    position: THREE.Vector3,
    frustum?: THREE.Frustum
  ): number {
    const level = this.nodeView.getLevel(nodeIndex);
    const nodeSize = this.config.rootSize / (1 << level);

    // Calculate node center position (matching the shader calculation)
    const nodeX = this.nodeView.getX(nodeIndex);
    const nodeY = this.nodeView.getY(nodeIndex);
    const minX =
      this.config.origin.x + (nodeX * nodeSize - 0.5 * this.config.rootSize);
    const minZ =
      this.config.origin.z + (nodeY * nodeSize - 0.5 * this.config.rootSize);
    const worldX = minX + 0.5 * nodeSize;
    const worldZ = minZ + 0.5 * nodeSize;

    // Create key for hysteresis tracking
    const nodeKey = `${level},${nodeX},${nodeY}`;

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

    // LOD distance: use full 3D distance.
    // The caller (TerrainMesh) adjusts position.y to be origin.y + heightAboveTerrain,
    // so this effectively measures distance from the terrain surface.
    // Standing on a 500m mountain with camera at 502m passes adjustedY = origin.y + 2,
    // giving the same subdivision as standing on flat ground at height 2.
    tempVector3.set(worldX, this.config.origin.y, worldZ);
    const distance = position.distanceTo(tempVector3);

    // Check if this node position was subdivided in the previous frame (for hysteresis)
    const wasSubdividedPreviously = this.previouslySubdivided.has(nodeKey);

    const shouldSubdivide = this.shouldSubdivide(
      level,
      distance,
      nodeSize,
      wasSubdividedPreviously
    );

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

      // Track that this node is subdivided this frame
      this.currentlySubdivided.add(nodeKey);

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
            const cx =
              this.config.origin.x +
              ((x + 0.5) * size - 0.5 * this.config.rootSize);
            const cz =
              this.config.origin.z +
              ((y + 0.5) * size - 0.5 * this.config.rootSize);
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
  private shouldSubdivide(
    level: number,
    distance: number,
    nodeSize: number,
    wasSubdividedPreviously: boolean
  ): boolean {
    const context: SubdivisionContext = {
      level,
      distance,
      nodeSize,
      minNodeSize: this.config.minNodeSize,
      rootSize: this.config.rootSize,
      wasSubdividedPreviously,
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
    childIndices: ChildIndices
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
