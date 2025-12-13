import { Fn, type ShaderNodeFn } from "three/src/nodes/TSL.js";
import type Node from "three/src/nodes/core/Node.js";
import type { ProxiedObject, ShaderNodeObject } from "three/tsl";
import type { ConstNode, Vector2, Vector3 } from "three/webgpu";

/**
 * Parameters passed to the control function in the compute shader.
 * Includes all the same position/tile data as ElevationParams, plus
 * the computed height and normal at this vertex.
 */
export interface ControlParams {
  /** World-space position of the vertex */
  worldPosition: ShaderNodeObject<ConstNode<Vector3>>;
  /** Size of the root terrain tile in world units */
  rootSize: ShaderNodeObject<ConstNode<number>>;
  /** UV coordinates in the root tile space [0,1] */
  rootUV: ShaderNodeObject<ConstNode<Vector2>>;
  /** UV coordinates within the current tile [0,1] */
  tileUV: ShaderNodeObject<ConstNode<Vector2>>;
  /** LOD level of this tile (0 = root, higher = more subdivided) */
  tileLevel: ShaderNodeObject<ConstNode<number>>;
  /** Size of this tile in world units */
  tileSize: ShaderNodeObject<ConstNode<number>>;
  /** Origin of this tile in quadtree coordinates */
  tileOriginVec2: ShaderNodeObject<ConstNode<Vector2>>;
  /** Index of this node in the quadtree */
  nodeIndex: ShaderNodeObject<ConstNode<number>>;
  /** Computed height at this vertex (from heightmap) */
  height: ShaderNodeObject<ConstNode<number>>;
  /** Computed normal at this vertex (from normalmap) */
  normal: ShaderNodeObject<ConstNode<Vector3>>;
}

export type ControlReturn = ShaderNodeFn<[ProxiedObject<ControlParams>]>;

/**
 * Callback function that receives terrain parameters and returns packed control data.
 * The returned value should be a uint32 with the following bit layout:
 * - Bits 31-27: Base Texture ID (0-31)
 * - Bits 26-22: Overlay Texture ID (0-31)
 * - Bits 21-14: Blend Factor (0-255)
 * - Bits 13-10: UV Scale (0-15)
 * - Bits 9-6: UV Rotation (0-15)
 * - Bit 5: Auto-shader flag
 * - Bit 4: Navigation flag
 * - Bit 3: Hole flag
 * - Bits 2-0: Reserved
 */
export type ControlCallback = (params: ControlParams) => ShaderNodeObject<Node>;

/**
 * Creates a TSL function for computing control map data in a compute shader.
 * Similar to ElevationFn, but receives additional height and normal data
 * and returns packed uint32 control data.
 *
 * @example
 * ```ts
 * const controlFn = ControlFn(({ height, normal }) => {
 *   // Use height and slope to determine textures
 *   const slope = float(1).sub(normal.y);
 *   const isSnow = height.greaterThan(2000);
 *   const isRock = slope.greaterThan(0.5);
 *
 *   // Pack: baseTextureId in bits 31-27
 *   const textureId = select(isSnow, uint(3),
 *                     select(isRock, uint(2), uint(0)));
 *   return textureId.shiftLeft(uint(27));
 * });
 * ```
 */
export function ControlFn(callback: ControlCallback): ControlReturn {
  const tslFunction = (args: ControlParams) => {
    const params: ControlParams = {
      worldPosition: args.worldPosition,
      rootSize: args.rootSize,
      rootUV: args.rootUV,
      tileUV: args.tileUV,
      tileLevel: args.tileLevel,
      tileSize: args.tileSize,
      tileOriginVec2: args.tileOriginVec2,
      nodeIndex: args.nodeIndex,
      height: args.height,
      normal: args.normal,
    };

    return callback(params);
  };

  return Fn(
    tslFunction as unknown as (args: ProxiedObject<ControlParams>) => Node
  );
}
