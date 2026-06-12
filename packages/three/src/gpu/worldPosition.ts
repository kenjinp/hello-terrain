import {
  Fn,
  If,
  float,
  instanceIndex,
  int,
  normalLocal,
  positionLocal,
  pow,
  select,
  uint,
  vec3,
  vertexIndex,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { cubeFaceBasis, cubeFaceDirection } from "../tsl/cubeSphere";
import type { TopologyProjection } from "../quadtree";
import { isSkirtVertex } from "../tsl/skirt";
import type { LeafStorageState, TerrainUniformsContext } from "../types";
import type { TerrainFieldStorage } from "./terrainFieldStorage";
import { loadTerrainFieldNormal, sampleTerrainFieldElevation } from "./terrainFieldStorage";
import { decodeLeafTile, faceUVFromTileLocal, tileLocalToFieldUV } from "./tile";

/** Options controlling LOD seam stitching of tile boundary vertices. */
export type WorldPositionOptions = {
  /** Stitch odd boundary vertices across 2:1 LOD boundaries. */
  stitchSeams?: boolean;
  /** Inner segment count (JS value), used to validate even-N watertightness. */
  innerSegments?: number;
};

// ── Per-vertex grid index ───────────────────────────────────────────────

/** Grid `(ix, iy)` for the current vertex (includes the 1-texel skirt ring). */
function vertexGridIndex(terrainUniforms: TerrainUniformsContext): { ix: Node; iy: Node } {
  const edgeVertexCount = int(terrainUniforms.uInnerTileSegments.add(3));
  const localVertexIndex = int(vertexIndex);
  return {
    ix: localVertexIndex.mod(edgeVertexCount),
    iy: localVertexIndex.div(edgeVertexCount),
  };
}

// ── Analytic per-texel world position (no skirt) ────────────────────────

/** Elevation at a tile-local `[0, 1]` coordinate, scaled to world units. */
function tileElevationAtLocal(
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage: TerrainFieldStorage | undefined,
  local01U: Node,
  local01V: Node,
): Node {
  if (!terrainFieldStorage) return float(0);
  const innerSegs = terrainUniforms.uInnerTileSegments;
  const u = tileLocalToFieldUV(local01U, innerSegs);
  const v = tileLocalToFieldUV(local01V, innerSegs);
  return sampleTerrainFieldElevation(terrainFieldStorage, u, v, int(instanceIndex)).mul(
    terrainUniforms.uElevationScale,
  );
}

/** Displaced flat world position for grid texel `(ix, iy)` (no skirt drop). */
function flatWorldPositionAt(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage: TerrainFieldStorage | undefined,
  ix: Node,
  iy: Node,
): Node {
  const tile = decodeLeafTile(leafStorage, int(instanceIndex));
  const rootSize = terrainUniforms.uRootSize.toVar();
  const rootOrigin = terrainUniforms.uRootOrigin.toVar();
  const half = float(0.5);
  const size = rootSize.div(pow(float(2), tile.level.toFloat()));
  const halfRoot = rootSize.mul(half);
  const innerSeg = terrainUniforms.uInnerTileSegments.toFloat();

  const local01U = int(ix).toFloat().sub(float(1)).div(innerSeg);
  const local01V = int(iy).toFloat().sub(float(1)).div(innerSeg);

  const centerX = rootOrigin.x.add(tile.x.add(half).mul(size)).sub(halfRoot);
  const centerZ = rootOrigin.z.add(tile.y.add(half).mul(size)).sub(halfRoot);
  const worldX = centerX.add(local01U.sub(half).mul(size));
  const worldZ = centerZ.add(local01V.sub(half).mul(size));

  const elevation = tileElevationAtLocal(terrainUniforms, terrainFieldStorage, local01U, local01V);
  return vec3(worldX, rootOrigin.y.add(elevation), worldZ);
}

/** Displaced cube-sphere world position for grid texel `(ix, iy)` (no skirt drop). */
function sphereWorldPositionAt(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage: TerrainFieldStorage | undefined,
  ix: Node,
  iy: Node,
): Node {
  const tile = decodeLeafTile(leafStorage, int(instanceIndex));
  const innerSeg = terrainUniforms.uInnerTileSegments.toFloat();
  const local01U = int(ix).toFloat().sub(float(1)).div(innerSeg);
  const local01V = int(iy).toFloat().sub(float(1)).div(innerSeg);

  const faceUV = faceUVFromTileLocal(tile, local01U, local01V);
  const basis = cubeFaceBasis(tile.face);
  const dir = cubeFaceDirection(basis, faceUV.x, faceUV.y);

  const elevation = tileElevationAtLocal(terrainUniforms, terrainFieldStorage, local01U, local01V);
  const r = terrainUniforms.uRadius.toVar().add(elevation);
  return terrainUniforms.uRootOrigin.toVar().add(dir.mul(r));
}

type WorldPositionAt = (
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage: TerrainFieldStorage | undefined,
  ix: Node,
  iy: Node,
) => Node;

// ── Seam stitching ──────────────────────────────────────────────────────

/** True when edge `dir` (Dir bit) of this tile faces a coarser neighbor. */
function edgeFacesCoarser(edgeMask: Node, dir: number): Node {
  return uint(edgeMask).bitAnd(uint(1 << dir)).greaterThan(uint(0));
}

/**
 * Override the boundary vertex position and normal to stitch a 2:1 LOD seam.
 *
 * For an odd interior boundary vertex on an edge whose neighbor is coarser, the
 * vertex is snapped to the world-space midpoint of its two even edge-neighbors
 * (which already coincide with the coarse neighbor's vertices), and its normal
 * to the renormalized mean of those neighbors' world normals. Corners (the
 * even endpoints) are never snapped, so multi-edge corners need no special case.
 */
function applyStitch(
  positionVar: Node,
  normalVar: Node,
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage: TerrainFieldStorage,
  worldPositionAt: WorldPositionAt,
  ix: Node,
  iy: Node,
): void {
  const tile = decodeLeafTile(leafStorage, int(instanceIndex));
  const nodeIndex = int(instanceIndex);
  const lastInner = int(terrainUniforms.uInnerTileSegments).add(int(1));

  const onLeft = int(ix).equal(int(1));
  const onRight = int(ix).equal(lastInner);
  const onTop = int(iy).equal(int(1));
  const onBottom = int(iy).equal(lastInner);

  // Along-edge interior (exclude both corners) and odd parity.
  const interiorIy = int(iy).greaterThan(int(1)).and(int(iy).lessThan(lastInner));
  const interiorIx = int(ix).greaterThan(int(1)).and(int(ix).lessThan(lastInner));
  const oddAlongIy = int(iy).sub(int(1)).bitAnd(int(1)).equal(int(1));
  const oddAlongIx = int(ix).sub(int(1)).bitAnd(int(1)).equal(int(1));

  const lrCoarse = onLeft.and(edgeFacesCoarser(tile.edgeMask, 0)).or(
    onRight.and(edgeFacesCoarser(tile.edgeMask, 1)),
  );
  const tbCoarse = onTop.and(edgeFacesCoarser(tile.edgeMask, 2)).or(
    onBottom.and(edgeFacesCoarser(tile.edgeMask, 3)),
  );

  const stitchLR = lrCoarse.and(interiorIy).and(oddAlongIy);
  const stitchTB = tbCoarse.and(interiorIx).and(oddAlongIx);

  If(stitchLR, () => {
    const a = worldPositionAt(leafStorage, terrainUniforms, terrainFieldStorage, ix, int(iy).sub(int(1)));
    const b = worldPositionAt(leafStorage, terrainUniforms, terrainFieldStorage, ix, int(iy).add(int(1)));
    positionVar.assign(a.add(b).mul(float(0.5)));
    const na = loadTerrainFieldNormal(terrainFieldStorage, ix, int(iy).sub(int(1)), nodeIndex);
    const nb = loadTerrainFieldNormal(terrainFieldStorage, ix, int(iy).add(int(1)), nodeIndex);
    normalVar.assign(na.add(nb).normalize());
  }).ElseIf(stitchTB, () => {
    const a = worldPositionAt(leafStorage, terrainUniforms, terrainFieldStorage, int(ix).sub(int(1)), iy);
    const b = worldPositionAt(leafStorage, terrainUniforms, terrainFieldStorage, int(ix).add(int(1)), iy);
    positionVar.assign(a.add(b).mul(float(0.5)));
    const na = loadTerrainFieldNormal(terrainFieldStorage, int(ix).sub(int(1)), iy, nodeIndex);
    const nb = loadTerrainFieldNormal(terrainFieldStorage, int(ix).add(int(1)), iy, nodeIndex);
    normalVar.assign(na.add(nb).normalize());
  });
}

// ── World normal ────────────────────────────────────────────────────────

/**
 * Loads the unit world-space normal for the current vertex straight from the
 * terrain field. The compute stage stores normals in world space (continuous
 * across cube-face seams), so no per-face tangent-frame rotation is needed.
 */
function loadWorldNormal(
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage: TerrainFieldStorage,
): Node {
  const { ix, iy } = vertexGridIndex(terrainUniforms);
  return loadTerrainFieldNormal(terrainFieldStorage, ix, iy, int(instanceIndex));
}

// ── Position assembly per projection ────────────────────────────────────

function createCubeSphereWorldPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage: TerrainFieldStorage | undefined,
  stitch: boolean,
) {
  return Fn(() => {
    const tile = decodeLeafTile(leafStorage, int(instanceIndex));

    const half = float(0.5);
    const localU = positionLocal.x.max(half.negate()).min(half).add(half);
    const localV = positionLocal.z.max(half.negate()).min(half).add(half);
    const faceUV = faceUVFromTileLocal(tile, localU, localV);

    const basis = cubeFaceBasis(tile.face);
    const dir = cubeFaceDirection(basis, faceUV.x, faceUV.y);

    const innerSegs = terrainUniforms.uInnerTileSegments;
    const elevU = tileLocalToFieldUV(localU, innerSegs);
    const elevV = tileLocalToFieldUV(localV, innerSegs);
    const yElevation = terrainFieldStorage
      ? sampleTerrainFieldElevation(terrainFieldStorage, elevU, elevV, int(instanceIndex)).mul(
          terrainUniforms.uElevationScale,
        )
      : float(0);
    const baseRadius = terrainUniforms.uRadius.toVar().add(yElevation);
    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const r = select(skirtVertex, baseRadius.sub(terrainUniforms.uSkirtScale.toVar()), baseRadius);

    const origin = terrainUniforms.uRootOrigin.toVar();
    const positionVar = origin.add(dir.mul(r)).toVar();
    const normalVar = (
      terrainFieldStorage ? loadWorldNormal(terrainUniforms, terrainFieldStorage) : vec3(0, 1, 0)
    ).toVar();

    if (stitch && terrainFieldStorage) {
      const { ix, iy } = vertexGridIndex(terrainUniforms);
      applyStitch(
        positionVar,
        normalVar,
        leafStorage,
        terrainUniforms,
        terrainFieldStorage,
        sphereWorldPositionAt,
        ix,
        iy,
      );
    }

    normalLocal.assign(normalVar);
    return positionVar;
  })();
}

function createFlatWorldPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage: TerrainFieldStorage | undefined,
  stitch: boolean,
) {
  return Fn(() => {
    const tile = decodeLeafTile(leafStorage, int(instanceIndex));

    const rootSize = terrainUniforms.uRootSize.toVar();
    const rootOrigin = terrainUniforms.uRootOrigin.toVar();
    const half = float(0.5);
    const size = rootSize.div(pow(float(2), tile.level.toFloat()));
    const halfRoot = rootSize.mul(half);

    const centerX = rootOrigin.x.add(tile.x.add(half).mul(size)).sub(halfRoot);
    const centerZ = rootOrigin.z.add(tile.y.add(half).mul(size)).sub(halfRoot);
    const clampedX = positionLocal.x.max(half.negate()).min(half);
    const clampedZ = positionLocal.z.max(half.negate()).min(half);
    const worldX = centerX.add(clampedX.mul(size));
    const worldZ = centerZ.add(clampedZ.mul(size));

    const innerSegs = terrainUniforms.uInnerTileSegments;
    const elevU = tileLocalToFieldUV(positionLocal.x.add(half), innerSegs);
    const elevV = tileLocalToFieldUV(positionLocal.z.add(half), innerSegs);
    const yElevation = terrainFieldStorage
      ? sampleTerrainFieldElevation(terrainFieldStorage, elevU, elevV, int(instanceIndex)).mul(
          terrainUniforms.uElevationScale,
        )
      : float(0);

    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const skirtY = rootOrigin.y.add(yElevation).sub(terrainUniforms.uSkirtScale.toVar());
    const worldY = select(skirtVertex, skirtY, rootOrigin.y.add(yElevation));

    const positionVar = vec3(worldX, worldY, worldZ).toVar();
    const normalVar = (
      terrainFieldStorage ? loadWorldNormal(terrainUniforms, terrainFieldStorage) : vec3(0, 1, 0)
    ).toVar();

    if (stitch && terrainFieldStorage) {
      const { ix, iy } = vertexGridIndex(terrainUniforms);
      applyStitch(
        positionVar,
        normalVar,
        leafStorage,
        terrainUniforms,
        terrainFieldStorage,
        flatWorldPositionAt,
        ix,
        iy,
      );
    }

    normalLocal.assign(normalVar);
    return positionVar;
  })();
}

export function createTileWorldPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage?: TerrainFieldStorage,
  projection: TopologyProjection = "flat",
  options: WorldPositionOptions = {},
) {
  const stitch = options.stitchSeams ?? false;
  if (
    stitch &&
    options.innerSegments !== undefined &&
    options.innerSegments % 2 !== 0
  ) {
    // Interior odd vertices still stitch correctly; only the child-corner
    // vertex is left for the skirt to cover. Use an even innerSegments for
    // fully watertight LOD seams.
    console.warn(
      `[hello-terrain] seam stitching is most watertight with an even innerTileSegments; got ${options.innerSegments}. Child-corner vertices will rely on skirts.`,
    );
  }

  if (projection === "cubeSphere") {
    return createCubeSphereWorldPosition(leafStorage, terrainUniforms, terrainFieldStorage, stitch);
  }
  return createFlatWorldPosition(leafStorage, terrainUniforms, terrainFieldStorage, stitch);
}
