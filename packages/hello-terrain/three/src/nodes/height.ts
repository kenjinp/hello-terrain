import {
  type ShaderNodeObject,
  float,
  instanceIndex,
  int,
  max,
  min,
  pow,
  vec2,
  vertexIndex,
} from "three/tsl";

import { Fn } from "three/tsl";
import type { Node, StorageBufferNode } from "three/webgpu";
import { ElevationFn, type ElevationReturn } from "./ElevationFn";
import {
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
  elevationFn: ElevationReturn = ElevationFn(() => float(0))
) =>
  Fn(() => {
    const worldPosition = tileVertexWorldPositionCompute(
      nodeIndex,
      nodeStorage,
      rootSize,
      rootOrigin,
      localUV,
      innerTileSegments
    ).setName("worldPositionWithSkirt");

    // Compute rootUV analytically from tile coordinates to avoid precision drift
    const level = tileLevel(nodeIndex, nodeStorage);
    const tilesPerAxis = pow(2.0, level.toFloat());
    const nodeOrigin = tileOriginVec2(nodeIndex, nodeStorage);

    // Remap localUV [0,1] with skirt into inner range and clamp
    const edgeVertexCount = innerTileSegments.add(3);
    const uvStep = float(1.0).div(float(edgeVertexCount.sub(1)));
    const innerUvX = localUV.x.sub(uvStep).div(float(1.0).sub(uvStep.mul(2.0)));
    const innerUvY = localUV.y.sub(uvStep).div(float(1.0).sub(uvStep.mul(2.0)));
    const innerUvXClamped = max(min(innerUvX, float(1.0)), float(0.0));
    const innerUvYClamped = max(min(innerUvY, float(1.0)), float(0.0));

    const rootU = nodeOrigin.x.add(innerUvXClamped).div(tilesPerAxis);
    const rootV = nodeOrigin.y.add(innerUvYClamped).div(tilesPerAxis);
    const rootUV = vec2(rootU, rootV);

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
