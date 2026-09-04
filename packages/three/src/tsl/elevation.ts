import { type ShaderNodeFn } from "three/src/nodes/TSL.js";
import { Fn } from "three/src/nodes/TSL.js";
import type Node from "three/src/nodes/core/Node.js";
import type { ProxiedObject } from "three/tsl";

/**
 * Per-sample inputs to an elevation callback. All values are TSL nodes.
 *
 * The elevation function is evaluated once per texel of a tile's field grid.
 * That grid is `(innerTileSegments + 3)` texels wide: the inner
 * `innerTileSegments + 1` vertices plus a 1-texel **skirt** ring on every side
 * (`FIELD_EDGE_EXTRA_TEXELS`). Skirt texels lie *outside* the tile's footprint
 * and are used for seam stitching and normal derivation, so several parameters
 * below extend slightly past their nominal `[0, 1]` range on skirt samples.
 */
export interface ElevationParams {
  /**
   * `vec3` — world-space position of the sample on the undisplaced surface
   * (elevation not yet applied). Flat: on the `y = origin.y` plane; curved
   * projections: on the base sphere/torus. Continuous across tiles and skirts,
   * making it the safest domain for noise and heightmap lookups.
   */
  worldPosition: Node;
  /** `float` — size of a root tile in world units (`rootSize` param). */
  rootSize: Node;
  /**
   * `vec2` — position within the **root tile / face** in `[0, 1]`, continuous
   * across all tiles of the same root: `(tile.xy + (ix - 1) / innerTileSegments) / 2^level`.
   * Inner vertices span exactly `[0, 1]`; skirt texels fall one texel outside
   * (slightly `< 0` or `> 1`) at the root edge. Flat: `x` follows world `+X`,
   * `y` follows world `-Z`. Cube-sphere/torus: face-local `(u, v)`.
   */
  rootUV: Node;
  /**
   * `vec2` — sample position within the **whole tile grid**, skirt included:
   * `(ix, iy) / (innerTileSegments + 3)`. Starts at `0` on the first skirt
   * texel and never reaches `1.0` (max `(width - 1) / width`); the inner grid
   * occupies roughly `[1 / width, (width - 2) / width]`. This differs from the
   * inner-grid `[0, 1]` mapping used by `tileFaceUV` / `tileLocalToFieldUV`.
   * Kept for backward compatibility; prefer `rootUV` or `worldPosition` for
   * seam-continuous patterns.
   */
  tileUV: Node;
  /** `int` — quadtree depth of the tile (`0` = root). */
  tileLevel: Node;
  /**
   * `float` — edge length of the tile in world units: `rootSize / 2^level`
   * (flat), or the arc length `radius * PI/2 / 2^level` (cube-sphere/torus).
   */
  tileSize: Node;
  /**
   * `vec2` — integer tile coordinates `(x, y)` within the root at this level,
   * in `[0, 2^level)` per axis (infinite flat may be negative). *Not* a
   * world-space position; multiply by `tileSize` for that on flat terrain.
   */
  tileOriginVec2: Node;
  /** `int` — leaf slot index in `[0, leafCount)`; stable only within a frame. */
  nodeIndex: Node;
}

export type ElevationReturn = ShaderNodeFn<[ProxiedObject<ElevationParams>]>;

export type ElevationCallback = (params: ElevationParams) => Node;

export function createElevationFunction(callback: ElevationCallback): ElevationReturn {
  const tslFunction = (args: ElevationParams) => {
    const params: ElevationParams = {
      worldPosition: args.worldPosition,
      rootSize: args.rootSize,
      rootUV: args.rootUV,
      tileUV: args.tileUV,
      tileLevel: args.tileLevel,
      tileSize: args.tileSize,
      tileOriginVec2: args.tileOriginVec2,
      nodeIndex: args.nodeIndex,
    };

    return callback(params);
  };

  return Fn(tslFunction as unknown as (args: ProxiedObject<ElevationParams>) => Node);
}
