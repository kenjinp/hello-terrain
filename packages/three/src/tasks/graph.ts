import { graph } from "@hello-terrain/work";
import { WebGPURenderer } from "three/webgpu";
import { compileComputeTask, executeComputeTask } from "./compute.task";
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
import { positionNodeTask } from "./positions.task";
import {
  createFrustumCullContextTask,
  createRenderIndirectionTask,
  frustumCullTask,
} from "./frustum-cull.task";
import {
  captureDepthTask,
  type CaptureTerrainDepth,
  createHiZContextTask,
  updateHiZTask,
} from "./hiZ.task";
import {
  leafGpuBufferTask,
  leafStorageTask,
  quadtreeConfigTask,
  quadtreeUpdateTask,
  surfaceTask,
} from "./quadtree.task";
import {
  createCullingUniformsTask,
  createUniformsTask,
  updateCullingUniformsTask,
  updateUniformsTask,
} from "./uniforms/uniforms.task";
import { terrainQueryTask, terrainReadbackTask } from "./terrain-query.task";
import { terrainRaycastTask } from "./terrain-raycast.task";
import {
  tileBoundsContextTask,
  tileBoundsReductionTask,
} from "./tile-bounds.task";

export { instanceIdTask } from "./instanceId.task";

export function terrainGraph(): TerrainGraph {
  return graph<{
    renderer: WebGPURenderer;
    captureTerrainDepth?: CaptureTerrainDepth;
  }>()
    .add(instanceIdTask)
    .add(quadtreeConfigTask)
    .add(quadtreeUpdateTask)
    .add(leafStorageTask)
    .add(surfaceTask)
    .add(leafGpuBufferTask)
    .add(gpuSpatialIndexStorageTask)
    .add(gpuSpatialIndexUploadTask)
    .add(createUniformsTask)
    .add(updateUniformsTask)
    .add(createCullingUniformsTask)
    .add(updateCullingUniformsTask)
    .add(createRenderIndirectionTask)
    .add(createFrustumCullContextTask)
    .add(positionNodeTask)
    .add(createElevationFieldContextTask)
    .add(tileNodesTask)
    .add(createTerrainFieldTextureTask)
    .add(createTerrainSamplerTask)
    .add(elevationFieldStageTask)
    .add(terrainFieldStageTask)
    .add(compileComputeTask)
    .add(executeComputeTask)
    .add(tileBoundsContextTask)
    .add(tileBoundsReductionTask)
    .add(createHiZContextTask)
    .add(frustumCullTask)
    .add(captureDepthTask)
    .add(updateHiZTask)
    .add(terrainQueryTask)
    .add(terrainReadbackTask)
    .add(terrainRaycastTask);
}

/** All terrain task refs for direct access. */
export const terrainTasks = {
  instanceId: instanceIdTask,
  quadtreeConfig: quadtreeConfigTask,
  quadtreeUpdate: quadtreeUpdateTask,
  leafStorage: leafStorageTask,
  surface: surfaceTask,
  leafGpuBuffer: leafGpuBufferTask,
  gpuSpatialIndexStorage: gpuSpatialIndexStorageTask,
  gpuSpatialIndexUpload: gpuSpatialIndexUploadTask,
  createUniforms: createUniformsTask,
  updateUniforms: updateUniformsTask,
  createCullingUniforms: createCullingUniformsTask,
  updateCullingUniforms: updateCullingUniformsTask,
  createRenderIndirection: createRenderIndirectionTask,
  createFrustumCullContext: createFrustumCullContextTask,
  frustumCull: frustumCullTask,
  positionNode: positionNodeTask,
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
  createHiZContext: createHiZContextTask,
  captureDepth: captureDepthTask,
  updateHiZ: updateHiZTask,
  terrainQuery: terrainQueryTask,
  terrainReadback: terrainReadbackTask,
  terrainRaycast: terrainRaycastTask,
} as const satisfies TerrainTasks;
