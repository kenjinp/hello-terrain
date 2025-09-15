import {
  type ShaderNodeObject,
  float,
  instanceIndex,
  int,
  max,
  min,
  select,
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
  tileVertexWorldPosition,
} from "./tile";

export const height = (
  nodeIndex: ShaderNodeObject<Node>,
  nodeStorage: ShaderNodeObject<StorageBufferNode>,
  rootSize: ShaderNodeObject<Node>,
  rootOrigin: ShaderNodeObject<Node>,
  localUV: ShaderNodeObject<Node>,
  elevationFn: ElevationReturn = ElevationFn(() => float(0))
) =>
  Fn(() => {
    // const positionLocal = vec2(localUV.x, localUV.y);
    const nodeOffset = nodeIndex.mul(int(4));
    const isLeaf = nodeStorage.element(nodeOffset.add(int(3))).equal(int(1));
    // Compute the vertex world position from the node and local UV
    const positionLocal = vec2(localUV.x, localUV.y);
    const vertexWorldPosition = tileVertexWorldPosition(
      nodeIndex,
      nodeStorage,
      rootSize,
      rootOrigin,
      positionLocal
    );

    // Derive rootUV from the computed world position to ensure compute compatibility
    const rootUVFromWorld = Fn(
      ([worldPosition, rootSize, rootOrigin]: [
        ShaderNodeObject<Node>,
        ShaderNodeObject<Node>,
        ShaderNodeObject<Node>,
      ]) => {
        const centeredX = worldPosition.x.sub(rootOrigin.x);
        const centeredZ = worldPosition.z.sub(rootOrigin.z);
        return vec2(
          centeredX.div(rootSize).add(0.5),
          centeredZ.div(rootSize).mul(-1.0).add(0.5)
        );
      }
    )(vertexWorldPosition, rootSize, rootOrigin);

    const elevation = Fn(() =>
      elevationFn({
        tileVertexWorldPosition: vertexWorldPosition,
        rootSize: int(rootSize),
        rootUV: rootUVFromWorld,

        tileOriginVec2: tileOriginVec2(nodeIndex, nodeStorage),

        // works
        tileSize: tileSize(nodeIndex, nodeStorage, rootSize),
        tileLevel: tileLevel(nodeIndex, nodeStorage),
        nodeIndex: int(nodeIndex), // works
        tileUV: localUV, // works
      })
    );
    return select(isLeaf, elevation(), float(0));
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
