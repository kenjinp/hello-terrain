import {
  Fn,
  float,
  instanceIndex,
  int,
  normalLocal,
  positionLocal,
  pow,
  select,
  vec3,
  vertexIndex,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { isSkirtVertex } from "../tsl/skirt";
import type {
  LeafStorageState,
  TerrainUniformsContext,
  VisibleSlotStorageState,
} from "../types";
import type { TerrainFieldStorage } from "./terrainFieldStorage";
import { loadTerrainField } from "./terrainFieldStorage";
import { type LeafTileNodes, decodeLeafTile, faceUVFromTileLocal } from "./tile";

type RenderFieldSample = {
  elevation: Node;
  normal: Node;
};

function renderFieldSampleCoordinates(terrainUniforms: TerrainUniformsContext) {
  const edgeVertexCount = int(terrainUniforms.uInnerTileSegments.add(3));
  const localVertexIndex = int(vertexIndex);
  const ix = localVertexIndex.mod(edgeVertexCount);
  const iy = localVertexIndex.div(edgeVertexCount);
  const lastInnerTexel = edgeVertexCount.sub(int(2));

  return {
    ix: ix.max(int(1)).min(lastInnerTexel),
    iy: iy.max(int(1)).min(lastInnerTexel),
  };
}

function loadRenderFieldSample(
  terrainUniforms: TerrainUniformsContext,
  fieldSlot: Node,
  terrainFieldStorage?: TerrainFieldStorage,
): RenderFieldSample | null {
  if (!terrainFieldStorage) return null;

  const { ix, iy } = renderFieldSampleCoordinates(terrainUniforms);
  const raw = loadTerrainField(terrainFieldStorage, ix, iy, fieldSlot).toVar();
  return {
    elevation: raw.r.mul(terrainUniforms.uElevationScale),
    normal: vec3(raw.g, raw.b, raw.a),
  };
}

function renderFieldSlot(visibleSlotStorage?: VisibleSlotStorageState): Node {
  const drawIndex = int(instanceIndex);
  return visibleSlotStorage
    ? visibleSlotStorage.node.element(drawIndex).toInt()
    : drawIndex;
}

function assignWorldNormal(sample: RenderFieldSample | null) {
  if (!sample) return;
  normalLocal.assign(sample.normal);
}

/** Flat heightfield: tiles lie in the XZ plane; elevation displaces along +Y. */
export function createFlatRenderVertexPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage?: TerrainFieldStorage,
  visibleSlotStorage?: VisibleSlotStorageState,
): Node {
  return Fn(() => {
    const fieldSlot = renderFieldSlot(visibleSlotStorage);
    const tile = decodeLeafTile(leafStorage, fieldSlot);
    const fieldSample = loadRenderFieldSample(terrainUniforms, fieldSlot, terrainFieldStorage);

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

    const yElevation = fieldSample?.elevation ?? float(0);
    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const baseY = rootOrigin.y.add(yElevation);
    const skirtY = baseY.sub(terrainUniforms.uSkirtScale.toVar());
    const worldY = select(skirtVertex, skirtY, baseY);

    assignWorldNormal(fieldSample);
    return vec3(worldX, worldY, worldZ);
  })();
}

/**
 * Assemble the displaced world position of a vertex on a curved, closed surface
 * (sphere or torus). `surfacePoint(tile, faceUV, displacement)` maps a
 * face-local `(u, v)` plus tube/radial displacement to a world position; the
 * projection supplies it. Skirt vertices pull the surface inward by
 * `uSkirtScale` along the displacement direction.
 */
export function createCurvedRenderVertexPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage: TerrainFieldStorage | undefined,
  surfacePoint: (tile: LeafTileNodes, faceUV: Node, displacement: Node) => Node,
  baseU = 1,
  baseV = 1,
  visibleSlotStorage?: VisibleSlotStorageState,
): Node {
  const fBaseU = float(baseU);
  const fBaseV = float(baseV);

  return Fn(() => {
    const fieldSlot = renderFieldSlot(visibleSlotStorage);
    const tile = decodeLeafTile(leafStorage, fieldSlot);
    const fieldSample = loadRenderFieldSample(terrainUniforms, fieldSlot, terrainFieldStorage);
    const half = float(0.5);
    const localU = positionLocal.x.max(half.negate()).min(half).add(half);
    const localV = positionLocal.z.max(half.negate()).min(half).add(half);
    const faceUV = faceUVFromTileLocal(tile, localU, localV, fBaseU, fBaseV);

    const yElevation = fieldSample?.elevation ?? float(0);
    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const displacement = select(
      skirtVertex,
      yElevation.sub(terrainUniforms.uSkirtScale.toVar()),
      yElevation,
    );

    assignWorldNormal(fieldSample);
    return surfacePoint(tile, faceUV, displacement);
  })();
}
