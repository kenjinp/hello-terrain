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
import {
  cubeFaceBasis,
  cubeFaceDirection,
  sphereTangentFrameNormal,
  unpackTangentNormal,
} from "../nodes/cubeSphere";
import type { SurfaceProjection } from "../quadtree";
import { isSkirtVertex } from "../tsl/skirt";
import type { LeafStorageState, TerrainUniformsContext } from "../types";
import type { TerrainFieldStorage } from "./terrainFieldStorage";
import { loadTerrainFieldNormal, sampleTerrainFieldElevation } from "./terrainFieldStorage";
import { decodeLeafTile, faceUVFromTileLocal, tileLocalToFieldUV } from "./tile";

export function createTileBaseWorldPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
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
    return vec3(worldX, rootOrigin.y, worldZ);
  });
}

export function createTileElevation(
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

export function createNormalAssignment(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage?: TerrainFieldStorage,
  projection: SurfaceProjection = "flat",
) {
  if (!terrainFieldStorage) return;
  normalLocal.assign(
    createTileLocalNormal(leafStorage, terrainUniforms, terrainFieldStorage, projection),
  );
}

/** Loads the packed tangent-space normal `(nx, ny, nz)` for the current vertex. */
function loadTangentNormal(
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage: TerrainFieldStorage,
) {
  const nodeIndex = int(instanceIndex);
  const edgeVertexCount = int(terrainUniforms.uInnerTileSegments.add(3));
  const localVertexIndex = int(vertexIndex);
  const ix = localVertexIndex.mod(edgeVertexCount);
  const iy = localVertexIndex.div(edgeVertexCount);
  const normalXZ = loadTerrainFieldNormal(terrainFieldStorage, ix, iy, nodeIndex);
  const normal = unpackTangentNormal(normalXZ.x, normalXZ.y);
  return { ix, iy, normal };
}

export function createTileLocalNormal(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage?: TerrainFieldStorage,
  projection: SurfaceProjection = "flat",
) {
  if (!terrainFieldStorage) return vec3(0, 1, 0);

  if (projection === "cubeSphere") {
    return Fn(() => {
      const { ix, iy, normal } = loadTangentNormal(terrainUniforms, terrainFieldStorage);

      const tile = decodeLeafTile(leafStorage, int(instanceIndex));
      const innerSeg = terrainUniforms.uInnerTileSegments.toVar().toFloat();
      const localU = ix.toFloat().sub(float(1)).div(innerSeg).max(float(0)).min(float(1));
      const localV = iy.toFloat().sub(float(1)).div(innerSeg).max(float(0)).min(float(1));
      const faceUV = faceUVFromTileLocal(tile, localU, localV);

      const basis = cubeFaceBasis(tile.face);
      const dir = cubeFaceDirection(basis, faceUV.x, faceUV.y);
      return sphereTangentFrameNormal(dir, basis, normal);
    })();
  }

  return Fn(() => {
    const { normal } = loadTangentNormal(terrainUniforms, terrainFieldStorage);
    return normal;
  })();
}

function createCubeSphereWorldPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage?: TerrainFieldStorage,
) {
  return Fn(() => {
    const tile = decodeLeafTile(leafStorage, int(instanceIndex));

    const half = float(0.5);
    const localU = positionLocal.x.max(half.negate()).min(half).add(half);
    const localV = positionLocal.z.max(half.negate()).min(half).add(half);
    const faceUV = faceUVFromTileLocal(tile, localU, localV);

    const basis = cubeFaceBasis(tile.face);
    const dir = cubeFaceDirection(basis, faceUV.x, faceUV.y);

    const yElevation = createTileElevation(terrainUniforms, terrainFieldStorage);
    const baseRadius = terrainUniforms.uRadius.toVar().add(yElevation);
    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const r = select(skirtVertex, baseRadius.sub(terrainUniforms.uSkirtScale.toVar()), baseRadius);

    createNormalAssignment(leafStorage, terrainUniforms, terrainFieldStorage, "cubeSphere");

    const origin = terrainUniforms.uRootOrigin.toVar();
    return origin.add(dir.mul(r));
  })();
}

export function createTileWorldPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage?: TerrainFieldStorage,
  projection: SurfaceProjection = "flat",
) {
  if (projection === "cubeSphere") {
    return createCubeSphereWorldPosition(leafStorage, terrainUniforms, terrainFieldStorage);
  }

  const baseWorldPosition = createTileBaseWorldPosition(leafStorage, terrainUniforms);

  return Fn(() => {
    const base = baseWorldPosition();
    const yElevation = createTileElevation(terrainUniforms, terrainFieldStorage);
    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const skirtY = base.y.add(yElevation).sub(terrainUniforms.uSkirtScale.toVar());
    const worldY = select(skirtVertex, skirtY, base.y.add(yElevation));
    createNormalAssignment(leafStorage, terrainUniforms, terrainFieldStorage, "flat");
    return vec3(base.x, worldY, base.z);
  })();
}
