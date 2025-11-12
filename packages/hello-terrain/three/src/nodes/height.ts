import {
  type ShaderNodeObject,
  float,
  instanceIndex,
  int,
  max,
  min,
  select,
  vertexIndex,
} from "three/tsl";

import { Fn } from "three/tsl";
import type { Node } from "three/webgpu";
import type { TerrainUniforms } from "../TerrainUniforms";
import { ElevationFn, type ElevationReturn } from "./ElevationFn";
import { nodeStorageProperty } from "./properties";
import {
  createRootUVCompute,
  createTileIsLeaf,
  createTileLevel,
  createTileOriginVec2,
  createTileSize,
  createTileVertexWorldPositionCompute,
} from "./tile";

export const createHeight = (
  uniforms: TerrainUniforms,
  elevationFn: ElevationReturn = ElevationFn(() => float(0))
) => {
  const tileIsLeaf = createTileIsLeaf();
  const rootUVCompute = createRootUVCompute(uniforms);
  const tileVertexWorldPositionCompute = createTileVertexWorldPositionCompute(uniforms);
  const tileOriginVec2 = createTileOriginVec2();
  const tileSize = createTileSize(uniforms);
  const tileLevel = createTileLevel();

  return (
    nodeIndex: ShaderNodeObject<Node>,
    localUV: ShaderNodeObject<Node>,
    _texelSize: ShaderNodeObject<Node>
  ) =>
    Fn(() => {
      const isActive = nodeStorageProperty
        .element(nodeIndex.mul(4).add(3))
        .equal(int(1));
      const isLeaf = tileIsLeaf(nodeIndex);
      const resolveElevation = Fn(() => {
        const rootUV = rootUVCompute(nodeIndex, localUV);

        const worldPosition = tileVertexWorldPositionCompute(
          nodeIndex,
          localUV
        ).setName("worldPositionWithSkirt");

        const rootSize = uniforms.uRootSize.toVar();
        return elevationFn({
          worldPosition,
          rootSize,
          rootUV,
          tileOriginVec2: tileOriginVec2(nodeIndex),
          tileSize: tileSize(nodeIndex),
          tileLevel: tileLevel(nodeIndex),
          nodeIndex: int(nodeIndex),
          tileUV: localUV,
        });
      });

      return select(isActive.and(isLeaf), resolveElevation(), float(0));
    })();
};

export const readHeightVertex = (
  heightmapStorage: ShaderNodeObject<Node>,
  edgeVertexCount: number
) =>
  Fn(() => {
    const nodeIndex = int(instanceIndex);
    const intEdgeVertexCount = int(edgeVertexCount);

    const verticesPerNode = intEdgeVertexCount.mul(intEdgeVertexCount);
    const globalVertexIndex = nodeIndex
      .mul(verticesPerNode)
      .add(int(vertexIndex));

    const height = heightmapStorage.element(globalVertexIndex);
    return height;
  });
// Read height by deriving the per-node vertex index from positionLocal.xz
export const readHeightAtPositionLocal = (
  heightmapStorage: ShaderNodeObject<Node>,
  edgeVertexCount: number,
  positionLocal: ShaderNodeObject<Node>
) =>
  Fn(() => {
    const nodeIndex = int(instanceIndex);
    const intEdge = int(edgeVertexCount);
    const edgeF = intEdge.toFloat();
    const last = intEdge.sub(int(1));

    // Map positionLocal.xz in [-0.5, 0.5] to [0, edge)
    const u = positionLocal.x.add(float(0.5));
    const v = positionLocal.z.add(float(0.5));

    const x = u.mul(edgeF).floor().toInt();
    const y = v.mul(edgeF).floor().toInt();

    const xClamped = min(max(x, int(0)), last);
    const yClamped = min(max(y, int(0)), last);

    const verticesPerNode = intEdge.mul(intEdge);
    const perNodeVertexIndex = yClamped.mul(intEdge).add(xClamped);
    const globalVertexIndex = nodeIndex
      .mul(verticesPerNode)
      .add(perNodeVertexIndex);

    return heightmapStorage.element(globalVertexIndex);
  });
