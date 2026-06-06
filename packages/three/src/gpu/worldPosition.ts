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
import type { SurfaceProjection } from "../quadtree";
import type { LeafStorageState, TerrainUniformsContext } from "../types";
import { cubeFaceBasis, cubeFaceDirection, tangentFromAxis } from "../nodes/cubeSphere";
import { isSkirtVertex } from "../tsl/skirt";
import type { TerrainFieldStorage } from "./terrainFieldStorage";
import {
  loadTerrainFieldNormal,
  sampleTerrainFieldElevation,
} from "./terrainFieldStorage";
import { tileLocalToFieldUV } from "./tile";

export function createTileBaseWorldPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
) {
  return Fn(() => {
    const nodeIndex = int(instanceIndex);
    const nodeOffset = nodeIndex.mul(int(4));
    const nodeLevel = leafStorage.node.element(nodeOffset).toInt();
    const nodeX = leafStorage.node.element(nodeOffset.add(int(1))).toFloat();
    const nodeY = leafStorage.node.element(nodeOffset.add(int(2))).toFloat();

    const rootSize = terrainUniforms.uRootSize.toVar();
    const rootOrigin = terrainUniforms.uRootOrigin.toVar();
    const half = float(0.5);
    const size = rootSize.div(pow(float(2), nodeLevel.toFloat()));
    const halfRoot = rootSize.mul(half);

    const centerX = rootOrigin.x.add(nodeX.add(half).mul(size)).sub(halfRoot);
    const centerZ = rootOrigin.z.add(nodeY.add(half).mul(size)).sub(halfRoot);
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
  return sampleTerrainFieldElevation(
    terrainFieldStorage,
    u,
    v,
    int(instanceIndex),
  ).mul(terrainUniforms.uElevationScale);
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
  const nx = normalXZ.x;
  const nz = normalXZ.y;
  const nySq = float(1).sub(nx.mul(nx)).sub(nz.mul(nz)).max(float(0));
  const ny = nySq.sqrt();
  return { ix, iy, nx, ny, nz };
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
      const { ix, iy, nx, ny, nz } = loadTangentNormal(terrainUniforms, terrainFieldStorage);

      const nodeIndex = int(instanceIndex);
      const nodeOffset = nodeIndex.mul(int(4));
      const level = leafStorage.node.element(nodeOffset).toInt();
      const nodeX = leafStorage.node.element(nodeOffset.add(int(1))).toFloat();
      const nodeY = leafStorage.node.element(nodeOffset.add(int(2))).toFloat();
      const face = leafStorage.node.element(nodeOffset.add(int(3))).toInt();

      const innerSeg = terrainUniforms.uInnerTileSegments.toVar().toFloat();
      const localU = ix.toFloat().sub(float(1)).div(innerSeg).max(float(0)).min(float(1));
      const localV = iy.toFloat().sub(float(1)).div(innerSeg).max(float(0)).min(float(1));
      const n = pow(float(2), level.toFloat());
      const u = nodeX.add(localU).div(n);
      const v = nodeY.add(localV).div(n);

      const basis = cubeFaceBasis(face);
      const dir = cubeFaceDirection(basis, u, v);
      const tu = tangentFromAxis(dir, basis.right);
      const tv = tangentFromAxis(dir, basis.up);

      // Rotate the tangent-space normal into the sphere tangent frame.
      return tu.mul(nx).add(dir.mul(ny)).add(tv.mul(nz)).normalize();
    })();
  }

  return Fn(() => {
    const { nx, ny, nz } = loadTangentNormal(terrainUniforms, terrainFieldStorage);
    return vec3(nx, ny, nz);
  })();
}

function createCubeSphereWorldPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage?: TerrainFieldStorage,
) {
  return Fn(() => {
    const nodeIndex = int(instanceIndex);
    const nodeOffset = nodeIndex.mul(int(4));
    const nodeLevel = leafStorage.node.element(nodeOffset).toInt();
    const nodeX = leafStorage.node.element(nodeOffset.add(int(1))).toFloat();
    const nodeY = leafStorage.node.element(nodeOffset.add(int(2))).toFloat();
    const face = leafStorage.node.element(nodeOffset.add(int(3))).toInt();

    const half = float(0.5);
    const n = pow(float(2), nodeLevel.toFloat());
    const localU = positionLocal.x.max(half.negate()).min(half).add(half);
    const localV = positionLocal.z.max(half.negate()).min(half).add(half);
    const u = nodeX.add(localU).div(n);
    const v = nodeY.add(localV).div(n);

    const basis = cubeFaceBasis(face);
    const dir = cubeFaceDirection(basis, u, v);

    const yElevation = createTileElevation(terrainUniforms, terrainFieldStorage);
    const baseRadius = terrainUniforms.uRadius.toVar().add(yElevation);
    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const r = select(
      skirtVertex,
      baseRadius.sub(terrainUniforms.uSkirtScale.toVar()),
      baseRadius,
    );

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
    return createCubeSphereWorldPosition(
      leafStorage,
      terrainUniforms,
      terrainFieldStorage,
    );
  }

  const baseWorldPosition = createTileBaseWorldPosition(
    leafStorage,
    terrainUniforms,
  );

  return Fn(() => {
    const base = baseWorldPosition();
    const yElevation = createTileElevation(
      terrainUniforms,
      terrainFieldStorage,
    );
    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const skirtY = base.y
      .add(yElevation)
      .sub(terrainUniforms.uSkirtScale.toVar());
    const worldY = select(skirtVertex, skirtY, base.y.add(yElevation));
    createNormalAssignment(leafStorage, terrainUniforms, terrainFieldStorage, "flat");
    return vec3(base.x, worldY, base.z);
  })();
}
