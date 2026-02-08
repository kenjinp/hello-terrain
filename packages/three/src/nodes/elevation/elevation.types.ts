import { type ShaderNodeFn } from "three/src/nodes/TSL.js";
import type Node from "three/src/nodes/core/Node.js";
import type { ProxiedObject } from "three/tsl";

export interface ElevationParams {
  worldPosition: Node;
  rootSize: Node;
  rootUV: Node;
  tileUV: Node;
  tileLevel: Node;
  tileSize: Node;
  tileOriginVec2: Node;
  nodeIndex: Node;
}

export type ElevationReturn = ShaderNodeFn<[ProxiedObject<ElevationParams>]>;

export type ElevationCallback = (params: ElevationParams) => Node;
