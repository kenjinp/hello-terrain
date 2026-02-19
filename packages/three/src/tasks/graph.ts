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
  createTerrainFieldTextureTask,
  terrainFieldStageTask,
} from "./terrain-field.task";
import { positionNodeTask } from "./positions.task";
import {
  leafGpuBufferTask,
  leafStorageTask,
  quadtreeConfigTask,
  quadtreeUpdateTask,
  surfaceTask,
} from "./quadtree.task";
import {
  createUniformsTask,
  updateUniformsTask,
} from "./uniforms/uniforms.task";

export { instanceIdTask } from "./instanceId.task";

export function terrainGraph(): TerrainGraph {
  return graph<{ renderer: WebGPURenderer }>()
    .add(instanceIdTask)
    .add(quadtreeConfigTask)
    .add(quadtreeUpdateTask)
    .add(leafStorageTask)
    .add(surfaceTask)
    .add(leafGpuBufferTask)
    .add(createUniformsTask)
    .add(updateUniformsTask)
    .add(positionNodeTask)
    .add(createElevationFieldContextTask)
    .add(tileNodesTask)
    .add(createTerrainFieldTextureTask)
    .add(elevationFieldStageTask)
    .add(terrainFieldStageTask)
    .add(compileComputeTask)
    .add(executeComputeTask);
}

/** All terrain task refs for direct access. */
export const terrainTasks = {
  instanceId: instanceIdTask,
  quadtreeConfig: quadtreeConfigTask,
  quadtreeUpdate: quadtreeUpdateTask,
  leafStorage: leafStorageTask,
  surface: surfaceTask,
  leafGpuBuffer: leafGpuBufferTask,
  createUniforms: createUniformsTask,
  updateUniforms: updateUniformsTask,
  positionNode: positionNodeTask,
  createElevationFieldContext: createElevationFieldContextTask,
  createTileNodes: tileNodesTask,
  createTerrainFieldTexture: createTerrainFieldTextureTask,
  elevationFieldStage: elevationFieldStageTask,
  terrainFieldStage: terrainFieldStageTask,
  compileCompute: compileComputeTask,
  executeCompute: executeComputeTask,
} as const satisfies TerrainTasks;
