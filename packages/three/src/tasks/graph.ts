import { graph } from "@hello-terrain/work";
import { WebGPURenderer } from "three/webgpu";
import {
  computeHeightmapTask,
  createComputeHeightmapTask,
  createHeightmapContextTask,
  createTileNodes,
} from "./heightmap.task";
import { instanceIdTask } from "./instanceId.task";
import {
  computeNormalMapTask,
  createComputeNormalMapTask,
  createNormalmapContextTask,
} from "./normalmap.task";
import { positionNodeTask } from "./positions.task";
import {
  leafGpuBufferTask,
  leafStorageTask,
  quadtreeConfigTask,
  quadtreeUpdateTask,
} from "./quadtree.task";
import { createUniformsTask, updateUniformsTask } from "./uniforms/uniforms.task";

export { instanceIdTask } from "./instanceId.task";

export function terrainGraph() {
  return graph<{ renderer: WebGPURenderer }>()
    .add(instanceIdTask)
    .add(quadtreeConfigTask)
    .add(quadtreeUpdateTask)
    .add(leafStorageTask)
    .add(leafGpuBufferTask)
    .add(createUniformsTask)
    .add(updateUniformsTask)
    .add(positionNodeTask)
    .add(createHeightmapContextTask)
    .add(createTileNodes)
    .add(createComputeHeightmapTask)
    .add(computeHeightmapTask)
    .add(createNormalmapContextTask)
    .add(createComputeNormalMapTask)
    .add(computeNormalMapTask);
}

/** All terrain task refs for direct access. */
export const terrainTasks = {
  instanceId: instanceIdTask,
  quadtreeConfig: quadtreeConfigTask,
  quadtreeUpdate: quadtreeUpdateTask,
  leafStorage: leafStorageTask,
  leafGpuBuffer: leafGpuBufferTask,
  createUniforms: createUniformsTask,
  updateUniforms: updateUniformsTask,
  positionNode: positionNodeTask,
} as const;
