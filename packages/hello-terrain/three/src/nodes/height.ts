import { type ShaderNodeObject, select, vec3 } from "three/tsl";

import { Fn } from "three/tsl";
import type { StorageBufferNode } from "three/webgpu";
import type { ElevationReturn } from "./ElevationFn";
import {
  rootUV,
  tileIsLeaf,
  tileLevel,
  tileOriginVec2,
  tileSize,
  tileVertexWorldPosition,
} from "./tile";
import { uRootSize } from "./uniforms";

export const height = (
  nodeStorage: ShaderNodeObject<StorageBufferNode>,
  elevationFn: ElevationReturn
) =>
  Fn(() => {
    const isLeaf = tileIsLeaf(nodeStorage);
    return select(
      isLeaf,
      elevationFn({
        tileVertexWorldPosition: tileVertexWorldPosition(nodeStorage),
        rootSize: uRootSize.toVar(),
        rootUV: rootUV,
        tileLevel: tileLevel(nodeStorage),
        tileSize: tileSize(nodeStorage),
        tileOriginVec2: tileOriginVec2(nodeStorage),
      }),
      vec3(0, 0, 0)
    );
  })();
