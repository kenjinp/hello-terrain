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
import type { ConstNode, Vector2 } from "three/webgpu";
import { nodeStorageProperty } from "./properties";
import { isSkirtVertex } from "./skirt";
import { uRootOrigin, uRootSize, uSegments, uSkirtLength } from "./uniforms";

export const tileSize = Fn(
  ([nodeIndex]: [ShaderNodeObject<ConstNode<number>>]) => {
    const rootSize = uRootSize.toVar();
    const level = tileLevel(nodeIndex);
    return float(rootSize).div(pow(float(2), level.toFloat()));
  }
).setLayout({
  name: "tileSize",
  type: "float",
  inputs: [{ name: "nodeIndex", type: "int", qualifier: "in" }],
});

export const tileLevel = Fn(
  ([nodeIndex]: [ShaderNodeObject<ConstNode<number>>]) => {
    const nodeOffset = nodeIndex.mul(int(4));
    return nodeStorageProperty.element(nodeOffset).toInt();
  }
).setLayout({
  name: "tileLevel",
  type: "int",
  inputs: [{ name: "nodeIndex", type: "int", qualifier: "in" }],
});

export const tileOriginVec2 = Fn(
  ([nodeIndex]: [ShaderNodeObject<ConstNode<number>>]) => {
    const nodeOffset = nodeIndex.mul(int(4));
    const nodeX = nodeStorageProperty.element(nodeOffset.add(int(1))).toFloat();
    const nodeY = nodeStorageProperty.element(nodeOffset.add(int(2))).toFloat();
    return vec2(nodeX, nodeY);
  }
).setLayout({
  name: "tileOriginVec2",
  type: "vec2",
  inputs: [{ name: "nodeIndex", type: "int", qualifier: "in" }],
});

export const tileIsLeaf = Fn(
  ([nodeIndex]: [ShaderNodeObject<ConstNode<number>>]) => {
    const nodeOffset = nodeIndex.mul(int(4));
    const isLeaf = nodeStorageProperty
      .element(nodeOffset.add(int(3)))
      .equal(int(1));
    return isLeaf;
  }
).setLayout({
  name: "tileIsLeaf",
  type: "bool",
  inputs: [{ name: "nodeIndex", type: "int", qualifier: "in" }],
});

// TODO: this is only for vertex/fragment shader
export const tileVertexWorldPosition = Fn(
  ([nodeIndex, positionLocal]: [
    ShaderNodeObject<ConstNode<number>>,
    ShaderNodeObject<ConstNode<Vector2>>,
  ]) => {
    const rootSize = uRootSize.toVar();
    const rootOrigin = uRootOrigin.toVar();
    const innerTileSegments = uSegments.toVar();
    const nodeVec2 = tileOriginVec2(nodeIndex);
    const nodeX = nodeVec2.x;
    const nodeY = nodeVec2.y;
    const size = tileSize(nodeIndex);
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
).setLayout({
  name: "tileVertexWorldPosition",
  type: "vec3",
  inputs: [
    { name: "nodeIndex", type: "int", qualifier: "in" },
    { name: "positionLocal", type: "vec3", qualifier: "in" },
  ],
});

// Vertex-path world position that keeps skirt vertices directly under the
// adjacent inner ring (no XZ expansion) and pulls them down by skirtLength.
export const tileGeometryPosition = Fn(
  ([nodeIndex, positionLocal]: [
    ShaderNodeObject<ConstNode<number>>,
    ShaderNodeObject<ConstNode<number>>,
  ]) => {
    const nodeVec2 = tileOriginVec2(nodeIndex);
    const nodeX = nodeVec2.x;
    const nodeY = nodeVec2.y;
    const rootSize = uRootSize.toVar();
    const size = tileSize(nodeIndex);
    const half = float(0.5);
    const halfRoot = float(rootSize).mul(half);
    const rootOrigin = uRootOrigin.toVar();
    const skirtLength = uSkirtLength.toVar();
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
    const worldY = select(isSkirtVertex(), loweredY, baseY);

    return vec3(worldX, worldY, worldZ);
  }
).setLayout({
  name: "tileGeometryPosition",
  type: "vec3",
  inputs: [
    { name: "nodeIndex", type: "int", qualifier: "in" },
    { name: "positionLocal", type: "vec3", qualifier: "in" },
  ],
});

export const tileVertexWorldPositionCompute = Fn(
  ([nodeIndex, localUV]: [
    ShaderNodeObject<ConstNode<number>>,
    ShaderNodeObject<ConstNode<number>>,
  ]) => {
    const half = float(0.5);
    const rootSize = uRootSize.toVar();
    const rootOrigin = uRootOrigin.toVar();
    const uv = rootUVCompute(nodeIndex, localUV);

    // Inverse of rootUV mapping
    const worldX = rootOrigin.x.add(uv.x.sub(half).mul(rootSize));
    const worldZ = rootOrigin.z.add(half.sub(uv.y).mul(rootSize));
    return vec3(worldX, rootOrigin.y, worldZ);
  }
).setLayout({
  name: "tileVertexWorldPositionCompute",
  type: "vec3",
  inputs: [
    { name: "nodeIndex", type: "int", qualifier: "in" },
    { name: "localUV", type: "vec2", qualifier: "in" },
  ],
});

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
}).setLayout({
  name: "rootUV",
  type: "vec2",
  inputs: [],
});

// Compute-shader version of rootUV that derives world position from
// node/tile data and localUV including the skirt ring.
// localUV here is in [0, 1) based on workgroupId / tileEdgeVertexCount.
// With an overlapping ring, the logical local coordinate range is
// [-0.5 - step, 0.5 + step], where step = 1.0 / uSegments.
export const rootUVCompute = Fn(
  ([nodeIndex, localUV]: [
    ShaderNodeObject<ConstNode<number>>,
    ShaderNodeObject<ConstNode<number>>,
  ]) => {
    const nodeVec2 = tileOriginVec2(nodeIndex);
    const nodeX = nodeVec2.x;
    const nodeY = nodeVec2.y;
    const rootSize = uRootSize.toVar();
    const rootOrigin = uRootOrigin.toVar();
    const size = tileSize(nodeIndex);

    const half = float(0.5);
    const halfRoot = float(rootSize).mul(half);

    // World-space center of this tile (without local offset)
    const centerX = rootOrigin.x.add(nodeX.add(half).mul(size)).sub(halfRoot);
    const centerZ = rootOrigin.z.add(nodeY.add(half).mul(size)).sub(halfRoot);

    // Reconstruct discrete indices and match TerrainGeometry mapping:
    // uInner = clamp((ix - 1) / S, 0, 1)
    // vInner = clamp((iy - 1) / S, 0, 1)
    const fS = uSegments.toVar().toFloat();
    const fEdge = fS.add(float(3.0));
    const ix = localUV.x.mul(fEdge).floor();
    const iy = localUV.y.mul(fEdge).floor();
    const uInner = max(min(ix.sub(float(1.0)).div(fS), float(1.0)), float(0.0));
    const vInner = max(min(iy.sub(float(1.0)).div(fS), float(1.0)), float(0.0));

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
).setLayout({
  name: "rootUVCompute",
  type: "vec2",
  inputs: [
    { name: "nodeIndex", type: "int", qualifier: "in" },
    { name: "localUV", type: "vec2", qualifier: "in" },
  ],
});
