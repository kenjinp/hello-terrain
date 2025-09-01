import { Fn, type ShaderNodeFn } from "three/src/nodes/TSL.js";
import type Node from "three/src/nodes/core/Node.js";
import type { ProxiedObject, ShaderNodeObject } from "three/tsl";
import type { ConstNode, Vector2, Vector3 } from "three/webgpu";

// Define the parameter interface for elevation functions
export interface ElevationParams {
  worldPosition: ShaderNodeObject<ConstNode<Vector3>>;
  rootSize: ShaderNodeObject<ConstNode<number>>;
  heightmapScale: ShaderNodeObject<ConstNode<number>>;
  worldUv: ShaderNodeObject<ConstNode<Vector2>>;
  level: ShaderNodeObject<ConstNode<number>>;
  tileSize: ShaderNodeObject<ConstNode<number>>;
  nodeX: ShaderNodeObject<ConstNode<number>>;
  nodeY: ShaderNodeObject<ConstNode<number>>;
}

// Insane
export type ElevationReturn = ShaderNodeFn<
  [ProxiedObject<{ [key: string]: unknown }>]
>;

export type ElevationCallback = (
  params: ElevationParams
) => ShaderNodeObject<Node>;

export function ElevationFn(callback: ElevationCallback): ElevationReturn {
  const tslFunction = (args: { [key: string]: unknown }) => {
    const params: ElevationParams = {
      worldPosition: args.worldPosition as ShaderNodeObject<ConstNode<Vector3>>,
      rootSize: args.rootSize as ShaderNodeObject<ConstNode<number>>,
      heightmapScale: args.heightmapScale as ShaderNodeObject<
        ConstNode<number>
      >,
      worldUv: args.worldUv as ShaderNodeObject<ConstNode<Vector2>>,
      level: args.level as ShaderNodeObject<ConstNode<number>>,
      tileSize: args.tileSize as ShaderNodeObject<ConstNode<number>>,
      nodeX: args.nodeX as ShaderNodeObject<ConstNode<number>>,
      nodeY: args.nodeY as ShaderNodeObject<ConstNode<number>>,
    };

    return callback(params);
  };

  return Fn(tslFunction);
}
