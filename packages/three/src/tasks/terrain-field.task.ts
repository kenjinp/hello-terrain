import { task } from "@hello-terrain/work";
import { Fn, float, int, vec2, vec3 } from "three/tsl";
import type { Node, WebGPURenderer } from "three/webgpu";
import type { ComputePipeline } from "../gpu/compute";
import {
  createTerrainFieldStorage,
  packTerrainFieldSample,
  storeTerrainField,
} from "../gpu/terrainFieldStorage";
import {
  elevationFieldStageTask,
  createElevationFieldContextTask,
  tileNodesTask,
} from "./elevation-field.task";
import { innerTileSegments, maxNodes, terrainFieldFilter } from "./params";
import { createUniformsTask } from "./uniforms/uniforms.task";

// ── Storage buffer context ──────────────────────────────────────────────

export const createTerrainFieldTextureTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    const edgeVertexCount = get(innerTileSegments) + 3;
    const maxNodesValue = get(maxNodes);
    const filter = get(terrainFieldFilter);
    return work(() =>
      createTerrainFieldStorage(
        edgeVertexCount,
        maxNodesValue,
        resources?.renderer,
        { filter },
      ),
    );
  },
).displayName("createTerrainFieldTextureTask");

/**
 * Build a TSL function that computes the surface normal at a grid point
 * by sampling the four cardinal neighbors in the elevation field buffer and
 * using central differences.
 *
 */
function createNormalFromElevationField(
  elevationFieldNode: Node,
  edgeVertexCount: number,
) {
  /**
   * Returns a TSL function `(nodeIndex, ix, iy, verticalScale) => vec2(nx, nz)`
   * where nx/nz are the horizontal components of the unit surface normal.
   */
  return Fn(
    ([nodeIndex, tileSize, ix, iy, elevationScale]: [
      Node,
      Node,
      Node,
      Node,
      Node,
    ]) => {
      const iEdge = int(edgeVertexCount);
      const verticesPerNode = iEdge.mul(iEdge);
      const baseOffset = int(nodeIndex).mul(verticesPerNode);

      const xLeft = int(ix).sub(int(1));
      const xRight = int(ix).add(int(1));
      const yUp = int(iy).sub(int(1));
      const yDown = int(iy).add(int(1));

      const hLeft = elevationFieldNode
        .element(baseOffset.add(int(iy).mul(iEdge).add(xLeft)))
        .mul(elevationScale);
      const hRight = elevationFieldNode
        .element(baseOffset.add(int(iy).mul(iEdge).add(xRight)))
        .mul(elevationScale);
      const hUp = elevationFieldNode
        .element(baseOffset.add(yUp.mul(iEdge).add(int(ix))))
        .mul(elevationScale);
      const hDown = elevationFieldNode
        .element(baseOffset.add(yDown.mul(iEdge).add(int(ix))))
        .mul(elevationScale);

      const innerSegments = float(iEdge).sub(float(3));
      const stepWorld = tileSize.div(innerSegments);
      const inv2Step = float(0.5).div(stepWorld);
      const dhdx = float(hRight).sub(float(hLeft)).mul(inv2Step);
      const dhdz = float(hDown).sub(float(hUp)).mul(inv2Step);

      const normal = vec3(dhdx.negate(), float(1), dhdz.negate()).normalize();
      return vec2(normal.x, normal.z);
    },
  );
}

// ── Compute stage ───────────────────────────────────────────────────────

/**
 * Normal field compute stage — reads height neighbors from the elevation field
 * buffer, computes surface normals via central differences, packs XZ
 * components into a u32 via `packHalf2x16`, and writes to the normal field
 * storage buffer.
 *
 * Accumulates the upstream elevation pipeline via `get(elevationFieldStageTask)`.
 */
export const terrainFieldStageTask = task((get, work) => {
  const upstream = get(elevationFieldStageTask);
  const elevationFieldContext = get(createElevationFieldContextTask);
  const terrainFieldStorage = get(createTerrainFieldTextureTask);
  const tileEdgeVertexCount = get(innerTileSegments) + 3;
  const tile = get(tileNodesTask);
  const uniforms = get(createUniformsTask);

  return work((): ComputePipeline => {
    const computeNormal = createNormalFromElevationField(
      elevationFieldContext.node,
      tileEdgeVertexCount,
    );
    return [
      ...upstream,
      (nodeIndex, globalVertexIndex, _uv, localCoordinates) => {
        const ix = int(localCoordinates.x);
        const iy = int(localCoordinates.y);
        const tileSize = tile.tileSize(nodeIndex);
        const height = elevationFieldContext.node.element(globalVertexIndex);

        // Compute normal components from the elevation field and pack into RGBA.
        const normalXZ = computeNormal(
          nodeIndex,
          tileSize,
          ix,
          iy,
          uniforms.uElevationScale,
        );

        storeTerrainField(
          terrainFieldStorage,
          ix,
          iy,
          nodeIndex,
          packTerrainFieldSample(height, normalXZ),
        );
      },
    ];
  });
}).displayName("terrainFieldStageTask");
