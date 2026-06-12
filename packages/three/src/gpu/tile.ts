import { Fn, float, int, pow, uint, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { TopologyProjection } from "../quadtree";
import { cubeFaceBasis, cubeFaceDirection } from "../tsl/cubeSphere";
import type { LeafStorageState, TerrainUniformsContext } from "../types";

/** A cube face spans ~PI/2 of arc on the sphere. */
export const HALF_PI = Math.PI * 0.5;

/**
 * Offset (in texels) from the field edge to the first inner texel center:
 * 1-texel skirt border + 0.5 texel centering.
 */
export const FIELD_INNER_TEXEL_OFFSET = 1.5;

/** Extra texels per edge beyond `innerTileSegments`: 2 skirt border + 1 closing vertex. */
export const FIELD_EDGE_EXTRA_TEXELS = 3;

/**
 * Approximate arc length of a tile edge on the sphere, used to scale elevation
 * gradients into world units. `levelDivisor` is `2 ** level`.
 *
 * Mirrors: the TSL `tileSize` cube-sphere branch in {@link createTileCompute}.
 */
export function sphereTileArcLength(radius: number, levelDivisor: number): number {
  return (radius * HALF_PI) / levelDivisor;
}

/** TSL nodes for one decoded leaf tile record. */
export type LeafTileNodes = {
  level: Node;
  x: Node;
  y: Node;
  /** Surface space/face index (0 for flat, 0..5 for cube-sphere faces). */
  face: Node;
  /**
   * 4-bit coarse-neighbor edge mask (bit `1<<dir` for LEFT,RIGHT,TOP,BOTTOM).
   * A set bit means the neighbor across that edge is one level coarser and the
   * edge needs T-junction stitching on this tile.
   */
  edgeMask: Node;
};

/**
 * Decode a leaf tile record from leaf storage. Records are packed as
 * `[level, x, y, space|edgeMask<<3]` at `nodeIndex * 4` (see `leafGpuBufferTask`):
 * slot 3 holds the face index in bits 0..2 and the coarse-neighbor edge mask in
 * bits 3..6.
 */
export function decodeLeafTile(leafStorage: LeafStorageState, nodeIndex: Node): LeafTileNodes {
  const nodeOffset = int(nodeIndex).mul(int(4));
  const packed = uint(leafStorage.node.element(nodeOffset.add(int(3))));
  return {
    level: leafStorage.node.element(nodeOffset).toInt(),
    x: leafStorage.node.element(nodeOffset.add(int(1))).toFloat(),
    y: leafStorage.node.element(nodeOffset.add(int(2))).toFloat(),
    face: packed.bitAnd(uint(0x7)).toInt(),
    edgeMask: packed.shiftRight(uint(3)).bitAnd(uint(0xf)).toInt(),
  };
}

/**
 * Face-local (u, v) in [0, 1] for a tile-local coordinate:
 * `(tile.xy + local) / 2^level`.
 */
export function faceUVFromTileLocal(
  tile: Pick<LeafTileNodes, "level" | "x" | "y">,
  localU: Node,
  localV: Node,
): Node {
  const n = pow(float(2), tile.level.toFloat());
  return vec2(tile.x.add(localU).div(n), tile.y.add(localV).div(n));
}

export function createTileCompute(
  leafStorage: LeafStorageState,
  uniforms: TerrainUniformsContext,
  projection: TopologyProjection = "flat",
) {
  const isSphere = projection === "cubeSphere";

  const tileLevel = Fn(([nodeIndex]: [Node]) => {
    return decodeLeafTile(leafStorage, nodeIndex).level;
  });

  const tileFace = Fn(([nodeIndex]: [Node]) => {
    return decodeLeafTile(leafStorage, nodeIndex).face;
  });

  const tileOriginVec2 = Fn(([nodeIndex]: [Node]) => {
    const tile = decodeLeafTile(leafStorage, nodeIndex);
    return vec2(tile.x, tile.y);
  });

  const tileSize = Fn(([nodeIndex]: [Node]) => {
    const level = tileLevel(nodeIndex);
    const divisor = pow(float(2), level.toFloat());
    if (isSphere) {
      // Mirrors: sphereTileArcLength (CPU).
      return uniforms.uRadius.toVar().mul(float(HALF_PI)).div(divisor);
    }
    const rootSize = uniforms.uRootSize.toVar();
    return float(rootSize).div(divisor);
  });

  /** Face-local (u, v) in [0, 1] for a grid sample, including skirt border. */
  const tileFaceUV = Fn(([nodeIndex, ix, iy]: [Node, Node, Node]) => {
    const tile = decodeLeafTile(leafStorage, nodeIndex);
    const fInnerSegments = uniforms.uInnerTileSegments.toVar().toFloat();
    const localU = int(ix).toFloat().sub(float(1.0)).div(fInnerSegments);
    const localV = int(iy).toFloat().sub(float(1.0)).div(fInnerSegments);
    return faceUVFromTileLocal(tile, localU, localV);
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

/**
 * Remap a tile-local coordinate from inner-grid `[0, 1]` to full-texture UV,
 * offsetting past the 1-texel skirt border on each side and centering on
 * inner texels.
 *
 * `localCoord` is `0` at the first inner vertex and `1` at the last.
 * `innerSegments` is `uInnerTileSegments` (edgeVertexCount − 3).
 *
 * Mirrors: {@link tileLocalToFieldUVNumber} (CPU).
 */
export function tileLocalToFieldUV(
  localCoord: Node,
  innerSegments: Node,
): Node {
  const edge = float(innerSegments).add(float(FIELD_EDGE_EXTRA_TEXELS));
  return float(localCoord)
    .mul(float(innerSegments))
    .add(float(FIELD_INNER_TEXEL_OFFSET))
    .div(edge);
}

/**
 * CPU variant of {@link tileLocalToFieldUV} for snapshot-based queries.
 *
 * Mirrors: tileLocalToFieldUV (TSL). Keep the two formulas in sync.
 */
export function tileLocalToFieldUVNumber(
  localCoord: number,
  innerSegments: number,
): number {
  const edge = innerSegments + FIELD_EDGE_EXTRA_TEXELS;
  return (localCoord * innerSegments + FIELD_INNER_TEXEL_OFFSET) / edge;
}
