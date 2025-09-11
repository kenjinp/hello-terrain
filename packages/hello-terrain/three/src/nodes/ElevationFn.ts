import { Fn, type ShaderNodeFn } from "three/src/nodes/TSL.js";
import type Node from "three/src/nodes/core/Node.js";
import type { ProxiedObject, ShaderNodeObject } from "three/tsl";
import type { ConstNode, Vector2, Vector3 } from "three/webgpu";

export interface ElevationParams {
  tileVertexWorldPosition: ShaderNodeObject<ConstNode<Vector3>>;
  rootSize: ShaderNodeObject<ConstNode<number>>;
  rootUV: ShaderNodeObject<ConstNode<Vector2>>;
  tileLevel: ShaderNodeObject<ConstNode<number>>;
  tileSize: ShaderNodeObject<ConstNode<number>>;
  tileOriginVec2: ShaderNodeObject<ConstNode<Vector2>>;
}

export type ElevationReturn = ShaderNodeFn<[ProxiedObject<ElevationParams>]>;

export type ElevationCallback = (
  params: ElevationParams
) => ShaderNodeObject<Node>;

export function ElevationFn(callback: ElevationCallback): ElevationReturn {
  const tslFunction = (args: ElevationParams) => {
    const params: ElevationParams = {
      tileVertexWorldPosition: args.tileVertexWorldPosition,
      rootSize: args.rootSize,
      rootUV: args.rootUV,
      tileLevel: args.tileLevel,
      tileSize: args.tileSize,
      tileOriginVec2: args.tileOriginVec2,
    };

    return callback(params);
  };

  return Fn(
    tslFunction as unknown as (args: ProxiedObject<ElevationParams>) => Node
  );

  // return Fn((args: [ProxiedObject<ElevationParams>]) => {
  //   return tslFunction(args[0] as ElevationParams);
  // });
}
