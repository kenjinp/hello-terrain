import { task } from "@hello-terrain/work";
import { int } from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";
import type { ComputePipeline } from "../gpu/compute";
import {
  createTerrainFieldStorage,
  loadTilePackBounds,
  packNormalizedTerrainFieldSample,
  storeTerrainField,
} from "../gpu/terrainFieldStorage";
import {
  elevationFieldStageTask,
  createElevationFieldContextTask,
  tileNodesTask,
} from "./elevation-field.task";
import { topologyTask } from "./quadtree.task";
import { innerTileSegments, maxNodes, terrainFieldFilter } from "./params";
import { tileBoundsContextTask } from "./tile-bounds.task";
import { updateUniformsTask } from "./uniforms/uniforms.task";

// ── Terrain field storage ───────────────────────────────────────────────

/**
 * Allocates the `TerrainFieldStorage` (RGBA texture + storage node) sized for
 * the current `innerTileSegments` / `maxNodes`. Stable identity; recreated
 * only when shape or filter params change.
 */
export const createTerrainFieldStorageTask = task<{ renderer: WebGPURenderer }>(
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
).displayName("createTerrainFieldStorageTask");

/** @deprecated Use {@link createTerrainFieldStorageTask}. Removed in the next release. */
export const createTerrainFieldTextureTask = createTerrainFieldStorageTask;

// ── Compute stage ───────────────────────────────────────────────────────

/**
 * Terrain-field pack stage — the last stage of the default compute pipeline.
 * For every vertex it reads the raw height from the elevation field buffer,
 * reconstructs the world-space surface normal through the topology's
 * projection (`projection.gpu.createFieldNormal`, central differences over
 * neighboring heights), normalizes the height into `[0, 1]` against the tile's
 * pack bounds (`packMin` / `packMax` from `tileBoundsContextTask`), and writes
 * `[normalizedHeight, Nx, Ny, Nz]` into the RGBA `TerrainFieldStorage` texture
 * consumed by the render and GPU sampler paths.
 *
 * Accumulates the upstream elevation pipeline via `get(elevationFieldStageTask)`.
 */
export const terrainFieldStageTask = task((get, work) => {
  const upstream = get(elevationFieldStageTask);
  const elevationFieldContext = get(createElevationFieldContextTask);
  const terrainFieldStorage = get(createTerrainFieldStorageTask);
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
    return [
      ...upstream,
      (nodeIndex, globalVertexIndex, _uv, localCoordinates) => {
        const ix = int(localCoordinates.x);
        const iy = int(localCoordinates.y);
        const height = elevationFieldContext.node.element(globalVertexIndex);

        // Compute the world-space normal from the elevation field and pack the
        // full normal (Nx, Ny, Nz) alongside the height into RGBA.
        const normal = computeNormal(nodeIndex, ix, iy);
        const { packMin, packMax } = loadTilePackBounds(boundsContext.node, nodeIndex);

        storeTerrainField(
          terrainFieldStorage,
          ix,
          iy,
          nodeIndex,
          packNormalizedTerrainFieldSample(height, normal, packMin, packMax),
        );
      },
    ];
  });
}).displayName("terrainFieldStageTask");
