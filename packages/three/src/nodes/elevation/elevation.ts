import { Fn } from "three/src/nodes/TSL.js";
import type Node from "three/src/nodes/core/Node.js";
import type { ProxiedObject } from "three/tsl";
import { ElevationCallback, ElevationParams, ElevationReturn } from "./elevation.types";

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
