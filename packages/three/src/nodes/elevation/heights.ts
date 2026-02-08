import { Fn, float, instanceIndex, int, max, min, vertexIndex } from "three/tsl";
import type { Node } from "three/webgpu";
import type { TerrainUniformsContext } from "../../tasks/uniforms/terrainUniforms";
import { createTileCompute } from "../tile";
import { ElevationReturn } from "./elevation.types";

export const createElevation = (
  tile: ReturnType<typeof createTileCompute>,
  uniforms: TerrainUniformsContext,
  elevationFn: ElevationReturn,
) => {
  return function perVertexElevation(nodeIndex: Node, localUV: Node) {
    const rootUV = tile.rootUVCompute(nodeIndex, localUV);

    const worldPosition = tile
      .tileVertexWorldPositionCompute(nodeIndex, localUV)
      .setName("worldPositionWithSkirt");

    const rootSize = uniforms.uRootSize.toVar();
    return elevationFn({
      worldPosition,
      rootSize,
      rootUV,
      tileOriginVec2: tile.tileOriginVec2(nodeIndex),
      tileSize: tile.tileSize(nodeIndex),
      tileLevel: tile.tileLevel(nodeIndex),
      nodeIndex: int(nodeIndex),
      tileUV: localUV,
    });
  };
};

export const readHeightVertex = (heightmapStorage: Node, edgeVertexCount: number) =>
  Fn(() => {
    const nodeIndex = int(instanceIndex);
    const intEdgeVertexCount = int(edgeVertexCount);

    const verticesPerNode = intEdgeVertexCount.mul(intEdgeVertexCount);
    const globalVertexIndex = nodeIndex.mul(verticesPerNode).add(int(vertexIndex));

    const height = heightmapStorage.element(globalVertexIndex);
    return height;
  });

// Read height by deriving the per-node vertex index from positionLocal.xz.
//
// The geometry (TerrainGeometry) places inner vertices at
//   positionLocal.x = (ix - 1) / innerSegments - 0.5
// with skirt vertices clamped to the inner edge (±0.5).
//
// The compute shader writes to a 17×17 grid (edgeVertexCount = innerSegments + 3)
// where buffer index ix maps to: uExpanded = (ix - 1) / innerSegments.
//
// To invert the geometry's mapping back to the correct buffer index:
//   u = positionLocal.x + 0.5          →  [0, 1]
//   innerIdx = round(u * innerSegments) →  0..innerSegments (inner grid)
//   bufferIdx = innerIdx + 1            →  1..innerSegments+1 (skip skirt slot 0)
export const readHeightAtPositionLocal = (
  heightmapStorage: Node,
  edgeVertexCount: Node,
  positionLocal: Node,
) =>
  Fn(() => {
    const nodeIndex = int(instanceIndex);
    const intEdge = int(edgeVertexCount);
    const innerSegments = int(edgeVertexCount).sub(3);
    const fInnerSegments = float(innerSegments);
    const last = intEdge.sub(int(1));

    // Map positionLocal.xz from [-0.5, 0.5] to [0, 1]
    const u = positionLocal.x.add(float(0.5));
    const v = positionLocal.z.add(float(0.5));

    // Round to nearest inner grid point and offset by 1 to skip the skirt ring
    const x = u.mul(fInnerSegments).round().toInt().add(int(1));
    const y = v.mul(fInnerSegments).round().toInt().add(int(1));

    const xClamped = min(max(x, int(0)), last);
    const yClamped = min(max(y, int(0)), last);

    const verticesPerNode = intEdge.mul(intEdge);
    const perNodeVertexIndex = yClamped.mul(intEdge).add(xClamped);
    const globalVertexIndex = nodeIndex.mul(verticesPerNode).add(perNodeVertexIndex);

    return heightmapStorage.element(globalVertexIndex);
  });
