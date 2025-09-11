import { type ShaderNodeObject, float, int, select, vec2 } from "three/tsl";

import { Fn } from "three/tsl";
import type { Node, StorageBufferNode } from "three/webgpu";
import type { ElevationReturn } from "./ElevationFn";
import {
  tileLevel,
  tileOriginVec2,
  tileSize,
  tileVertexWorldPosition,
} from "./tile";

export const height = (
  instanceIndex: ShaderNodeObject<Node>,
  nodeStorage: ShaderNodeObject<StorageBufferNode>,
  rootSize: ShaderNodeObject<Node>,
  rootOrigin: ShaderNodeObject<Node>,
  positionLocal: ShaderNodeObject<Node>,
  elevationFn: ElevationReturn = Fn(() => float(0))
) =>
  Fn(() => {
    const nodeIndex = instanceIndex;
    const nodeOffset = nodeIndex.mul(int(4));
    const isLeaf = nodeStorage.element(nodeOffset.add(int(3))).equal(int(1));
    const vertexWorldPosition = tileVertexWorldPosition(
      nodeIndex,
      nodeStorage,
      rootSize,
      rootOrigin,
      positionLocal
    );
    // Derive rootUV from the computed world position to ensure compute compatibility
    const rootUVFromWorld = Fn(
      ([worldPosition, rootSize, rootOrigin]: [
        ShaderNodeObject<Node>,
        ShaderNodeObject<Node>,
        ShaderNodeObject<Node>,
      ]) => {
        const centeredX = worldPosition.x.sub(rootOrigin.x);
        const centeredZ = worldPosition.z.sub(rootOrigin.z);
        return vec2(
          centeredX.div(rootSize).add(0.5),
          centeredZ.div(rootSize).mul(-1.0).add(0.5)
        );
      }
    )(vertexWorldPosition, rootSize, rootOrigin);
    return select(
      isLeaf,
      elevationFn({
        tileVertexWorldPosition: vertexWorldPosition,
        rootSize: rootSize,
        rootUV: rootUVFromWorld,
        tileLevel: tileLevel(nodeIndex, nodeStorage),
        tileSize: tileSize(nodeIndex, nodeStorage, rootSize),
        tileOriginVec2: tileOriginVec2(nodeIndex, nodeStorage),
      }),
      float(0)
    );
  })();
