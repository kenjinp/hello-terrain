import {
  type ShaderNodeObject,
  float,
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
      return float(rootSize).div(pow(float(2), level.toFloat()));
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
      return nodeStorage.element(nodeOffset).toInt();
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
  positionLocal: ShaderNodeObject<Node>,
  innerTileSegments: ShaderNodeObject<Node>
) =>
  Fn(
    ([
      nodeStorage,
      nodeIndex,
      rootSize,
      rootOrigin,
      positionLocal,
      innerTileSegments,
    ]: [
      ShaderNodeObject<StorageBufferNode>,
      ShaderNodeObject<Node>,
      ShaderNodeObject<Node>,
      ShaderNodeObject<Node>,
      ShaderNodeObject<Node>,
      ShaderNodeObject<Node>,
    ]) => {
      const nodeVec2 = tileOriginVec2(nodeIndex, nodeStorage);
      const nodeX = nodeVec2.x;
      const nodeY = nodeVec2.y;
      const innerTileSize = tileSize(nodeIndex, nodeStorage, rootSize);
      const size = innerTileSize
        .div(innerTileSegments)
        .mul(innerTileSegments.add(2));
      const scaleWithOverlap = size.div(innerTileSize);
      rootSize.mulAssign(scaleWithOverlap);
      const half = float(0.5);
      const worldX = rootOrigin.x.add(
        nodeX.add(half).mul(size).sub(uRootSize.div(2.0))
      );
      const worldZ = rootOrigin.z.add(
        nodeY.add(half).mul(size).sub(uRootSize.div(2.0))
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
  )(
    nodeStorage,
    nodeIndex,
    rootSize,
    rootOrigin,
    positionLocal,
    innerTileSegments
  );

export const tileVertexWorldPositionCompute = (
  nodeIndex: ShaderNodeObject<Node>,
  nodeStorage: ShaderNodeObject<StorageBufferNode>,
  rootSize: ShaderNodeObject<Node>,
  rootOrigin: ShaderNodeObject<Node>,
  localUV: ShaderNodeObject<Node>,
  innerTileSegments: ShaderNodeObject<Node>
) =>
  Fn(
    ([
      nodeStorage,
      nodeIndex,
      rootSize,
      rootOrigin,
      localUV,
      innerTileSegments,
    ]: [
      ShaderNodeObject<StorageBufferNode>,
      ShaderNodeObject<Node>,
      ShaderNodeObject<Node>,
      ShaderNodeObject<Node>,
      ShaderNodeObject<Node>,
      ShaderNodeObject<Node>,
    ]) => {
      const nodeVec2 = tileOriginVec2(nodeIndex, nodeStorage);
      const nodeX = nodeVec2.x;
      const nodeY = nodeVec2.y;
      const innerTileSize = tileSize(nodeIndex, nodeStorage, rootSize);
      const size = innerTileSize
        .div(innerTileSegments)
        .mul(innerTileSegments.add(2));
      const half = float(0.5);
      const scaleWithOverlap = size.div(innerTileSize);
      rootSize.mulAssign(scaleWithOverlap);
      const halfRoot = float(rootSize).mul(half);

      // Compute world-space center of this tile
      const centerX = rootOrigin.x.add(nodeX.add(half).mul(size)).sub(halfRoot);
      const centerZ = rootOrigin.z.add(nodeY.add(half).mul(size)).sub(halfRoot);

      const localX = localUV.x.mul(size);
      const localZ = localUV.y.mul(size);

      const worldX = centerX.add(localX);
      const worldZ = centerZ.add(localZ);
      const worldY = rootOrigin.y;

      return vec3(worldX, worldY, worldZ);
    }
  )(nodeStorage, nodeIndex, rootSize, rootOrigin, localUV, innerTileSegments);

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
