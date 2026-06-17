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
import type { LeafStorageState, TerrainUniformsContext } from "../types";
import type { TerrainFieldStorage } from "./terrainFieldStorage";
import { loadTerrainFieldNormal, sampleTerrainFieldElevation } from "./terrainFieldStorage";
import { type LeafTileNodes, decodeLeafTile, faceUVFromTileLocal, tileLocalToFieldUV } from "./tile";

function createTileElevation(
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage?: TerrainFieldStorage,
) {
  if (!terrainFieldStorage) return float(0);
  const innerSegs = terrainUniforms.uInnerTileSegments;
  const u = tileLocalToFieldUV(positionLocal.x.add(float(0.5)), innerSegs);
  const v = tileLocalToFieldUV(positionLocal.z.add(float(0.5)), innerSegs);
  return sampleTerrainFieldElevation(terrainFieldStorage, u, v, int(instanceIndex)).mul(
    terrainUniforms.uElevationScale,
  );
}

/**
 * Loads the unit world-space normal for the current vertex straight from the
 * terrain field. The compute stage already stores normals in world space
 * (continuous across seams), so no per-tile tangent-frame rotation is needed at
 * render time — this is shared by every projection.
 */
function loadWorldNormal(
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage: TerrainFieldStorage,
) {
  const nodeIndex = int(instanceIndex);
  const edgeVertexCount = int(terrainUniforms.uInnerTileSegments.add(3));
  const localVertexIndex = int(vertexIndex);
  const ix = localVertexIndex.mod(edgeVertexCount);
  const iy = localVertexIndex.div(edgeVertexCount);
  return loadTerrainFieldNormal(terrainFieldStorage, ix, iy, nodeIndex);
}

function assignWorldNormal(
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage?: TerrainFieldStorage,
) {
  if (!terrainFieldStorage) return;
  normalLocal.assign(Fn(() => loadWorldNormal(terrainUniforms, terrainFieldStorage))());
}

/** Flat heightfield: tiles lie in the XZ plane; elevation displaces along +Y. */
export function createFlatRenderVertexPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage?: TerrainFieldStorage,
): Node {
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

    const yElevation = createTileElevation(terrainUniforms, terrainFieldStorage);
    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const baseY = rootOrigin.y.add(yElevation);
    const skirtY = baseY.sub(terrainUniforms.uSkirtScale.toVar());
    const worldY = select(skirtVertex, skirtY, baseY);

    assignWorldNormal(terrainUniforms, terrainFieldStorage);
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
): Node {
  const fBaseU = float(baseU);
  const fBaseV = float(baseV);

  return Fn(() => {
    const tile = decodeLeafTile(leafStorage, int(instanceIndex));
    const half = float(0.5);
    const localU = positionLocal.x.max(half.negate()).min(half).add(half);
    const localV = positionLocal.z.max(half.negate()).min(half).add(half);
    const faceUV = faceUVFromTileLocal(tile, localU, localV, fBaseU, fBaseV);

    const yElevation = createTileElevation(terrainUniforms, terrainFieldStorage);
    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const displacement = select(
      skirtVertex,
      yElevation.sub(terrainUniforms.uSkirtScale.toVar()),
      yElevation,
    );

    assignWorldNormal(terrainUniforms, terrainFieldStorage);
    return surfacePoint(tile, faceUV, displacement);
  })();
}
