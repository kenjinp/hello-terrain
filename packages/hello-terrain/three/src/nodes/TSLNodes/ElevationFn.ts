import { Fn, type ShaderNodeFn } from "three/src/nodes/TSL.js";
import type Node from "three/src/nodes/core/Node.js";
import type { ProxiedObject } from "three/tsl";

// Define the parameter interface for elevation functions
export interface ElevationParams {
  worldPosition: Node;
  rootSize: Node;
  heightmapScale: Node;
  worldUv: Node;
  level: Node;
  tileSize: Node;
  nodeX: Node;
  nodeY: Node;
}

// Insane
export type ElevationReturn = ShaderNodeFn<
  [ProxiedObject<{ [key: string]: unknown }>]
>;

export type ElevationCallback = (params: ElevationParams) => Node;

export function ElevationFn(callback: ElevationCallback): ElevationReturn {
  const tslFunction = (args: { [key: string]: unknown }) => {
    const params: ElevationParams = {
      worldPosition: args.worldPosition as Node,
      rootSize: args.rootSize as Node,
      heightmapScale: args.heightmapScale as Node,
      worldUv: args.worldUv as Node,
      level: args.level as Node,
      tileSize: args.tileSize as Node,
      nodeX: args.nodeX as Node,
      nodeY: args.nodeY as Node,
    };

    return callback(params);
  };

  return Fn(tslFunction);
}
