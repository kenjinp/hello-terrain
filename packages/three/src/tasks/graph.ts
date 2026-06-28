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
  leafGpuBufferTask,
  leafStorageTask,
  quadtreeConfigTask,
  quadtreeUpdateTask,
  dirtyVisibleSlotBufferTask,
  dirtyVisibleSlotStorageTask,
  terrainFieldContentEpochTask,
  residentLeafSetTask,
  tileResidencyTask,
  tileSlotUpdateTask,
  tileVisibilityTask,
  topologyTask,
  visibleLeafSetTask,
  visibleSlotStorageTask,
} from "./quadtree.task";
import {
  createUniformsTask,
  updateUniformsTask,
} from "./uniforms/uniforms.task";
import { terrainQueryTask, terrainReadbackTask } from "./terrain-query.task";
import { terrainRaycastTask } from "./terrain-raycast.task";
import {
  tileBoundsContextTask,
  tileBoundsReductionTask,
} from "./tile-bounds.task";

export { instanceIdTask } from "./instanceId.task";

/** All terrain task refs for direct access. */
export const terrainTasks = {
  instanceId: instanceIdTask,
  quadtreeConfig: quadtreeConfigTask,
  quadtreeUpdate: quadtreeUpdateTask,
  tileVisibility: tileVisibilityTask,
  tileResidency: tileResidencyTask,
  terrainFieldContentEpoch: terrainFieldContentEpochTask,
  visibleLeafSet: visibleLeafSetTask,
  residentLeafSet: residentLeafSetTask,
  tileSlotUpdate: tileSlotUpdateTask,
  leafStorage: leafStorageTask,
  visibleSlotStorage: visibleSlotStorageTask,
  dirtyVisibleSlotStorage: dirtyVisibleSlotStorageTask,
  dirtyVisibleSlotBuffer: dirtyVisibleSlotBufferTask,
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
  return g;
}
