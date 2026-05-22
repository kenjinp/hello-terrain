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
import type { LeafStorageState, TerrainUniformsContext } from "../types";
import { isSkirtVertex } from "../tsl/skirt";
import type { RenderIndirectionState } from "./renderIndirection";
import type { TerrainFieldStorage } from "./terrainFieldStorage";
import {
  loadTerrainFieldNormal,
  sampleTerrainFieldElevation,
} from "./terrainFieldStorage";
import { tileLocalToFieldUV } from "./tile";

export function createTileBaseWorldPosition(
  leafStorage: LeafStorageState,
  renderIndirection: RenderIndirectionState,
  terrainUniforms: TerrainUniformsContext,
) {
  return Fn(() => {
    const nodeIndex = renderIndirection.node.element(int(instanceIndex)).toInt();
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
  renderIndirection: RenderIndirectionState,
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
    renderIndirection.node.element(int(instanceIndex)).toInt(),
  ).mul(terrainUniforms.uElevationScale);
}

export function createNormalAssignment(
  renderIndirection: RenderIndirectionState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage?: TerrainFieldStorage,
) {
  if (!terrainFieldStorage) return;
  normalLocal.assign(
    createTileLocalNormal(renderIndirection, terrainUniforms, terrainFieldStorage),
  );
}

export function createTileLocalNormal(
  renderIndirection: RenderIndirectionState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage?: TerrainFieldStorage,
) {
  if (!terrainFieldStorage) return vec3(0, 1, 0);

  return Fn(() => {
    const nodeIndex = renderIndirection.node.element(int(instanceIndex)).toInt();
    const edgeVertexCount = int(terrainUniforms.uInnerTileSegments.add(3));
    const localVertexIndex = int(vertexIndex);
    const ix = localVertexIndex.mod(edgeVertexCount);
    const iy = localVertexIndex.div(edgeVertexCount);
    const normalXZ = loadTerrainFieldNormal(
      terrainFieldStorage,
      ix,
      iy,
      nodeIndex,
    );
    const nx = normalXZ.x;
    const nz = normalXZ.y;
    const nySq = float(1).sub(nx.mul(nx)).sub(nz.mul(nz)).max(float(0));
    const ny = nySq.sqrt();
    return vec3(nx, ny, nz);
  })();
}

export function createTileWorldPosition(
  leafStorage: LeafStorageState,
  renderIndirection: RenderIndirectionState,
  terrainUniforms: TerrainUniformsContext,
  terrainFieldStorage?: TerrainFieldStorage,
) {
  const baseWorldPosition = createTileBaseWorldPosition(
    leafStorage,
    renderIndirection,
    terrainUniforms,
  );

  return Fn(() => {
    const base = baseWorldPosition();
    const yElevation = createTileElevation(
      renderIndirection,
      terrainUniforms,
      terrainFieldStorage,
    );
    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const skirtY = base.y
      .add(yElevation)
      .sub(terrainUniforms.uSkirtScale.toVar());
    const worldY = select(skirtVertex, skirtY, base.y.add(yElevation));
    createNormalAssignment(renderIndirection, terrainUniforms, terrainFieldStorage);
    return vec3(base.x, worldY, base.z);
  })();
}
