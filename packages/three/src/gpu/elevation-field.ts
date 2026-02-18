import { Fn, float, instanceIndex, int, max, min, vertexIndex } from "three/tsl";
import type { Node } from "three/webgpu";
import type { TerrainUniformsContext } from "../types";
import type { createTileCompute } from "./tile";
import type { ElevationReturn } from "../tsl/elevation";
import type { TerrainFieldStorage } from "./terrainFieldStorage";
import { loadTerrainFieldElevation } from "./terrainFieldStorage";

export const createElevation = (
  tile: ReturnType<typeof createTileCompute>,
  uniforms: TerrainUniformsContext,
  elevationFn: ElevationReturn,
) => {
  return function perVertexElevation(nodeIndex: Node, localCoordinates: Node) {
    const ix = int(localCoordinates.x);
    const iy = int(localCoordinates.y);
    const edgeVertexCount = uniforms.uInnerTileSegments.toVar().add(int(3));
    const tileUV = localCoordinates.toFloat().div(edgeVertexCount.toFloat());
    const rootUV = tile.rootUVCompute(nodeIndex, ix, iy);

    const worldPosition = tile
      .tileVertexWorldPositionCompute(nodeIndex, ix, iy)
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
      tileUV,
    });
  };
};

export const readElevationFieldVertex = (
  terrainFieldStorage: TerrainFieldStorage,
  edgeVertexCount: number,
) =>
  Fn(() => {
    const intEdgeVertexCount = int(edgeVertexCount);
    const localVertexIndex = int(vertexIndex);
    const ix = localVertexIndex.mod(intEdgeVertexCount);
    const iy = localVertexIndex.div(intEdgeVertexCount);
    return loadTerrainFieldElevation(terrainFieldStorage, ix, iy, int(instanceIndex));
  });

export const readElevationFieldAtPositionLocal = (
  terrainFieldStorage: TerrainFieldStorage,
  edgeVertexCount: Node,
  positionLocal: Node,
) =>
  Fn(() => {
    const nodeIndex = int(instanceIndex);
    const intEdge = int(edgeVertexCount);
    const innerSegments = int(edgeVertexCount).sub(3);
    const fInnerSegments = float(innerSegments);
    const last = intEdge.sub(int(1));

    const u = positionLocal.x.add(float(0.5));
    const v = positionLocal.z.add(float(0.5));
    const x = u.mul(fInnerSegments).round().toInt().add(int(1));
    const y = v.mul(fInnerSegments).round().toInt().add(int(1));

    const xClamped = min(max(x, int(0)), last);
    const yClamped = min(max(y, int(0)), last);

    return loadTerrainFieldElevation(
      terrainFieldStorage,
      xClamped,
      yClamped,
      nodeIndex,
    );
  });
