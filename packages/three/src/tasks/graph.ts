import { graph } from "@hello-terrain/work";
import { WebGPURenderer } from "three/webgpu";
import { compileComputeTask, executeComputeTask, tileBoundsReductionTask } from "./compute.task";
import {
  createElevationFieldContextTask,
  tileNodesTask,
  elevationFieldStageTask,
} from "./elevation-field.task";
import { instanceIdTask } from "./instanceId.task";
import type { TerrainGraph, TerrainTasks } from "./graph.types";
import {
  gpuSpatialIndexStorageTask,
  gpuSpatialIndexUploadTask,
} from "./gpuSpatialIndex.task";
import {
  createTerrainFieldTextureTask,
  terrainFieldStageTask,
} from "./terrain-field.task";
import { createTerrainSamplerTask } from "./terrain-sampler.task";
import { positionNodeTask, terrainMaterialContextTask } from "./positions.task";
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
import { origin, quadtreeUpdate } from "./params";

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
  materialContext: terrainMaterialContextTask,
  createElevationFieldContext: createElevationFieldContextTask,
  createTileNodes: tileNodesTask,
  createTerrainFieldTexture: createTerrainFieldTextureTask,
  createTerrainSampler: createTerrainSamplerTask,
  elevationFieldStage: elevationFieldStageTask,
  terrainFieldStage: terrainFieldStageTask,
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
  // Bind independent mutable values before any task can see shared defaults.
  g.set(origin, { x: 0, y: 0, z: 0 });
  g.set(quadtreeUpdate, { cameraOrigin: { x: 0, y: 0, z: 0 }, mode: "distance", distanceFactor: 1.5 });
  for (const t of Object.values(terrainTasks)) {
    g.add(t as Parameters<typeof g.add>[0]);
  }
  return g;
}
