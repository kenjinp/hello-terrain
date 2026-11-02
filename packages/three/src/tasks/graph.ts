import { graph } from "@hello-terrain/work";
import { WebGPURenderer } from "three/webgpu";
import { compileComputeTask, executeComputeTask, tileBoundsReductionTask } from "./compute.task";
import {
  createElevationFieldContextTask,
  tileNodesTask,
  elevationFieldStageTask,
} from "./elevation-field.task";
import { instanceIdTask } from "./instanceId.task";
import type { TerrainGraph, TerrainTasks, TerrainQueryContext } from "./graph.types";
import {
  gpuSpatialIndexStorageTask,
  gpuSpatialIndexUploadTask,
} from "./gpuSpatialIndex.task";
import {
  createTerrainFieldTextureTask,
  terrainFieldStageTask,
} from "./terrain-field.task";
import { createTerrainSamplerTask } from "./terrain-sampler.task";
import { positionNodeTask } from "./positions.task";
import {
  leafGpuBufferTask,
  leafStorageTask,
  quadtreeConfigTask,
  quadtreeUpdateTask,
  topologyTask,
} from "./quadtree.task";
import {
  createUniformsTask,
  updateUniformsTask,
} from "./uniforms/uniforms.task";
import { terrainQueryTask, terrainReadbackTask } from "./terrain-query.task";
import { terrainRaycastTask } from "./terrain-raycast.task";
import {
  tileBoundsContextTask,
} from "./tile-bounds.task";
import { createTextureFieldContextTask, textureFieldStageTask } from "./texture-field.task";
import { textureNodesTask } from "./texture-nodes.task";
import { quadtreeUpdate } from "./params";

export { instanceIdTask } from "./instanceId.task";

/** All terrain task refs for direct access. */
export const terrainTasks = {
  instanceId: instanceIdTask,
  quadtreeConfig: quadtreeConfigTask,
  quadtreeUpdate: quadtreeUpdateTask,
  leafStorage: leafStorageTask,
  topology: topologyTask,
  leafGpuBuffer: leafGpuBufferTask,
  gpuSpatialIndexStorage: gpuSpatialIndexStorageTask,
  gpuSpatialIndexUpload: gpuSpatialIndexUploadTask,
  createUniforms: createUniformsTask,
  updateUniforms: updateUniformsTask,
  positionNode: positionNodeTask,
  createElevationFieldContext: createElevationFieldContextTask,
  createTileNodes: tileNodesTask,
  createTerrainFieldTexture: createTerrainFieldTextureTask,
  createTerrainSampler: createTerrainSamplerTask,
  elevationFieldStage: elevationFieldStageTask,
  terrainFieldStage: terrainFieldStageTask,
  createTextureFieldContext: createTextureFieldContextTask,
  textureFieldStage: textureFieldStageTask,
  textureNodes: textureNodesTask,
  compileCompute: compileComputeTask,
  executeCompute: executeComputeTask,
  tileBoundsContext: tileBoundsContextTask,
  tileBoundsReduction: tileBoundsReductionTask,
  terrainQuery: terrainQueryTask,
  terrainReadback: terrainReadbackTask,
  terrainRaycast: terrainRaycastTask,
} as const satisfies TerrainTasks;

export function terrainGraph(): TerrainGraph {
  const g = graph<{ renderer: WebGPURenderer }>();
  for (const t of Object.values(terrainTasks)) {
    g.add(t as Parameters<typeof g.add>[0]);
  }
  const runGraph = g.run;
  let observedCache: TerrainQueryContext["cache"] | undefined;
  let observedBoundsGeneration = 0;
  let disposed = false;
  g.run = (options) => {
    const cache = disposed ? undefined : g.peek(terrainQueryTask)?.cache;
    if (cache !== observedCache) {
      observedCache = cache;
      observedBoundsGeneration = 0;
    }
    if (cache && cache.boundsGeneration !== observedBoundsGeneration) {
      // Consume before starting the run. A snapshot published during that run
      // remains visible to the next one instead of being acknowledged too early.
      observedBoundsGeneration = cache.boundsGeneration;
      g.set(quadtreeUpdate, (value) => value);
    }
    return runGraph(options);
  };
  const disposeGraph = g.dispose;
  g.dispose = () => {
    disposed = true;
    observedCache = undefined;
    g.peek(compileComputeTask)?.dispose();
    g.peek(createTextureFieldContextTask)?.dispose();
    g.peek(terrainQueryTask)?.cache.dispose();
    disposeGraph();
  };
  return g;
}
