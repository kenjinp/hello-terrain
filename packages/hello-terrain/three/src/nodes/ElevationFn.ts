import { Fn, type ShaderNodeFn } from "three/src/nodes/TSL.js";
import type Node from "three/src/nodes/core/Node.js";
import type { ProxiedObject, ShaderNodeObject } from "three/tsl";
import type { ConstNode, Vector2, Vector3 } from "three/webgpu";

export interface ElevationParams {
  worldPosition: ShaderNodeObject<ConstNode<Vector3>>;
  rootSize: ShaderNodeObject<ConstNode<number>>;
  rootUV: ShaderNodeObject<ConstNode<Vector2>>;
  tileUV: ShaderNodeObject<ConstNode<Vector2>>;
  tileLevel: ShaderNodeObject<ConstNode<number>>;
  tileSize: ShaderNodeObject<ConstNode<number>>;
  tileOriginVec2: ShaderNodeObject<ConstNode<Vector2>>;
  nodeIndex: ShaderNodeObject<ConstNode<number>>;
}

export type ElevationReturn = ShaderNodeFn<[ProxiedObject<ElevationParams>]>;

export type ElevationCallback = (
  params: ElevationParams
) => ShaderNodeObject<Node>;

export function ElevationFn(callback: ElevationCallback): ElevationReturn {
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

  return Fn(
    tslFunction as unknown as (args: ProxiedObject<ElevationParams>) => Node
  );
}
