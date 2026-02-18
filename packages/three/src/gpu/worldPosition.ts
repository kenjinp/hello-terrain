import {
  Fn,
  float,
  instanceIndex,
  int,
  normalLocal,
  positionLocal,
  pow,
  select,
  uint,
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
  seamFieldBufferNode?: Node,
) {
  const baseWorldPosition = createTileBaseWorldPosition(leafStorage, terrainUniforms);

  return Fn(() => {
    const base = baseWorldPosition();
    const yElevation = createTileElevation(terrainUniforms, elevationFieldBufferNode).toVar();
    const nodeIndex = int(instanceIndex).toVar();
    const nodeOffset = nodeIndex.mul(int(4)).toVar();

    if (elevationFieldBufferNode && seamFieldBufferNode) {
      const level = leafStorage.node.element(nodeOffset).toInt();

      const iEdge = int(terrainUniforms.uInnerTileSegments.add(3));
      const one = int(1);
      const two = int(2);
      const zero = int(0);
      const last = iEdge.sub(one);
      const innerSegments = iEdge.sub(int(3));
      const verticesPerNode = iEdge.mul(iEdge);

      const vIndex = int(vertexIndex);
      const ix = vIndex.mod(iEdge);
      const iy = vIndex.div(iEdge);

      const onSkirtLeft = ix.equal(zero);
      const onSkirtRight = ix.equal(last);
      const onSkirtTop = iy.equal(zero);
      const onSkirtBottom = iy.equal(last);

      const isLeft = onSkirtLeft.or(ix.equal(one));
      const isRight = onSkirtRight.or(ix.equal(last.sub(one)));
      const isTop = onSkirtTop.or(iy.equal(one));
      const isBottom = onSkirtBottom.or(iy.equal(last.sub(one)));
      const isEdgeBand = isLeft.or(isRight).or(isTop).or(isBottom).toVar();

      const dirLeft = int(0);
      const dirRight = int(1);
      const dirTop = int(2);
      const dirBottom = int(3);
      const edgeDir = select(
        isLeft,
        dirLeft,
        select(isRight, dirRight, select(isTop, dirTop, select(isBottom, dirBottom, int(-1)))),
      ).toVar();

      const seamOffset = nodeIndex.mul(int(8)).add(edgeDir.mul(two));
      const empty = uint(0xffffffff);
      const neighbor0U = seamFieldBufferNode.element(seamOffset);
      const neighbor1U = seamFieldBufferNode.element(seamOffset.add(one));

      const hasNeighbor0 = neighbor0U.notEqual(empty);
      const hasNeighbor1 = neighbor1U.notEqual(empty);
      const neighbor0 = neighbor0U.toInt();
      const neighbor1 = neighbor1U.toInt();
      const n0Level = select(
        hasNeighbor0,
        leafStorage.node.element(neighbor0.mul(int(4))).toInt(),
        int(-9999),
      );
      const n1Level = select(
        hasNeighbor1,
        leafStorage.node.element(neighbor1.mul(int(4))).toInt(),
        int(-9999),
      );
      const pick0 = hasNeighbor0.and(n0Level.equal(level.sub(one))).toVar();
      const pick1 = hasNeighbor1
        .and(n1Level.equal(level.sub(one)))
        .and(pick0.not())
        .toVar();
      const hasCoarserNeighbor = pick0.or(pick1).toVar();

      const isVerticalEdge = edgeDir.equal(dirLeft).or(edgeDir.equal(dirRight)).toVar();
      const jRaw = select(isVerticalEdge, iy.sub(one), ix.sub(one)).toInt();
      const j = jRaw.max(zero).min(innerSegments).toVar();
      const isOddJ = j.mod(two).equal(one).toVar();

      const canSnap = isEdgeBand
        .and(edgeDir.greaterThanEqual(zero))
        .and(hasCoarserNeighbor)
        .and(isOddJ)
        .toVar();

      const j0 = j.sub(one).max(zero);
      const j1 = j.add(one).min(innerSegments);
      const denom = j1.sub(j0).max(one).toFloat();
      const t = j.toFloat().sub(j0.toFloat()).div(denom);

      const xEdge = select(
        edgeDir.equal(dirLeft),
        one,
        select(edgeDir.equal(dirRight), innerSegments.add(one), j0.add(one)),
      ).toInt();
      const xEdgeN = select(
        edgeDir.equal(dirLeft),
        one,
        select(edgeDir.equal(dirRight), innerSegments.add(one), j1.add(one)),
      ).toInt();
      const yEdge = select(
        edgeDir.equal(dirTop),
        one,
        select(edgeDir.equal(dirBottom), innerSegments.add(one), j0.add(one)),
      ).toInt();
      const yEdgeN = select(
        edgeDir.equal(dirTop),
        one,
        select(edgeDir.equal(dirBottom), innerSegments.add(one), j1.add(one)),
      ).toInt();

      const baseOffset = nodeIndex.mul(verticesPerNode);
      const idx0 = baseOffset.add(yEdge.mul(iEdge).add(xEdge));
      const idx1 = baseOffset.add(yEdgeN.mul(iEdge).add(xEdgeN));
      const h0 = elevationFieldBufferNode.element(idx0).mul(terrainUniforms.uElevationScale);
      const h1 = elevationFieldBufferNode.element(idx1).mul(terrainUniforms.uElevationScale);
      const snappedElevation = h0.mul(float(1).sub(t)).add(h1.mul(t));

      yElevation.assign(select(canSnap, snappedElevation, yElevation));
    }

    const skirtVertex = isSkirtVertex(terrainUniforms.uInnerTileSegments);
    const skirtY = base.y.add(yElevation).sub(terrainUniforms.uSkirtScale.toVar());
    const worldY = select(skirtVertex, skirtY, base.y.add(yElevation));
    createNormalAssignment(terrainUniforms, normalFieldBufferNode);
    return vec3(base.x, worldY, base.z);
  })();
}
