import {
  Fn,
  float,
  instanceIndex,
  int,
  normalLocal,
  positionLocal,
  pow,
  select,
  unpackHalf2x16,
  vec3,
  vertexIndex,
} from "three/tsl";
import type { Node, StorageBufferNode } from "three/webgpu";
import type { LeafStorageState, TerrainUniformsContext } from "../types";
import { deriveNormalZ } from "../tsl/materials";
import { isSkirtVertex } from "../tsl/skirt";
import { readElevationFieldAtPositionLocal } from "./elevation-field";

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
  elevationFieldBufferNode?: StorageBufferNode,
) {
  if (!elevationFieldBufferNode) return float(0);
  const edgeVertexCount = terrainUniforms.uInnerTileSegments.add(3);
  return readElevationFieldAtPositionLocal(
    elevationFieldBufferNode,
    edgeVertexCount,
    positionLocal,
  )().mul(
    terrainUniforms.uElevationScale,
  );
}

export function createNormalAssignment(
  terrainUniforms: TerrainUniformsContext,
  normalFieldBufferNode?: Node,
) {
  if (!normalFieldBufferNode) return;
  const nodeIndex = int(instanceIndex);
  const intEdge = int(terrainUniforms.uInnerTileSegments.add(3));
  const verticesPerNode = intEdge.mul(intEdge);
  const globalVertexIndex = nodeIndex.mul(verticesPerNode).add(int(vertexIndex));
  const packed = normalFieldBufferNode.element(globalVertexIndex);
  const normalXZ = unpackHalf2x16(packed);
  const reconstructed = deriveNormalZ(normalXZ);
  normalLocal.assign(vec3(reconstructed.x, reconstructed.z, reconstructed.y));
}

export function createTileWorldPosition(
  leafStorage: LeafStorageState,
  terrainUniforms: TerrainUniformsContext,
  elevationFieldBufferNode?: StorageBufferNode,
  normalFieldBufferNode?: Node,
) {
  const baseWorldPosition = createTileBaseWorldPosition(leafStorage, terrainUniforms);

  return Fn(() => {
    const base = baseWorldPosition();
    const yElevation = createTileElevation(terrainUniforms, elevationFieldBufferNode);
    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const skirtY = base.y.add(yElevation).sub(terrainUniforms.uSkirtScale.toVar());
    const worldY = select(skirtVertex, skirtY, base.y.add(yElevation));
    createNormalAssignment(terrainUniforms, normalFieldBufferNode);
    return vec3(base.x, worldY, base.z);
  })();
}
