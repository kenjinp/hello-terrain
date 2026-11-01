import { task } from "@hello-terrain/work";
import { int } from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";
import type { ComputePipeline, ComputeStageCallback } from "../gpu/compute";
import { createTileFieldStorage, storeTileField } from "../gpu/tileFieldStorage";
import { loadTilePackBounds, packNormalizedTerrainFieldSample } from "../gpu/terrainFieldStorage";
import {
  elevationFieldStageTask,
  createElevationFieldContextTask,
  tileNodesTask,
} from "./elevation-field.task";
import { topologyTask } from "./quadtree.task";
import { innerTileSegments, maxNodes, terrainFieldFilter } from "./params";
import { tileBoundsContextTask } from "./tile-bounds.task";
import { updateUniformsTask } from "./uniforms/uniforms.task";

// ── Storage buffer context ──────────────────────────────────────────────

export const createTerrainFieldTextureTask = task<{ renderer: WebGPURenderer }>(
  (get, work, { resources }) => {
    const edgeVertexCount = get(innerTileSegments) + 3;
    const maxNodesValue = get(maxNodes);
    const filter = get(terrainFieldFilter);
    return work(() =>
      createTileFieldStorage(edgeVertexCount, maxNodesValue, resources?.renderer, { filter }),
    );
  },
).displayName("createTerrainFieldTextureTask");

// ── Compute stage ───────────────────────────────────────────────────────

/**
 * Terrain-field pack stage — reads elevation neighbors, reconstructs unit
 * world-space normals, and stores [normalizedHeight, Nx, Ny, Nz] in RGBA16F.
 * Bounds must include all upstream elevation edits before this stage runs.
 *
 * Accumulates the upstream elevation pipeline via `get(elevationFieldStageTask)`.
 */
export const terrainFieldStageTask = task((get, work) => {
  const upstream = get(elevationFieldStageTask);
  const elevationFieldContext = get(createElevationFieldContextTask);
  const terrainFieldStorage = get(createTerrainFieldTextureTask);
  const tileEdgeVertexCount = get(innerTileSegments) + 3;
  const tile = get(tileNodesTask);
  const uniforms = get(updateUniformsTask);
  const topology = get(topologyTask);
  const boundsContext = get(tileBoundsContextTask);

  return work((): ComputePipeline => {
    // The projection owns the surface-normal reconstruction; no branching here.
    const computeNormal = topology.projection.gpu.createFieldNormal({
      elevationFieldNode: elevationFieldContext.node,
      edgeVertexCount: tileEdgeVertexCount,
      tile,
      uniforms,
    });
    const pack: ComputeStageCallback = (nodeIndex, globalVertexIndex, _uv, localCoordinates) => {
      const ix = int(localCoordinates.x);
      const iy = int(localCoordinates.y);
      const height = elevationFieldContext.node.element(globalVertexIndex);

      // Compute the world-space normal from the elevation field and pack the
      // full normal (Nx, Ny, Nz) alongside the height into RGBA.
      const normal = computeNormal(nodeIndex, ix, iy);
      const { packMin, packMax } = loadTilePackBounds(boundsContext.node, nodeIndex);

      storeTileField(
        terrainFieldStorage,
        ix,
        iy,
        nodeIndex,
        packNormalizedTerrainFieldSample(height, normal, packMin, packMax),
      );
    };
    pack.needsTileBounds = true;
    return [...upstream, pack];
  });
}).displayName("terrainFieldStageTask");
