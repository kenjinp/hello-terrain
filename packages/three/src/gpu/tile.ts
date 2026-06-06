import { Fn, float, int, positionWorld, pow, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { SurfaceProjection } from "../quadtree";
import { cubeFaceBasis, cubeFaceDirection } from "../nodes/cubeSphere";
import type { LeafStorageState, TerrainUniformsContext } from "../types";

const HALF_PI = Math.PI * 0.5;

export function createTileCompute(
  leafStorage: LeafStorageState,
  uniforms: TerrainUniformsContext,
  projection: SurfaceProjection = "flat",
) {
  const isSphere = projection === "cubeSphere";

  const tileLevel = Fn(([nodeIndex]: [Node]) => {
    const nodeOffset = nodeIndex.mul(int(4));
    return leafStorage.node.element(nodeOffset).toInt();
  });

  const tileFace = Fn(([nodeIndex]: [Node]) => {
    const nodeOffset = nodeIndex.mul(int(4));
    return leafStorage.node.element(nodeOffset.add(int(3))).toInt();
  });

  const tileOriginVec2 = Fn(([nodeIndex]: [Node]) => {
    const nodeOffset = nodeIndex.mul(int(4));
    const nodeX = leafStorage.node.element(nodeOffset.add(int(1))).toFloat();
    const nodeY = leafStorage.node.element(nodeOffset.add(int(2))).toFloat();
    return vec2(nodeX, nodeY);
  });

  const tileSize = Fn(([nodeIndex]: [Node]) => {
    const level = tileLevel(nodeIndex);
    const divisor = pow(float(2), level.toFloat());
    if (isSphere) {
      // Approximate arc-length of a tile edge on the sphere. A cube face spans
      // ~PI/2 of arc; used to scale elevation gradients into world units.
      return uniforms.uRadius.toVar().mul(float(HALF_PI)).div(divisor);
    }
    const rootSize = uniforms.uRootSize.toVar();
    return float(rootSize).div(divisor);
  });

  /** Face-local (u, v) in [0, 1] for a grid sample, including skirt border. */
  const tileFaceUV = Fn(([nodeIndex, ix, iy]: [Node, Node, Node]) => {
    const nodeVec2 = tileOriginVec2(nodeIndex);
    const level = tileLevel(nodeIndex);
    const n = pow(float(2), level.toFloat());
    const fInnerSegments = uniforms.uInnerTileSegments.toVar().toFloat();
    const localU = int(ix).toFloat().sub(float(1.0)).div(fInnerSegments);
    const localV = int(iy).toFloat().sub(float(1.0)).div(fInnerSegments);
    return vec2(
      nodeVec2.x.add(localU).div(n),
      nodeVec2.y.add(localV).div(n),
    );
  });

  const rootUVCompute = Fn(([nodeIndex, ix, iy]: [Node, Node, Node]) => {
    if (isSphere) {
      return tileFaceUV(nodeIndex, ix, iy);
    }
    const nodeVec2 = tileOriginVec2(nodeIndex);
    const nodeX = nodeVec2.x;
    const nodeY = nodeVec2.y;
    const rootSize = uniforms.uRootSize.toVar();
    const rootOrigin = uniforms.uRootOrigin.toVar();
    const size = tileSize(nodeIndex);

    const half = float(0.5);
    const halfRoot = float(rootSize).mul(half);
    const fInnerSegments = uniforms.uInnerTileSegments.toVar().toFloat();
    const texelSpacing = size.div(fInnerSegments);
    const absX = nodeX
      .mul(fInnerSegments)
      .add(int(ix).toFloat().sub(float(1.0)));
    const absY = nodeY
      .mul(fInnerSegments)
      .add(int(iy).toFloat().sub(float(1.0)));
    const worldX = rootOrigin.x.add(absX.mul(texelSpacing)).sub(halfRoot);
    const worldZ = rootOrigin.z.add(absY.mul(texelSpacing)).sub(halfRoot);

    const centeredX = worldX.sub(rootOrigin.x);
    const centeredZ = worldZ.sub(rootOrigin.z);
    return vec2(
      centeredX.div(rootSize).add(half),
      centeredZ.div(rootSize).mul(float(-1.0)).add(half),
    );
  });

  const tileVertexWorldPositionCompute = Fn(
    ([nodeIndex, ix, iy]: [Node, Node, Node]) => {
      const rootOrigin = uniforms.uRootOrigin.toVar();
      if (isSphere) {
        const faceUV = tileFaceUV(nodeIndex, ix, iy);
        const basis = cubeFaceBasis(tileFace(nodeIndex));
        const dir = cubeFaceDirection(basis, faceUV.x, faceUV.y);
        return rootOrigin.add(dir.mul(uniforms.uRadius.toVar()));
      }
      const nodeVec2 = tileOriginVec2(nodeIndex);
      const nodeX = nodeVec2.x;
      const nodeY = nodeVec2.y;
      const rootSize = uniforms.uRootSize.toVar();
      const size = tileSize(nodeIndex);
      const half = float(0.5);
      const halfRoot = float(rootSize).mul(half);
      const fInnerSegments = uniforms.uInnerTileSegments.toVar().toFloat();
      const texelSpacing = size.div(fInnerSegments);
      const absX = nodeX
        .mul(fInnerSegments)
        .add(int(ix).toFloat().sub(float(1.0)));
      const absY = nodeY
        .mul(fInnerSegments)
        .add(int(iy).toFloat().sub(float(1.0)));
      const worldX = rootOrigin.x.add(absX.mul(texelSpacing)).sub(halfRoot);
      const worldZ = rootOrigin.z.add(absY.mul(texelSpacing)).sub(halfRoot);
      return vec3(worldX, rootOrigin.y, worldZ);
    },
  );

  return {
    tileLevel,
    tileFace,
    tileOriginVec2,
    tileSize,
    tileFaceUV,
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

/**
 * Remap a tile-local coordinate from inner-grid `[0, 1]` to full-texture UV,
 * offsetting past the 1-texel skirt border on each side and centering on
 * inner texels.
 *
 * `localCoord` is `0` at the first inner vertex and `1` at the last.
 * `innerSegments` is `uInnerTileSegments` (edgeVertexCount − 3).
 */
export function tileLocalToFieldUV(
  localCoord: Node,
  innerSegments: Node,
): Node {
  const edge = float(innerSegments).add(float(3));
  return float(localCoord).mul(float(innerSegments)).add(float(1.5)).div(edge);
}
