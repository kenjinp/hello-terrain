import { float, int, uniform, vec3 } from "three/tsl";

/**
 * Uniform controlling the skirt length in world units.
 *
 * The skirt is an outer ring of vertices around each tile that is displaced
 * downward to hide cracks between tiles at different LOD levels.
 *
 * @defaultValue 1
 * @see isSkirtVertex
 */
export const uSkirtLength = /*@__PURE__*/ uniform(float(1)).setName(
  "uSkirtLength"
);

/**
 * Number of inner segments per tile (excluding the outer skirt ring).
 *
 * Shaders commonly derive the effective edge-vertex count as `uSegments + 3`
 * to account for the two skirt rings and indexing needs at the border.
 *
 * @defaultValue 13 (i.e. 13 segments per tile, forming 16 vertices per tile edge)
 */
export const uSegments = /*@__PURE__*/ uniform(int(0)).setName("uSegments");

/**
 * Size of the root terrain square in world units.
 *
 * Used to compute tile extents and to map world positions to root UV space.
 *
 * @defaultValue 1
 */
export const uRootSize = /*@__PURE__*/ uniform(float(1)).setName("uRootSize");

/**
 * World-space center of the root terrain square.
 *
 * The `x` and `z` components define the horizontal center used for tiling and
 * UV mapping. The `y` component represents the base elevation plane before any
 * height displacement is applied.
 *
 * @defaultValue vec3(0, 0, 0)
 */
export const uRootOrigin = /*@__PURE__*/ uniform(vec3(0)).setName(
  "uRootOrigin"
);

/**
 * Scale factor applied to sampled height values to convert them to world units.
 *
 * @defaultValue 1
 */
export const uHeightmapScale = /*@__PURE__*/ uniform(float(1)).setName(
  "uHeightmapScale"
);
