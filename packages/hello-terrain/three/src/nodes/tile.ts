import {
  type ShaderNodeObject,
  int,
  positionLocal,
  positionWorld,
  pow,
  vec2,
  vec3,
} from "three/tsl";

import { Fn, instanceIndex } from "three/tsl";
import type { StorageBufferNode } from "three/webgpu";
import { uRootOrigin, uRootSize } from "./uniforms";

export const tileLevel = (nodeStorage: ShaderNodeObject<StorageBufferNode>) =>
  Fn(([nodeStorage]: [ShaderNodeObject<StorageBufferNode>]) => {
    const nodeIndex = instanceIndex;
    const nodeOffset = nodeIndex.mul(int(4));
    const level = nodeStorage.element(nodeOffset);
    return level;
  })(nodeStorage);

export const tileOriginVec2 = (
  nodeStorage: ShaderNodeObject<StorageBufferNode>
) =>
  Fn(([nodeStorage]: [ShaderNodeObject<StorageBufferNode>]) => {
    const nodeIndex = instanceIndex;
    const nodeOffset = nodeIndex.mul(int(4));
    // Convert to float before constructing vec2 to avoid WGSL i32 -> f32 mismatch
    const nodeX = nodeStorage.element(nodeOffset.add(int(1))).toFloat();
    const nodeY = nodeStorage.element(nodeOffset.add(int(2))).toFloat();
    return vec2(nodeX, nodeY);
  })(nodeStorage);

export const tileIsLeaf = (nodeStorage: ShaderNodeObject<StorageBufferNode>) =>
  Fn(([nodeStorage]: [ShaderNodeObject<StorageBufferNode>]) => {
    const nodeIndex = instanceIndex;
    const nodeOffset = nodeIndex.mul(int(4));
    const isLeaf = nodeStorage.element(nodeOffset.add(int(3))).equal(int(1));
    return isLeaf;
  })(nodeStorage);

export const tileVertexWorldPosition = (
  nodeStorage: ShaderNodeObject<StorageBufferNode>
) =>
  Fn(([nodeStorage]: [ShaderNodeObject<StorageBufferNode>]) => {
    const level = tileLevel(nodeStorage);
    const nodeVec2 = tileOriginVec2(nodeStorage);
    const nodeX = nodeVec2.x;
    const nodeY = nodeVec2.y;
    const tileSize = uRootSize.div(pow(2.0, level.toFloat()));
    const worldX = uRootOrigin.x.add(
      nodeX.add(0.5).mul(tileSize).sub(uRootSize.div(2.0))
    );
    const worldZ = uRootOrigin.z.add(
      nodeY.add(0.5).mul(tileSize).sub(uRootSize.div(2.0))
    );
    const localOffsetX = positionLocal.x.mul(tileSize);
    const localOffsetZ = positionLocal.z.mul(tileSize);
    const worldPosition = vec3(
      worldX.add(localOffsetX),
      uRootOrigin.y,
      worldZ.add(localOffsetZ)
    );
    return worldPosition;
  })(nodeStorage);
// World-space UV that does not depend on node storage or instance index.
// Use this in fragment shading to avoid per-fragment instance index issues.
export const rootUV = Fn(() => {
  const worldX = positionWorld.x;
  const worldZ = positionWorld.z;
  const centeredX = worldX.sub(uRootOrigin.x);
  const centeredZ = worldZ.sub(uRootOrigin.z);
  return vec2(
    centeredX.div(uRootSize).add(0.5),
    centeredZ.div(uRootSize).mul(-1.0).add(0.5)
  );
})();
