import { ShouldSubdivideContext, SubdivisionStrategy } from "./Quadtree.types";

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
 * Distance-based subdivision strategy with hysteresis to prevent LOD flickering.
 * Subdivides when: distance < nodeSize * factor
 *
 * @param factor Multiplier for subdivision threshold (default: 2)
 * @returns SubdivisionStrategy function
 */
export function distanceBasedSubdivision(factor = 2): SubdivisionStrategy {
  return (...[_quadtree, distance, _level, nodeSize, minNodeSize]: ShouldSubdivideContext) => {
    if (nodeSize <= minNodeSize) {
      return false;
    }
    return distance < nodeSize * factor;
  };
}

/**
 * Screen-space subdivision strategy.
 * Subdivides based on projected triangle size in pixels.
 * Ensures triangles don't exceed a target pixel size on screen.
 *
 * @param options Configuration for screen-space subdivision
 * @returns SubdivisionStrategy function
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
   * Function that returns current screen-space projection info.
   * Called each time subdivision is evaluated.
   */
  getScreenSpaceInfo: () => ScreenSpaceInfo | null;
}): SubdivisionStrategy {
  const targetTrianglePixels = options.targetTrianglePixels ?? 6;
  const tileSegments = options.tileSegments ?? 13;

  return (...[_quadtree, distance, _level, nodeSize, minNodeSize]: ShouldSubdivideContext) => {
    // Don't subdivide if node is too small
    if (nodeSize <= minNodeSize) {
      return false;
    }

    const screenInfo = options.getScreenSpaceInfo();
    if (!screenInfo) {
      return distance < nodeSize * 2;
    }

    // Calculate screen-space size of the tile
    // screenSize = (worldSize / distance) * projectionFactor
    const safeDistance = Math.max(distance, 0.001); // Prevent division by zero
    const tileScreenSize = (nodeSize / safeDistance) * screenInfo.projectionFactor;

    // Calculate the screen-space size of each triangle
    // triangleSize = tileScreenSize / tileSegments
    const triangleScreenSize = tileScreenSize / tileSegments;

    // Subdivide if triangles are larger than the target
    return triangleScreenSize > targetTrianglePixels;
  };
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
export function computeScreenSpaceInfo(fovY: number, screenHeight: number): ScreenSpaceInfo {
  const projectionFactor = screenHeight / (2 * Math.tan(fovY / 2));
  return { projectionFactor, screenHeight };
}
