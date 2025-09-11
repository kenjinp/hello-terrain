import {
  type ShaderNodeObject,
  int,
  positionWorld,
  pow,
  vec2,
  vec3,
} from "three/tsl";

import { Fn } from "three/tsl";
import type { Node, StorageBufferNode } from "three/webgpu";
import { uRootOrigin, uRootSize } from "./uniforms";

export const tileSize = (
  nodeIndex: ShaderNodeObject<Node>,
  nodeStorage: ShaderNodeObject<StorageBufferNode>,
  rootSize: ShaderNodeObject<Node>
) =>
  Fn(
    ([nodeStorage, nodeIndex, rootSize]: [
      ShaderNodeObject<StorageBufferNode>,
      ShaderNodeObject<Node>,
      ShaderNodeObject<Node>,
    ]) => {
      const level = tileLevel(nodeIndex, nodeStorage);
      return rootSize.div(pow(2.0, level.toFloat()));
    }
  )(nodeStorage, nodeIndex, rootSize);

export const tileLevel = (
  nodeIndex: ShaderNodeObject<Node>,
  nodeStorage: ShaderNodeObject<StorageBufferNode>
) =>
  Fn(
    ([nodeStorage, nodeIndex]: [
      ShaderNodeObject<StorageBufferNode>,
      ShaderNodeObject<Node>,
    ]) => {
      const nodeOffset = nodeIndex.mul(int(4));
      const level = nodeStorage.element(nodeOffset);
      return level;
    }
  )(nodeStorage, nodeIndex);

export const tileOriginVec2 = (
  nodeIndex: ShaderNodeObject<Node>,
  nodeStorage: ShaderNodeObject<StorageBufferNode>
) =>
  Fn(
    ([nodeStorage, nodeIndex]: [
      ShaderNodeObject<StorageBufferNode>,
      ShaderNodeObject<Node>,
    ]) => {
      const nodeOffset = nodeIndex.mul(int(4));
      // Convert to float before constructing vec2 to avoid WGSL i32 -> f32 mismatch
      const nodeX = nodeStorage.element(nodeOffset.add(int(1))).toFloat();
      const nodeY = nodeStorage.element(nodeOffset.add(int(2))).toFloat();
      return vec2(nodeX, nodeY);
    }
  )(nodeStorage, nodeIndex);

export const tileIsLeaf = (
  nodeIndex: ShaderNodeObject<Node>,
  nodeStorage: ShaderNodeObject<StorageBufferNode>
) =>
  Fn(
    ([nodeStorage, nodeIndex]: [
      ShaderNodeObject<StorageBufferNode>,
      ShaderNodeObject<Node>,
    ]) => {
      const nodeOffset = nodeIndex.mul(int(4));
      const isLeaf = nodeStorage.element(nodeOffset.add(int(3))).equal(int(1));
      return isLeaf;
    }
  )(nodeStorage, nodeIndex);

// TODO: this is only for vertex/fragment shader
export const tileVertexWorldPosition = (
  nodeIndex: ShaderNodeObject<Node>,
  nodeStorage: ShaderNodeObject<StorageBufferNode>,
  rootSize: ShaderNodeObject<Node>,
  rootOrigin: ShaderNodeObject<Node>,
  positionLocal: ShaderNodeObject<Node>
) =>
  Fn(
    ([nodeStorage, nodeIndex, rootSize, rootOrigin, positionLocal]: [
      ShaderNodeObject<StorageBufferNode>,
      ShaderNodeObject<Node>,
      ShaderNodeObject<Node>,
      ShaderNodeObject<Node>,
      ShaderNodeObject<Node>,
    ]) => {
      const nodeVec2 = tileOriginVec2(nodeIndex, nodeStorage);
      const nodeX = nodeVec2.x;
      const nodeY = nodeVec2.y;
      const size = tileSize(nodeIndex, nodeStorage, rootSize);
      const worldX = rootOrigin.x.add(
        nodeX.add(0.5).mul(size).sub(uRootSize.div(2.0))
      );
      const worldZ = rootOrigin.z.add(
        nodeY.add(0.5).mul(size).sub(uRootSize.div(2.0))
      );
      const localOffsetX = positionLocal.x.mul(size);
      const localOffsetZ = positionLocal.z.mul(size);
      const worldPosition = vec3(
        worldX.add(localOffsetX),
        rootOrigin.y,
        worldZ.add(localOffsetZ)
      );
      return worldPosition;
    }
  )(nodeStorage, nodeIndex, rootSize, rootOrigin, positionLocal);

// TODO: this is only for vertex/fragment shader
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
