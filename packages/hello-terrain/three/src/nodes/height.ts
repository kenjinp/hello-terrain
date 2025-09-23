import {
  type ShaderNodeObject,
  float,
  instanceIndex,
  int,
  max,
  min,
  vertexIndex,
} from "three/tsl";

import { Fn } from "three/tsl";
import type { Node, StorageBufferNode } from "three/webgpu";
import { ElevationFn, type ElevationReturn } from "./ElevationFn";
import {
  rootUVCompute,
  tileLevel,
  tileOriginVec2,
  tileSize,
  tileVertexWorldPositionCompute,
} from "./tile";

export const height = (
  nodeIndex: ShaderNodeObject<Node>,
  nodeStorage: ShaderNodeObject<StorageBufferNode>,
  rootSize: ShaderNodeObject<Node>,
  rootOrigin: ShaderNodeObject<Node>,
  localUV: ShaderNodeObject<Node>,
  innerTileSegments: ShaderNodeObject<Node>,
  _texelSize: ShaderNodeObject<Node>,
  elevationFn: ElevationReturn = ElevationFn(() => float(0))
) =>
  Fn(() => {
    const rootUV = rootUVCompute(
      nodeIndex,
      nodeStorage,
      rootSize,
      rootOrigin,
      localUV,
      innerTileSegments
    );

    const worldPosition = tileVertexWorldPositionCompute(
      nodeIndex,
      nodeStorage,
      rootSize,
      rootOrigin,
      localUV,
      innerTileSegments
    ).setName("worldPositionWithSkirt");

    return elevationFn({
      worldPosition,
      rootSize,
      rootUV,
      tileOriginVec2: tileOriginVec2(nodeIndex, nodeStorage),
      tileSize: tileSize(nodeIndex, nodeStorage, rootSize),
      tileLevel: tileLevel(nodeIndex, nodeStorage),
      nodeIndex: int(nodeIndex),
      tileUV: localUV,
    });
  })();

export const readHeightVertex = (
  heightmapStorage: ShaderNodeObject<StorageBufferNode>,
  edgeVertextCount: number
) =>
  Fn(() => {
    const nodeIndex = instanceIndex;
    const intEdgeVertextCount = int(edgeVertextCount);

    const verticesPerNode = int(intEdgeVertextCount.mul(intEdgeVertextCount));
    const globalVertexIndex = nodeIndex.mul(verticesPerNode).add(vertexIndex);

    const height = heightmapStorage.element(globalVertexIndex);
    return height;
  })();

// Read height by deriving the per-node vertex index from positionLocal.xz
export const readHeightAtPositionLocal = (
  heightmapStorage: ShaderNodeObject<StorageBufferNode>,
  edgeVertextCount: number,
  positionLocal: ShaderNodeObject<Node>
) =>
  Fn(() => {
    const nodeIndex = instanceIndex;
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
  })();
