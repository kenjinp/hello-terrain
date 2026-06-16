import { Fn, float, int, pow, vec2 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { SurfaceProjection } from "../projection/types";
import type { LeafStorageState, TerrainUniformsContext } from "../types";

/** A cube face (and a torus) spans ~PI/2 of arc per root subdivision. */
export const HALF_PI = Math.PI * 0.5;

/**
 * Offset (in texels) from the field edge to the first inner texel center:
 * 1-texel skirt border + 0.5 texel centering.
 */
export const FIELD_INNER_TEXEL_OFFSET = 1.5;

/** Extra texels per edge beyond `innerTileSegments`: 2 skirt border + 1 closing vertex. */
export const FIELD_EDGE_EXTRA_TEXELS = 3;

/**
 * Approximate arc length of a tile edge on a sphere, used to scale elevation
 * gradients into world units. `levelDivisor` is `2 ** level`.
 */
export function sphereTileArcLength(radius: number, levelDivisor: number): number {
  return (radius * HALF_PI) / levelDivisor;
}

/** TSL nodes for one decoded leaf tile record. */
export type LeafTileNodes = {
  level: Node;
  x: Node;
  y: Node;
  /** Surface space/face index (0 for flat/torus, 0..5 for cube-sphere faces). */
  face: Node;
};

/**
 * Decode a leaf tile record from leaf storage. Records are packed as
 * `[level, x, y, space/face]` at `nodeIndex * 4` (see `leafGpuBufferTask`).
 */
export function decodeLeafTile(leafStorage: LeafStorageState, nodeIndex: Node): LeafTileNodes {
  const nodeOffset = int(nodeIndex).mul(int(4));
  return {
    level: leafStorage.node.element(nodeOffset).toInt(),
    x: leafStorage.node.element(nodeOffset.add(int(1))).toFloat(),
    y: leafStorage.node.element(nodeOffset.add(int(2))).toFloat(),
    face: leafStorage.node.element(nodeOffset.add(int(3))).toInt(),
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

/** Shared (projection-independent) tile-compute helpers. */
export type SharedTileCompute = {
  tileLevel: (nodeIndex: Node) => Node;
  tileFace: (nodeIndex: Node) => Node;
  tileOriginVec2: (nodeIndex: Node) => Node;
  /** Face-local (u, v) in [0, 1] for a grid sample, including skirt border. */
  tileFaceUV: (nodeIndex: Node, ix: Node, iy: Node) => Node;
};

/** Projection-specific tile-compute builders. */
export type TileComputeParts = {
  tileSize: (nodeIndex: Node) => Node;
  rootUV: (nodeIndex: Node, ix: Node, iy: Node) => Node;
  tileVertexWorldPosition: (nodeIndex: Node, ix: Node, iy: Node) => Node;
};

export type TileComputePartsContext = {
  leafStorage: LeafStorageState;
  uniforms: TerrainUniformsContext;
  shared: SharedTileCompute;
};

export type TileCompute = SharedTileCompute & {
  tileSize: (nodeIndex: Node) => Node;
  rootUVCompute: (nodeIndex: Node, ix: Node, iy: Node) => Node;
  tileVertexWorldPositionCompute: (nodeIndex: Node, ix: Node, iy: Node) => Node;
};

/**
 * Build the per-tile compute helpers, composing projection-independent
 * decoders with the projection-specific position/size/uv builders supplied by
 * `projection.gpu.createTileComputeParts`.
 */
export function createTileCompute(
  leafStorage: LeafStorageState,
  uniforms: TerrainUniformsContext,
  projection: SurfaceProjection,
): TileCompute {
  const tileLevel = Fn(([nodeIndex]: [Node]) => decodeLeafTile(leafStorage, nodeIndex).level);
  const tileFace = Fn(([nodeIndex]: [Node]) => decodeLeafTile(leafStorage, nodeIndex).face);
  const tileOriginVec2 = Fn(([nodeIndex]: [Node]) => {
    const tile = decodeLeafTile(leafStorage, nodeIndex);
    return vec2(tile.x, tile.y);
  });
  const tileFaceUV = Fn(([nodeIndex, ix, iy]: [Node, Node, Node]) => {
    const tile = decodeLeafTile(leafStorage, nodeIndex);
    const fInnerSegments = uniforms.uInnerTileSegments.toVar().toFloat();
    const localU = int(ix).toFloat().sub(float(1.0)).div(fInnerSegments);
    const localV = int(iy).toFloat().sub(float(1.0)).div(fInnerSegments);
    return faceUVFromTileLocal(tile, localU, localV);
  });

  const shared: SharedTileCompute = {
    tileLevel: (nodeIndex) => tileLevel(nodeIndex),
    tileFace: (nodeIndex) => tileFace(nodeIndex),
    tileOriginVec2: (nodeIndex) => tileOriginVec2(nodeIndex),
    tileFaceUV: (nodeIndex, ix, iy) => tileFaceUV(nodeIndex, ix, iy),
  };

  const parts = projection.gpu.createTileComputeParts({ leafStorage, uniforms, shared });

  return {
    ...shared,
    tileSize: parts.tileSize,
    rootUVCompute: parts.rootUV,
    tileVertexWorldPositionCompute: parts.tileVertexWorldPosition,
  };
}

/**
 * Remap a tile-local coordinate from inner-grid `[0, 1]` to full-texture UV,
 * offsetting past the 1-texel skirt border on each side and centering on
 * inner texels.
 */
export function tileLocalToFieldUV(localCoord: Node, innerSegments: Node): Node {
  const edge = float(innerSegments).add(float(FIELD_EDGE_EXTRA_TEXELS));
  return float(localCoord)
    .mul(float(innerSegments))
    .add(float(FIELD_INNER_TEXEL_OFFSET))
    .div(edge);
}

/** CPU variant of {@link tileLocalToFieldUV} for snapshot-based queries. */
export function tileLocalToFieldUVNumber(localCoord: number, innerSegments: number): number {
  const edge = innerSegments + FIELD_EDGE_EXTRA_TEXELS;
  return (localCoord * innerSegments + FIELD_INNER_TEXEL_OFFSET) / edge;
}
