import {
  type ShaderNodeObject,
  float,
  int,
  max,
  min,
  positionWorld,
  pow,
  select,
  uv,
  vec2,
  vec3,
} from "three/tsl";

import { Fn } from "three/tsl";
import type { Node, StorageBufferNode } from "three/webgpu";
import { isSkirtVertex } from "./skirt";
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
      _innerTileSegments,
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
      const size = tileSize(nodeIndex, nodeStorage, rootSize);
      const half = float(0.5);
      const worldX = rootOrigin.x.add(
        nodeX.add(half).mul(size).sub(rootSize.div(2.0))
      );
      const worldZ = rootOrigin.z.add(
        nodeY.add(half).mul(size).sub(rootSize.div(2.0))
      );

      // Expand skirt vertices outward by one texel step to match compute mapping
      const step = float(1.0).div(float(innerTileSegments));
      const ux = uv().x;
      const uy = uv().y;
      const dx = ux
        .equal(float(0))
        .select(step.mul(float(-1)), ux.equal(float(1)).select(step, float(0)));
      const dz = uy
        .equal(float(1))
        .select(step.mul(float(-1)), uy.equal(float(0)).select(step, float(0)));

      const localXExpanded = positionLocal.x.add(dx);
      const localZExpanded = positionLocal.z.add(dz);

      const localOffsetX = localXExpanded.mul(size);
      const localOffsetZ = localZExpanded.mul(size);
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

// Vertex-path world position that keeps skirt vertices directly under the
// adjacent inner ring (no XZ expansion) and pulls them down by skirtLength.
export const tileGeometryPosition = (
  nodeIndex: ShaderNodeObject<Node>,
  nodeStorage: ShaderNodeObject<StorageBufferNode>,
  rootSize: ShaderNodeObject<Node>,
  rootOrigin: ShaderNodeObject<Node>,
  positionLocal: ShaderNodeObject<Node>,
  skirtLength: ShaderNodeObject<Node>
) =>
  Fn(
    ([
      nodeStorage,
      nodeIndex,
      rootSize,
      rootOrigin,
      positionLocal,
      skirtLength,
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
      const size = tileSize(nodeIndex, nodeStorage, rootSize);
      const half = float(0.5);
      const halfRoot = float(rootSize).mul(half);

      // Tile center
      const centerX = rootOrigin.x.add(nodeX.add(half).mul(size)).sub(halfRoot);
      const centerZ = rootOrigin.z.add(nodeY.add(half).mul(size)).sub(halfRoot);

      // Clamp local XZ to inner ring to place skirt directly below border
      const clampedLocalX = positionLocal.x.max(half.negate()).min(half);
      const clampedLocalZ = positionLocal.z.max(half.negate()).min(half);

      const worldX = centerX.add(clampedLocalX.mul(size));
      const worldZ = centerZ.add(clampedLocalZ.mul(size));

      const loweredY = rootOrigin.y.sub(float(skirtLength));
      const baseY = rootOrigin.y;
      const worldY = select(isSkirtVertex, loweredY, baseY);

      return vec3(worldX, worldY, worldZ);
    }
  )(nodeStorage, nodeIndex, rootSize, rootOrigin, positionLocal, skirtLength);

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
      const half = float(0.5);
      const uv = rootUVCompute(
        nodeIndex,
        nodeStorage,
        rootSize,
        rootOrigin,
        localUV,
        innerTileSegments
      );

      // Inverse of rootUV mapping
      const worldX = rootOrigin.x.add(uv.x.sub(half).mul(rootSize));
      const worldZ = rootOrigin.z.add(half.sub(uv.y).mul(rootSize));
      return vec3(worldX, rootOrigin.y, worldZ);
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

// Compute-shader version of rootUV that derives world position from
// node/tile data and localUV including the skirt ring.
// localUV here is in [0, 1) based on workgroupId / tileEdgeVertexCount.
// With an overlapping ring, the logical local coordinate range is
// [-0.5 - step, 0.5 + step], where step = 1.0 / innerTileSegments.
export const rootUVCompute = (
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
      const size = tileSize(nodeIndex, nodeStorage, rootSize);

      const half = float(0.5);
      const halfRoot = float(rootSize).mul(half);

      // World-space center of this tile (without local offset)
      const centerX = rootOrigin.x.add(nodeX.add(half).mul(size)).sub(halfRoot);
      const centerZ = rootOrigin.z.add(nodeY.add(half).mul(size)).sub(halfRoot);

      // Reconstruct discrete indices and match TerrainGeometry mapping:
      // uInner = clamp((ix - 1) / S, 0, 1)
      // vInner = clamp((iy - 1) / S, 0, 1)
      const fS = float(innerTileSegments);
      const fEdge = fS.add(float(3.0));
      const ix = localUV.x.mul(fEdge).floor();
      const iy = localUV.y.mul(fEdge).floor();
      const uInner = max(
        min(ix.sub(float(1.0)).div(fS), float(1.0)),
        float(0.0)
      );
      const vInner = max(
        min(iy.sub(float(1.0)).div(fS), float(1.0)),
        float(0.0)
      );

      const localX = uInner.sub(half);
      const localZ = vInner.sub(half);

      // World position of this vertex (skirt shares border XZ)
      const worldX = centerX.add(localX.mul(size));
      const worldZ = centerZ.add(localZ.mul(size));

      // Map to root UV (continuous and tile-aligned)
      const centeredX = worldX.sub(rootOrigin.x);
      const centeredZ = worldZ.sub(rootOrigin.z);
      return vec2(
        centeredX.div(rootSize).add(half),
        centeredZ.div(rootSize).mul(float(-1.0)).add(half)
      );
    }
  )(nodeStorage, nodeIndex, rootSize, rootOrigin, localUV, innerTileSegments);
