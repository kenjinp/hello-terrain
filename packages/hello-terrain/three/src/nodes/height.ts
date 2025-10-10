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
import { ElevationFn, type ElevationReturn } from "./ElevationFn";
import { nodeStorageProperty } from "./properties";
import {
  rootUVCompute,
  tileIsLeaf,
  tileLevel,
  tileOriginVec2,
  tileSize,
  tileVertexWorldPositionCompute,
} from "./tile";
import { uRootSize } from "./uniforms";

export const height = (
  nodeIndex: ShaderNodeObject<Node>,
  localUV: ShaderNodeObject<Node>,
  _texelSize: ShaderNodeObject<Node>,
  elevationFn: ElevationReturn = ElevationFn(() => float(0))
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

      const rootSize = uRootSize.toVar();
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

export const readHeightVertex = (
  heightmapStorage: ShaderNodeObject<Node>,
  edgeVertextCount: number
) =>
  Fn(() => {
    const nodeIndex = int(instanceIndex);
    const intEdgeVertextCount = int(edgeVertextCount);

    const verticesPerNode = intEdgeVertextCount.mul(intEdgeVertextCount);
    const globalVertexIndex = nodeIndex
      .mul(verticesPerNode)
      .add(int(vertexIndex));

    const height = heightmapStorage.element(globalVertexIndex);
    return height;
  });
// Read height by deriving the per-node vertex index from positionLocal.xz
export const readHeightAtPositionLocal = (
  heightmapStorage: ShaderNodeObject<Node>,
  edgeVertextCount: number,
  positionLocal: ShaderNodeObject<Node>
) =>
  Fn(() => {
    const nodeIndex = int(instanceIndex);
    const intEdge = int(edgeVertextCount);
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
