import { Fn, float, int, positionWorld, pow, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { LeafStorageState, TerrainUniformsContext } from "../types";

export function createTileCompute(leafStorage: LeafStorageState, uniforms: TerrainUniformsContext) {
  const tileLevel = Fn(([nodeIndex]: [Node]) => {
    const nodeOffset = nodeIndex.mul(int(4));
    return leafStorage.node.element(nodeOffset).toInt();
  });

  const tileOriginVec2 = Fn(([nodeIndex]: [Node]) => {
    const nodeOffset = nodeIndex.mul(int(4));
    const nodeX = leafStorage.node.element(nodeOffset.add(int(1))).toFloat();
    const nodeY = leafStorage.node.element(nodeOffset.add(int(2))).toFloat();
    return vec2(nodeX, nodeY);
  });

  const tileSize = Fn(([nodeIndex]: [Node]) => {
    const rootSize = uniforms.uRootSize.toVar();
    const level = tileLevel(nodeIndex);
    return float(rootSize).div(pow(float(2), level.toFloat()));
  });

  const rootUVCompute = Fn(([nodeIndex, localUV]: [Node, Node]) => {
    const nodeVec2 = tileOriginVec2(nodeIndex);
    const nodeX = nodeVec2.x;
    const nodeY = nodeVec2.y;
    const rootSize = uniforms.uRootSize.toVar();
    const rootOrigin = uniforms.uRootOrigin.toVar();
    const size = tileSize(nodeIndex);

    const half = float(0.5);
    const halfRoot = float(rootSize).mul(half);
    const centerX = rootOrigin.x.add(nodeX.add(half).mul(size)).sub(halfRoot);
    const centerZ = rootOrigin.z.add(nodeY.add(half).mul(size)).sub(halfRoot);

    const fS = uniforms.uInnerTileSegments.toVar().toFloat();
    const fEdge = fS.add(float(3.0));
    const ix = localUV.x.mul(fEdge).floor();
    const iy = localUV.y.mul(fEdge).floor();
    const uExpanded = ix.sub(float(1.0)).div(fS);
    const vExpanded = iy.sub(float(1.0)).div(fS);

    const localX = uExpanded.sub(half);
    const localZ = vExpanded.sub(half);
    const worldX = centerX.add(localX.mul(size));
    const worldZ = centerZ.add(localZ.mul(size));

    const centeredX = worldX.sub(rootOrigin.x);
    const centeredZ = worldZ.sub(rootOrigin.z);
    return vec2(
      centeredX.div(rootSize).add(half),
      centeredZ.div(rootSize).mul(float(-1.0)).add(half),
    );
  });

  const tileVertexWorldPositionCompute = Fn(([nodeIndex, localUV]: [Node, Node]) => {
    const half = float(0.5);
    const rootSize = uniforms.uRootSize.toVar();
    const rootOrigin = uniforms.uRootOrigin.toVar();
    const uvVal = rootUVCompute(nodeIndex, localUV);
    const worldX = rootOrigin.x.add(uvVal.x.sub(half).mul(rootSize));
    const worldZ = rootOrigin.z.add(half.sub(uvVal.y).mul(rootSize));
    return vec3(worldX, rootOrigin.y, worldZ);
  });

  return {
    tileLevel,
    tileOriginVec2,
    tileSize,
    rootUVCompute,
    tileVertexWorldPositionCompute,
  };
}

export function createTileRender(uniforms: TerrainUniformsContext) {
  const rootUV = Fn(() => {
    const worldX = positionWorld.x;
    const worldZ = positionWorld.z;
    const centeredX = worldX.sub(uniforms.uRootOrigin.x);
    const centeredZ = worldZ.sub(uniforms.uRootOrigin.z);
    return vec2(
      centeredX.div(uniforms.uRootSize).add(0.5),
      centeredZ.div(uniforms.uRootSize).mul(-1.0).add(0.5),
    );
  }).setLayout({
    name: "rootUV",
    type: "vec2",
    inputs: [],
  });

  return { rootUV };
}
